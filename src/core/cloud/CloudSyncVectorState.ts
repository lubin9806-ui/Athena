export type CloudSyncVector = Record<string, number>;

/**
 * Durable client-side view of the server's per-resource version vectors.
 *
 * A write may only use the last vector the client actually observed. Guessing
 * or resetting it to an empty object turns every second write into a conflict;
 * accepting a conflict vector without resolving the payload turns the next
 * retry into a silent overwrite.
 */
export class CloudSyncVectorState {
  private readonly vectors: Record<string, CloudSyncVector> = {};

  constructor(value?: unknown) {
    if (!isRecord(value)) return;
    for (const [resourceId, vector] of Object.entries(value)) {
      if (!isResourceId(resourceId)) continue;
      const parsed = parseCloudSyncVector(vector);
      if (parsed) this.vectors[resourceId] = parsed;
    }
  }

  baseFor(resourceId: string): CloudSyncVector {
    return { ...(this.vectors[resourceId] || {}) };
  }

  observe(resourceId: string, value: unknown): boolean {
    if (!isResourceId(resourceId)) return false;
    const parsed = parseCloudSyncVector(value);
    if (!parsed) return false;
    this.vectors[resourceId] = parsed;
    return true;
  }

  snapshot(): Record<string, CloudSyncVector> {
    return Object.fromEntries(Object.entries(this.vectors).map(([resourceId, vector]) => [resourceId, { ...vector }]));
  }
}

export function parseCloudSyncVector(value: unknown): CloudSyncVector | null {
  if (!isRecord(value)) return null;
  const vector: CloudSyncVector = {};
  for (const [deviceId, revision] of Object.entries(value)) {
    if (!/^dev_[a-f0-9]{32}$/.test(deviceId) || !Number.isSafeInteger(revision) || Number(revision) <= 0) return null;
    vector[deviceId] = Number(revision);
  }
  return vector;
}

function isResourceId(value: string): boolean {
  return /^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
