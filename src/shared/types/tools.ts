export type ToolPermissionLevel = 'off' | 'read' | 'files' | 'full';

export type ToolExecutionStatus = 'completed' | 'failed' | 'denied';

export interface ToolModePermissions {
  create: ToolPermissionLevel;
  companion: ToolPermissionLevel;
  reason: ToolPermissionLevel;
  execute: ToolPermissionLevel;
}

export interface ToolSettings {
  /** Legacy fallback and the effective level passed into the runtime. */
  permissionLevel: ToolPermissionLevel;
  /** Adjustable maximum permission for each conversation mode. */
  modePermissions: ToolModePermissions;
  maxToolRounds: number;
  commandTimeoutSeconds: number;
}

export interface ToolExecutionRecord {
  id: string;
  name: string;
  label: string;
  status: ToolExecutionStatus;
  summary: string;
  inputPreview: string;
  outputPreview: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface ToolStatusEvent {
  phase: 'planning' | 'confirming' | 'running' | 'completed' | 'failed' | 'cancelled' | 'done';
  message: string;
  toolName?: string;
  toolLabel?: string;
  callId?: string;
}

export interface ToolConfirmationRequest {
  toolName: string;
  toolLabel: string;
  risk: 'destructive-file' | 'command' | 'program' | 'external-network';
  explanation: string;
  inputPreview: string;
}
