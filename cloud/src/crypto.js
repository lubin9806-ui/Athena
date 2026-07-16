'use strict';

const crypto = require('node:crypto');

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(16).toString('hex')}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmacSha256(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest('hex');
}

function constantEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function encryptJson(value, key, aad = '') {
  return encryptBytes(Buffer.from(JSON.stringify(value), 'utf8'), key, aad);
}

function decryptJson(envelope, key, aad = '') {
  return JSON.parse(decryptBytes(envelope, key, aad).toString('utf8'));
}

function encryptBytes(value, key, aad = '') {
  assertKey(key);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return JSON.stringify({
    v: 1,
    alg: 'A256GCM',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  });
}

function decryptBytes(serialized, key, aad = '') {
  assertKey(key);
  const envelope = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
  if (!envelope || envelope.v !== 1 || envelope.alg !== 'A256GCM') throw new Error('Unsupported encrypted envelope.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
}

function hashPassword(password) {
  validatePassword(password);
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password.normalize('NFKC'), salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt.toString('base64')}$${derived.toString('base64')}`;
}

function verifyPassword(password, encoded) {
  try {
    const [name, n, r, p, salt, expected] = String(encoded).split('$');
    if (name !== 'scrypt') return false;
    const expectedBytes = Buffer.from(expected, 'base64');
    const actual = crypto.scryptSync(String(password).normalize('NFKC'), Buffer.from(salt, 'base64'), expectedBytes.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
    return actual.length === expectedBytes.length && crypto.timingSafeEqual(actual, expectedBytes);
  } catch {
    return false;
  }
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new Error('Password must contain 12 to 128 characters.');
  }
  const common = new Set(['password1234', '123456789012', 'qwertyuiop12', 'athenaathena']);
  if (common.has(password.toLowerCase())) throw new Error('Password appears in the local blocked-password list.');
}

function generateTotpSecret() {
  return crypto.randomBytes(20).toString('base64url');
}

function totp(secret, timeMs = Date.now(), stepSeconds = 30) {
  const counter = Math.floor(timeMs / 1000 / stepSeconds);
  const input = Buffer.alloc(8);
  input.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', Buffer.from(secret, 'base64url')).update(input).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(code).padStart(6, '0');
}

function verifyTotp(secret, code, now = Date.now()) {
  return [-1, 0, 1].some((offset) => constantEqual(totp(secret, now + offset * 30000), String(code)));
}

function generateRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => `${crypto.randomBytes(4).toString('hex')}-${crypto.randomBytes(4).toString('hex')}`);
}

function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Encryption key must be exactly 32 bytes.');
}

module.exports = {
  randomId, sha256, hmacSha256, constantEqual, encryptJson, decryptJson, encryptBytes, decryptBytes,
  hashPassword, verifyPassword, validatePassword, generateTotpSecret, totp, verifyTotp, generateRecoveryCodes,
};
