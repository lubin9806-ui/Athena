import type { ModelProvider } from '../../shared/types';

export function canRouteModelRequest(provider: ModelProvider, remoteModelConsent: boolean): boolean {
  return provider === 'ollama' || remoteModelConsent;
}
