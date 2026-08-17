import type {
  ModelAdapterCapabilities,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
} from './ModelTypes';
import type { ModelProvider } from '../../../shared/types';

export interface ModelAdapter {
  readonly providerName: ModelProvider;
  readonly modelName: string;
  readonly endpoint: string;
  readonly capabilities: ModelAdapterCapabilities;

  refreshCapabilities?(): Promise<ModelAdapterCapabilities>;
  listModels(): Promise<string[]>;
  checkConnection(): Promise<boolean>;
  generate(request: ModelRequest, onEvent?: (event: ModelStreamEvent) => void): Promise<ModelResponse>;
}
