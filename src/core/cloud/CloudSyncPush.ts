import { isDeepStrictEqual } from 'util';
import { CloudProtocolError, type CloudProtocol } from './CloudProtocol';
import { CloudSyncVectorState } from './CloudSyncVectorState';

/**
 * Push one record using the last vector the client observed.
 *
 * A missing local vector can happen after upgrading a v1 session or after a
 * crash between a server commit and local persistence. The server's vector is
 * safe to adopt only when every versioned field and the payload are identical;
 * otherwise the conflict must remain unresolved and visible.
 */
export async function pushTrackedRecord(
  client: Pick<CloudProtocol, 'putRecord'>,
  vectorState: CloudSyncVectorState,
  record: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resourceId = String(record.resourceId || '');
  const result = await client.putRecord({ ...record, baseVector: vectorState.baseFor(resourceId) });
  if (result.outcome === 'conflict') {
    const server = isRecord(result.server) ? result.server : null;
    if (server && sameSyncRecord(record, server) && vectorState.observe(resourceId, server.vector)) {
      return { ...result, outcome: 'unchanged', record: server };
    }
    return result;
  }
  const accepted = isRecord(result.record) ? result.record : null;
  if (!accepted || !vectorState.observe(resourceId, accepted.vector)) {
    throw new CloudProtocolError(502, 'invalid-sync-vector', 'Athena Cloud 返回了无效的同步版本。');
  }
  return result;
}

export function sameSyncRecord(local: Record<string, unknown>, server: Record<string, unknown>): boolean {
  return local.resourceId === server.resourceId
    && local.resourceType === server.resourceType
    && local.schemaVersion === server.schemaVersion
    && local.deleted === server.deleted
    && isDeepStrictEqual(local.payload, server.payload);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
