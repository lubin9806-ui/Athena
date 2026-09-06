import type { ModelProvider } from '../../shared/types';

export type ModelEndpointScope = 'loopback' | 'private-network' | 'remote' | 'unknown';

/**
 * Where a model request actually goes.
 *
 * Provider name is not a destination: an Ollama base URL can point at another
 * machine just as easily as at this one, and treating "ollama" as a synonym for
 * "local" let conversations leave the device with remote-model consent switched
 * off (ATH-SEC-006).
 */
export function classifyModelEndpoint(endpoint: string | undefined): ModelEndpointScope {
  const raw = (endpoint || '').trim();
  if (!raw) return 'unknown';
  let host: string;
  try {
    host = new URL(raw.includes('://') ? raw : `http://${raw}`).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
  if (!host) return 'unknown';

  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (bare === 'localhost' || bare === '::1' || bare === '0.0.0.0' || /^127\./.test(bare)) return 'loopback';
  if (bare.endsWith('.localhost')) return 'loopback';
  if (/^10\./.test(bare)) return 'private-network';
  if (/^192\.168\./.test(bare)) return 'private-network';
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(bare)) return 'private-network';
  if (/^169\.254\./.test(bare)) return 'private-network';
  if (/^(?:fc|fd)[0-9a-f]{2}:/.test(bare) || /^fe80:/.test(bare)) return 'private-network';
  if (bare.endsWith('.local') || bare.endsWith('.internal') || bare.endsWith('.lan')) return 'private-network';
  return 'remote';
}

/**
 * Whether a model request may be sent. Loopback never leaves the machine and needs
 * no consent; anything else does, including a model server on the local network,
 * because the conversation still leaves this device.
 */
export function canRouteModelRequest(
  provider: ModelProvider,
  remoteModelConsent: boolean,
  endpoint?: string,
): boolean {
  if (remoteModelConsent) return true;
  // Without an endpoint the destination is unknown, so only a provider that cannot
  // be anything but local is allowed through.
  if (endpoint === undefined) return provider === 'ollama';
  return classifyModelEndpoint(endpoint) === 'loopback';
}

export function describeModelEndpointScope(scope: ModelEndpointScope): string {
  if (scope === 'loopback') return '本机';
  if (scope === 'private-network') return '本地网络内的其他设备';
  if (scope === 'remote') return '外部网络';
  return '无法识别的地址';
}
