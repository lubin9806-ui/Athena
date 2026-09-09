'use strict';

const crypto = require('node:crypto');
const { CloudError, assert } = require('./errors');
const { randomId } = require('./crypto');

/**
 * Local-network device pairing.
 *
 * A phone on the same network as the machine running Athena should not have to
 * invent an account first. Pairing gives it a session the way a TV app is
 * paired: the machine shows a short code, the phone repeats it back.
 *
 * The asymmetry is what makes that safe. Offering a code is loopback-only, so
 * only a process on the host itself can ask for one; a phone, or anything else
 * on the network, can only claim a code it was shown. Without that split any
 * device on the LAN could request a code and immediately claim it.
 *
 * Pending offers live in memory. They last ninety seconds, so losing them on
 * restart is the correct behaviour rather than a limitation, and no table needs
 * to change to support this.
 */
class PairingService {
  constructor(store, auth, config) {
    this.store = store;
    this.auth = auth;
    this.config = config;
    this.db = store.db;
    this.pending = new Map();
    this.failures = 0;
    this.lockedUntil = 0;
  }

  /** Ninety seconds: long enough to walk to the phone, short enough to matter. */
  static get TTL_MS() { return 90_000; }

  /** Wrong codes tolerated before claiming pauses; the space is only a million wide. */
  static get MAX_FAILURES() { return 3; }

  static get LOCK_MS() { return 60_000; }

  /**
   * Requires the host itself. IPv4 arrives mapped into IPv6 on a dual stack
   * socket, so the mapped form is unwrapped before judging it.
   */
  static isLoopback(address) {
    const host = PairingService.normalize(address);
    return host === '127.0.0.1' || host === '::1' || host.startsWith('127.');
  }

  /** Loopback plus RFC1918: the reach the Android plan allows for a fixture. */
  static isLocalNetwork(address) {
    const host = PairingService.normalize(address);
    if (PairingService.isLoopback(host)) return true;
    const parts = host.split('.');
    if (parts.length !== 4) return false;
    const octets = parts.map((part) => Number(part));
    if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
    if (octets[0] === 10) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    return octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31;
  }

  static normalize(address) {
    const host = String(address || '').trim();
    return host.startsWith('::ffff:') ? host.slice(7) : host;
  }

  /** Six digits, drawn without modulo bias so every code is equally likely. */
  static generateCode() {
    while (true) {
      const value = crypto.randomBytes(4).readUInt32BE(0);
      if (value < 4_294_000_000) return String(value % 1_000_000).padStart(6, '0');
    }
  }

  /**
   * Creates a pairing code bound to an account space.
   *
   * With a signed-in caller the phone joins that account. Without one a local
   * account is created and reused: the user is not asked to invent credentials
   * for a service running on their own machine, but an account still exists,
   * because sync needs somewhere to put the data.
   */
  offer({ remoteAddress, context = null, label = 'Athena Desktop' }) {
    assert(this.config.environment === 'local', 404, 'not-found', 'Route was not found.');
    assert(PairingService.isLoopback(remoteAddress), 403, 'pairing-host-only', 'Pairing codes may only be offered from the host machine.');

    this.sweep();
    const principal = context || this.ensureLocalAccount();
    const code = PairingService.generateCode();
    const expiresAt = Date.now() + PairingService.TTL_MS;
    this.pending.set(code, { tenantId: principal.tenantId, userId: principal.userId, expiresAt, label });
    this.store.appendAudit(principal.tenantId, principal.userId, 'pairing.offer', code.slice(0, 2) + '****', 'success');
    return { code, expiresInSeconds: Math.round(PairingService.TTL_MS / 1000), expiresAt: new Date(expiresAt).toISOString(), label };
  }

  /**
   * Exchanges a code for a session. The result is an ordinary device session:
   * it shows up in the device list and can be revoked there like any other.
   */
  claim({ remoteAddress, code, deviceName = 'Athena phone', platform = 'android' }) {
    assert(this.config.environment === 'local', 404, 'not-found', 'Route was not found.');
    assert(PairingService.isLocalNetwork(remoteAddress), 403, 'pairing-network-only', 'Pairing is limited to the local network.');
    assert(Date.now() >= this.lockedUntil, 429, 'pairing-locked', 'Too many incorrect codes. Wait before trying again.');
    assert(typeof code === 'string' && /^\d{6}$/.test(code), 400, 'invalid-code', 'Pairing code must be six digits.');

    this.sweep();
    const offer = this.pending.get(code);
    if (!offer) {
      this.failures += 1;
      if (this.failures >= PairingService.MAX_FAILURES) {
        this.failures = 0;
        this.lockedUntil = Date.now() + PairingService.LOCK_MS;
      }
      throw new CloudError(401, 'invalid-code', 'Pairing code is not valid.');
    }

    // Single use: consumed whether or not the session below succeeds, so a
    // failure cannot leave a live code behind.
    this.pending.delete(code);
    this.failures = 0;

    const session = this.auth.createSession(offer.tenantId, offer.userId, { deviceName, platform });
    this.store.appendAudit(offer.tenantId, offer.userId, 'pairing.claim', session.device.id, 'success', { platform });
    return { tenantId: offer.tenantId, userId: offer.userId, ...session };
  }

  sweep() {
    const now = Date.now();
    for (const [code, offer] of this.pending) {
      if (offer.expiresAt <= now) this.pending.delete(code);
    }
  }

  /**
   * The account space for a machine that has never signed in. Looked up by a
   * reserved marker rather than re-created, so pairing a second phone joins the
   * first one's account instead of starting a parallel world.
   */
  ensureLocalAccount() {
    const existing = this.db.prepare(
      "SELECT tenant_id, id FROM users WHERE role='owner' AND email_hash=? AND status='active'",
    ).all(LOCAL_ACCOUNT_MARKER);
    if (existing.length > 0) return { tenantId: existing[0].tenant_id, userId: existing[0].id };

    const created = this.auth.registerTenant({
      tenantName: 'Athena Local',
      email: `${randomId('pair')}@athena.local`,
      password: crypto.randomBytes(24).toString('base64url'),
      deviceName: 'Athena Desktop',
      platform: 'desktop',
    });
    // Stamped after creation: registerTenant hashes the real address, and this
    // marker is what makes the local account findable again.
    this.db.prepare('UPDATE users SET email_hash=? WHERE tenant_id=? AND id=?')
      .run(LOCAL_ACCOUNT_MARKER, created.tenantId, created.userId);
    return { tenantId: created.tenantId, userId: created.userId };
  }
}

/**
 * Not a hash of any address, so it cannot collide with a real account and a
 * real email can never resolve to the local one.
 */
const LOCAL_ACCOUNT_MARKER = 'local-pairing-account';

module.exports = { PairingService, LOCAL_ACCOUNT_MARKER };
