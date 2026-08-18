export type UpdateChannel = 'beta' | 'stable';

export interface UpdateConfiguration {
  schemaVersion: 1;
  enabled: boolean;
  baseUrl: string;
  channel: UpdateChannel;
  checkIntervalHours: number;
}

export interface ChannelControl {
  schemaVersion: 1;
  channel: UpdateChannel;
  paused: boolean;
  reason: string | null;
  updatedAt: string;
}

export interface RollbackControl {
  schemaVersion: 1;
  channel: UpdateChannel;
  targetVersion: string;
  targetCandidateId: string;
  reason: string;
  updatedAt: string;
}

export interface PublishedCandidate {
  schemaVersion: 1;
  candidateId: string;
  version: string;
  channel: UpdateChannel;
  generatedAt: string;
  distributionAllowed: true;
  disposition: 'CANDIDATE_READY';
}

export interface OfferedVersionDecision {
  approved: boolean;
  allowDowngrade: boolean;
  reason: string;
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-(beta|rc)\.(\d+))?$/;
const CANDIDATE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every(key => allowed.has(key));
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function parseVersion(value: string): [number, number, number, number, number] | null {
  const match = VERSION_PATTERN.exec(value);
  if (!match) return null;
  const numeric = [match[1], match[2], match[3], match[5] || '0'].map(Number);
  if (numeric.some(part => !Number.isSafeInteger(part) || part < 0 || part > 65535)) return null;
  const prereleaseRank = !match[4] ? 2 : match[4] === 'rc' ? 1 : 0;
  return [numeric[0], numeric[1], numeric[2], prereleaseRank, numeric[3]];
}

export function channelForVersion(value: string): UpdateChannel | null {
  const parsed = parseVersion(value);
  if (!parsed) return null;
  return parsed[3] === 2 ? 'stable' : 'beta';
}

export function compareVersions(left: string, right: string): number | null {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] < rightParts[index] ? -1 : 1;
  }
  return 0;
}

export function normalizeApprovedBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  if (value !== value.trim() || /[\\\r\n\t]/.test(value)) return null;
  if (/%(?:2e|2f|5c)/i.test(value) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (!parsed.hostname || (parsed.port && parsed.port !== '443')) return null;
    if (parsed.pathname.split('/').some(part => part === '.' || part === '..')) return null;
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function isApprovedRemoteUrl(baseUrl: string, value: string): boolean {
  const normalizedBase = normalizeApprovedBaseUrl(baseUrl);
  if (!normalizedBase) return false;
  try {
    const base = new URL(`${normalizedBase}/`);
    const candidate = new URL(value);
    const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
    return candidate.protocol === 'https:'
      && candidate.origin === base.origin
      && !candidate.username
      && !candidate.password
      && !candidate.search
      && !candidate.hash
      && candidate.pathname.startsWith(basePath);
  } catch {
    return false;
  }
}

export function parseUpdateConfiguration(value: unknown): UpdateConfiguration | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.enabled !== 'boolean') return null;
  if (!hasOnlyKeys(value, ['schemaVersion', 'enabled', 'baseUrl', 'channel', 'checkIntervalHours'])) return null;
  if (value.channel !== 'beta' && value.channel !== 'stable') return null;
  if (typeof value.checkIntervalHours !== 'number'
    || !Number.isFinite(value.checkIntervalHours)
    || value.checkIntervalHours < 0.25
    || value.checkIntervalHours > 168) return null;
  const baseUrl = value.enabled ? normalizeApprovedBaseUrl(value.baseUrl) : '';
  if (value.enabled && !baseUrl) return null;
  return {
    schemaVersion: 1,
    enabled: value.enabled,
    baseUrl: baseUrl || '',
    channel: value.channel,
    checkIntervalHours: value.checkIntervalHours,
  };
}

export function parseChannelControl(value: unknown, channel: UpdateChannel): ChannelControl | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['schemaVersion', 'channel', 'paused', 'reason', 'updatedAt'])
    || value.schemaVersion !== 1
    || value.channel !== channel
    || typeof value.paused !== 'boolean'
    || !isIsoTimestamp(value.updatedAt)) return null;
  if (value.reason !== null && (typeof value.reason !== 'string' || value.reason.length > 240)) return null;
  if (value.paused && (!value.reason || !value.reason.trim())) return null;
  return {
    schemaVersion: 1,
    channel,
    paused: value.paused,
    reason: typeof value.reason === 'string' ? value.reason.trim() : null,
    updatedAt: value.updatedAt,
  };
}

export function parseRollbackControl(value: unknown, channel: UpdateChannel): RollbackControl | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['schemaVersion', 'channel', 'targetVersion', 'targetCandidateId', 'reason', 'updatedAt'])
    || value.schemaVersion !== 1
    || value.channel !== channel
    || typeof value.targetVersion !== 'string'
    || channelForVersion(value.targetVersion) !== channel
    || typeof value.targetCandidateId !== 'string'
    || !CANDIDATE_ID_PATTERN.test(value.targetCandidateId)
    || typeof value.reason !== 'string'
    || !value.reason.trim()
    || value.reason.length > 240
    || !isIsoTimestamp(value.updatedAt)) return null;
  return {
    schemaVersion: 1,
    channel,
    targetVersion: value.targetVersion,
    targetCandidateId: value.targetCandidateId,
    reason: value.reason.trim(),
    updatedAt: value.updatedAt,
  };
}

export function parsePublishedCandidate(value: unknown, channel: UpdateChannel): PublishedCandidate | null {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.channel !== channel
    || typeof value.candidateId !== 'string'
    || !CANDIDATE_ID_PATTERN.test(value.candidateId)
    || typeof value.version !== 'string'
    || channelForVersion(value.version) !== channel
    || !isIsoTimestamp(value.generatedAt)
    || value.distributionAllowed !== true
    || value.disposition !== 'CANDIDATE_READY'
    || !Array.isArray(value.blockers)
    || value.blockers.length !== 0) return null;
  return {
    schemaVersion: 1,
    candidateId: value.candidateId,
    version: value.version,
    channel,
    generatedAt: value.generatedAt,
    distributionAllowed: true,
    disposition: 'CANDIDATE_READY',
  };
}

export function evaluateOfferedVersion(
  currentVersion: string,
  offeredVersion: string,
  channel: UpdateChannel,
  rollback: RollbackControl | null,
): OfferedVersionDecision {
  if (channelForVersion(currentVersion) !== channel || channelForVersion(offeredVersion) !== channel) {
    return { approved: false, allowDowngrade: false, reason: 'channel-mismatch' };
  }
  const order = compareVersions(offeredVersion, currentVersion);
  if (order === null || order === 0) return { approved: false, allowDowngrade: false, reason: 'version-not-actionable' };
  if (rollback) {
    if (rollback.targetVersion !== offeredVersion) {
      return { approved: false, allowDowngrade: false, reason: 'rollback-target-mismatch' };
    }
    if (order >= 0) return { approved: false, allowDowngrade: false, reason: 'rollback-target-not-older' };
    return { approved: true, allowDowngrade: true, reason: 'approved-rollback' };
  }
  if (order < 0) return { approved: false, allowDowngrade: false, reason: 'unapproved-downgrade' };
  return { approved: true, allowDowngrade: false, reason: 'approved-upgrade' };
}
