import { isIP } from 'net';
import { createLogger } from '../../engine/Logger';
import { assertPublicUrl, isPrivateIpAddress } from '../web/PageContentExtractor';

const logger = createLogger('TrustedClock');

/**
 * What time it is, as far as prompts are concerned. Online, it is the time an
 * already-consented HTTPS host states in its Date header; offline, or with nothing
 * consented, it is this machine's clock. Reads are synchronous and never wait on the
 * network: a sync only updates the offset the next read applies.
 *
 * No time server is added. Every origin probed is one the user has already agreed to
 * contact (the remote model's endpoint, the search providers), the probe is a HEAD
 * without credentials or content, and only TLS-authenticated answers count: a Date
 * header over plain HTTP could come from any captive portal. There is no timer; the
 * controller probes at startup and when a turn begins, so an idle app makes no calls.
 */
export type ClockSource = 'network' | 'local';

export interface ClockReading {
  date: Date;
  source: ClockSource;
  offsetMs: number;
  origin?: string;
}

export interface TrustedClockOptions {
  /** Origins the user has consented to contact, resolved afresh at every probe. */
  resolveOrigins?: () => string[];
  fetchImpl?: typeof fetch;
  localNow?: () => number;
  /** DNS-level check; the synchronous filter already drops loopback and LAN literals. */
  assertOrigin?: (url: URL) => Promise<void>;
}

// A turn re-probes at most this often.
const RESYNC_AFTER_MS = 5 * 60_000;
// A network reading stays trusted this long without a newer one.
const NETWORK_VALID_FOR_MS = 15 * 60_000;
const PROBE_TIMEOUT_MS = 5_000;
const EARLIEST_PLAUSIBLE_MS = Date.UTC(2020, 0, 1);
const LATEST_PLAUSIBLE_MS = Date.UTC(2100, 0, 1);

interface NetworkReading {
  offsetMs: number;
  origin: string;
  syncedAt: number;
}

export class TrustedClock {
  private resolveOrigins: () => string[] = () => [];
  private fetchImpl: typeof fetch = (input, init) => fetch(input, init);
  private localNow: () => number = () => Date.now();
  private assertOrigin: (url: URL) => Promise<void> = assertPublicUrl;
  private network: NetworkReading | null = null;
  private lastAttemptAt = 0;
  private lastAttemptFailed = false;
  private inflight: Promise<ClockReading> | null = null;

  constructor(options: TrustedClockOptions = {}) {
    this.configure(options);
  }

  configure(options: TrustedClockOptions): void {
    if (options.resolveOrigins) this.resolveOrigins = options.resolveOrigins;
    if (options.fetchImpl) this.fetchImpl = options.fetchImpl;
    if (options.localNow) this.localNow = options.localNow;
    if (options.assertOrigin) this.assertOrigin = options.assertOrigin;
  }

  /** Forgets every reading, so the next read is local until a probe succeeds. */
  reset(): void {
    this.network = null;
    this.lastAttemptAt = 0;
    this.lastAttemptFailed = false;
    this.inflight = null;
  }

  now(): Date {
    return this.reading().date;
  }

  reading(): ClockReading {
    const local = this.localNow();
    const network = this.network;
    // The latest probe failing means we are offline now, whatever an older reading said.
    if (network && !this.lastAttemptFailed && local - network.syncedAt <= NETWORK_VALID_FOR_MS) {
      return { date: new Date(local + network.offsetMs), source: 'network', offsetMs: network.offsetMs, origin: network.origin };
    }
    return { date: new Date(local), source: 'local', offsetMs: 0 };
  }

  /** Probes unless one ran within RESYNC_AFTER_MS. Safe to fire and forget. */
  syncIfStale(): Promise<ClockReading> {
    if (this.inflight) return this.inflight;
    if (this.lastAttemptAt && this.localNow() - this.lastAttemptAt < RESYNC_AFTER_MS) {
      return Promise.resolve(this.reading());
    }
    return this.sync();
  }

  sync(): Promise<ClockReading> {
    if (!this.inflight) {
      this.inflight = this.probe().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async probe(): Promise<ClockReading> {
    const before = this.reading().source;
    this.lastAttemptAt = this.localNow();
    let answered = false;

    for (const origin of this.candidateOrigins()) {
      try {
        const url = new URL(origin);
        await this.assertOrigin(url);
        const startedAt = this.localNow();
        const response = await this.fetchImpl(url.origin, {
          method: 'HEAD',
          redirect: 'manual',
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        const finishedAt = this.localNow();
        const serverMs = Date.parse(response.headers.get('date') || '');
        if (!Number.isFinite(serverMs) || serverMs < EARLIEST_PLAUSIBLE_MS || serverMs > LATEST_PLAUSIBLE_MS) continue;
        // The header is stamped somewhere inside the round trip; the midpoint is the
        // best estimate, good to the header's one-second resolution.
        this.network = { offsetMs: serverMs - (startedAt + finishedAt) / 2, origin: url.origin, syncedAt: finishedAt };
        answered = true;
        break;
      } catch {
        // One unreachable host is not "offline"; try the next consented one.
      }
    }

    this.lastAttemptFailed = !answered;
    const after = this.reading();
    if (after.source !== before) {
      logger.info(after.source === 'network'
        ? `Clock now follows network time from ${after.origin} (offset ${Math.round(after.offsetMs / 1000)}s).`
        : 'No consented host answered; clock now follows this machine.');
    }
    return after;
  }

  private candidateOrigins(): string[] {
    const origins: string[] = [];
    for (const raw of this.resolveOrigins()) {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        continue;
      }
      if (isTrustworthyTimeOrigin(url) && !origins.includes(url.origin)) origins.push(url.origin);
    }
    return origins;
  }
}

/** HTTPS, and not this machine or its LAN: a loopback Ollama's Date header is our own clock. */
export function isTrustworthyTimeOrigin(url: URL): boolean {
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  return !(isIP(host) && isPrivateIpAddress(host));
}

export const trustedClock = new TrustedClock();

export function trustedNow(): Date {
  return trustedClock.now();
}
