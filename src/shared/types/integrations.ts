export type McpTransportKind = 'stdio' | 'streamable-http';
export type McpProtocolMode = 'legacy' | 'auto' | '2026-07-28';
export type McpConnectionStatus = 'disabled' | 'approval-required' | 'disconnected' | 'connecting' | 'connected' | 'error';

export interface McpStdioConfig {
  command: string;
  args: string[];
  cwd: string | null;
  envKeys: string[];
}

export interface McpHttpConfig {
  url: string;
  bearerTokenEnv: string | null;
}

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransportKind;
  protocolMode: McpProtocolMode;
  stdio: McpStdioConfig | null;
  http: McpHttpConfig | null;
  enabled: boolean;
  configFingerprint: string;
  approvedFingerprint: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface McpToolSummary {
  name: string;
  registeredName: string;
  title: string | null;
  description: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface McpServerSnapshot extends McpServerConfig {
  status: McpConnectionStatus;
  error: string | null;
  serverName: string | null;
  serverVersion: string | null;
  protocolVersion: string | null;
  instructions: string | null;
  tools: McpToolSummary[];
  diagnostics: string[];
  connectedAt: string | null;
}

export interface McpIntegrationSnapshot {
  servers: McpServerSnapshot[];
  connectedCount: number;
  registeredToolCount: number;
}

export interface McpServerInput {
  id?: string;
  name: string;
  transport: McpTransportKind;
  protocolMode?: McpProtocolMode;
  stdio?: Partial<McpStdioConfig> | null;
  http?: Partial<McpHttpConfig> | null;
}
