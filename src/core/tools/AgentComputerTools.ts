import * as path from 'path';
import type { AgentCapabilityAccess, AgentRiskLevel, ToolPermissionLevel, ToolSettings } from '../../shared/types';
import {
  ToolRegistry,
  type AgentToolArgumentPreview,
  type AgentToolPolicyDescriptor,
  type AgentToolRegistration,
} from '../agent/ToolRegistry';
import { buildToolConfirmation, redactInlineSecrets } from './ToolRuntime';
import { ComputerToolService } from './ComputerTools';
import { permissionLabel, type ComputerToolDefinition } from './ComputerToolCatalog';

export interface ComputerAgentToolBridgeOptions {
  registry: ToolRegistry;
  /**
   * Resolved for a specific run when one is executing, so the run's permission
   * ceiling can cap the current setting (ATH-SEC-005). Called without a run id when
   * only the tool catalogue is being built.
   */
  getSettings: (runId?: string) => ToolSettings;
  /** Project roots for a concrete run. The first root is the default cwd/base. */
  resolveWorkspaceRoots?: (runId: string) => string[];
  /** Resolves opaque credential:// references only at the final tool boundary. */
  resolveCredential?: (reference: string) => string | null;
  service?: ComputerToolService;
}

const IDEMPOTENT_TOOLS = new Set([
  'file_info',
  'list_directory',
  'read_file',
  'search_files',
  'search_text',
  'terminal_list',
  'check_port',
]);

const BOOLEAN_ARGUMENTS = new Set([
  'recursive',
  'case_sensitive',
  'replace_all',
  'overwrite',
  'append_newline',
]);

const INTEGER_ARGUMENTS = new Set([
  'max_depth',
  'limit',
  'offset',
  'max_bytes',
  'max_results',
  'wait_ms',
  'max_chars',
  'port',
]);

export class ComputerAgentToolBridge {
  private readonly service: ComputerToolService;
  private readonly ownedTools = new Map<string, Readonly<AgentToolRegistration>>();

  constructor(private readonly options: ComputerAgentToolBridgeOptions) {
    this.service = options.service || new ComputerToolService();
  }

  refresh(): string[] {
    for (const [name, definition] of this.ownedTools) {
      if (!this.options.registry.unregister(name, definition)) {
        throw new Error(`Computer tool registration ownership changed before refresh: ${name}`);
      }
    }
    this.ownedTools.clear();
    const settings = this.options.getSettings();
    this.service.applyPermissionLevel(settings.permissionLevel);
    for (const definition of this.service.getDefinitions(settings)) {
      const registered = this.registerDefinition(definition);
      this.ownedTools.set(definition.name, registered);
    }
    return Array.from(this.ownedTools.keys()).sort();
  }

  shutdown(): void {
    for (const [name, definition] of this.ownedTools) this.options.registry.unregister(name, definition);
    this.ownedTools.clear();
    this.service.shutdown();
  }

  private registerDefinition(definition: ComputerToolDefinition): Readonly<AgentToolRegistration> {
    return this.options.registry.register({
      name: definition.name,
      version: 'computer-tools-v1',
      capability: capabilityForLevel(definition.minimumLevel).capability,
      label: definition.label,
      description: definition.description,
      parameters: schemaFromSignature(definition.signature),
      strict: true,
      idempotent: IDEMPOTENT_TOOLS.has(definition.name),
      timeoutMs: timeoutForTool(definition.name, this.options.getSettings()),
      retry: { maxAttempts: 1 },
      policy: argumentsValue => policyForTool(definition, argumentsValue),
      redactArguments: redactComputerArguments,
      previewArguments: previewComputerArguments,
      execute: async (argumentsValue, context) => {
        if (context.signal.aborted) throw context.signal.reason || new Error('Tool execution cancelled');
        // Resolved per call and per run: a permission the user revoked mid-run must
        // stop the next tool, and raising the setting again must not restore it.
        const settings = this.options.getSettings(context.runId);
        this.service.applyPermissionLevel(settings.permissionLevel);
        const scoped = scopeExecutionArguments(
          definition,
          capExecutionArguments(definition.name, argumentsValue, settings),
          this.options.resolveWorkspaceRoots?.(context.runId) ?? [],
          settings.permissionLevel,
        );
        if (scoped.deniedReason) {
          return {
            status: 'denied',
            summary: scoped.deniedReason,
            content: scoped.deniedReason,
            retryable: false,
            metadata: { permissionLevel: settings.permissionLevel },
          };
        }
        const resolvedArguments = resolveCredentialReferences(scoped.argumentsValue, this.options.resolveCredential);
        const result = await this.service.execute(
          definition.name,
          resolvedArguments,
          settings,
          context.signal,
        );
        if (context.signal.aborted) throw context.signal.reason || new Error('Tool execution cancelled');
        return {
          status: result.status,
          summary: result.summary,
          content: result.output,
          retryable: false,
          metadata: { permissionLevel: settings.permissionLevel },
        };
      },
    });
  }
}

function policyForTool(
  definition: ComputerToolDefinition,
  argumentsValue: Record<string, unknown>,
): AgentToolPolicyDescriptor {
  const confirmation = buildToolConfirmation(definition.name, definition.label, argumentsValue);
  const base = capabilityForLevel(definition.minimumLevel);
  const riskLevel: AgentRiskLevel = definition.name === 'delete_path'
    ? 'critical'
    : confirmation
      ? 'high'
      : definition.minimumLevel === 'read'
        ? 'low'
        : 'medium';
  return {
    capability: base.capability,
    access: base.access,
    riskLevel,
    approval: confirmation ? 'always' : 'risk_based',
    reason: confirmation?.explanation || `${definition.label}，在“${permissionLabel(definition.minimumLevel)}”权限档内执行`,
  };
}

function capabilityForLevel(level: Exclude<ToolPermissionLevel, 'off'>): {
  capability: string;
  access: AgentCapabilityAccess;
} {
  if (level === 'read') return { capability: 'computer.read', access: 'read' };
  if (level === 'files') return { capability: 'computer.files', access: 'write' };
  return { capability: 'computer.execute', access: 'execute' };
}

function schemaFromSignature(signature: string): Record<string, unknown> {
  const match = signature.match(/^[A-Za-z0-9_-]+\((.*)\)$/);
  if (!match) throw new Error(`Invalid computer tool signature: ${signature}`);
  const parameters = match[1].trim()
    ? match[1].split(',').map(item => item.trim()).filter(Boolean)
    : [];
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const parameter of parameters) {
    const optional = parameter.endsWith('?');
    const name = optional ? parameter.slice(0, -1) : parameter;
    properties[name] = schemaForArgument(name);
    if (!optional) required.push(name);
  }
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

function schemaForArgument(name: string): Record<string, unknown> {
  if (BOOLEAN_ARGUMENTS.has(name)) return { type: 'boolean' };
  if (INTEGER_ARGUMENTS.has(name)) return { type: 'integer' };
  if (name === 'timeout_seconds') return { type: 'number', minimum: 0.1 };
  if (name === 'patterns' || name === 'args') return { type: 'array', items: { type: 'string' }, maxItems: 1_000 };
  if (name === 'headers') return { type: 'object', additionalProperties: { type: 'string' } };
  if (name === 'mode') return { type: 'string', enum: ['overwrite', 'append'] };
  if (name === 'encoding') return { type: 'string', enum: ['utf8', 'base64'] };
  if (name === 'shell') return {
    type: 'string',
    enum: process.platform === 'win32' ? ['powershell', 'cmd'] : ['bash'],
  };
  if (name === 'method') return { type: 'string', minLength: 1, maxLength: 16 };
  return { type: 'string' };
}

function timeoutForTool(name: string, settings: ToolSettings): number {
  if (name === 'run_command' || name.startsWith('terminal_')) {
    return Math.max(1_000, Math.min(10 * 60_000, Math.round(settings.commandTimeoutSeconds * 1_000) + 5_000));
  }
  return 60_000;
}

function capExecutionArguments(
  toolName: string,
  argumentsValue: Record<string, unknown>,
  settings: ToolSettings,
): Record<string, unknown> {
  const output = structuredClone(argumentsValue);
  if (['run_command', 'http_request', 'check_port'].includes(toolName) && output.timeout_seconds !== undefined) {
    const requested = Number(output.timeout_seconds);
    if (Number.isFinite(requested)) output.timeout_seconds = Math.min(requested, settings.commandTimeoutSeconds);
  }
  return output;
}

const PATH_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  file_info: ['path'],
  list_directory: ['path'],
  read_file: ['path'],
  search_files: ['root'],
  search_text: ['root'],
  write_file: ['path'],
  replace_in_file: ['path'],
  make_directory: ['path'],
  copy_path: ['source', 'destination'],
  move_path: ['source', 'destination'],
  move_matching_files: ['source_directory', 'destination_directory'],
  delete_path: ['path'],
  run_command: ['cwd'],
  terminal_start: ['cwd'],
  launch_program: ['cwd'],
  open_path: ['path'],
};

const WORKSPACE_MUTATIONS = new Set([
  'write_file',
  'replace_in_file',
  'make_directory',
  'copy_path',
  'move_path',
  'move_matching_files',
  'delete_path',
]);

/**
 * Turns the folder shown in execute mode into real tool semantics. Relative paths
 * and an omitted cwd use the first registered root. The files tier is a workspace
 * tier: it cannot mutate an arbitrary absolute path merely because the model named
 * one. Full access remains explicit and may leave the workspace.
 */
function scopeExecutionArguments(
  definition: ComputerToolDefinition,
  argumentsValue: Record<string, unknown>,
  workspaceRoots: string[],
  permissionLevel: ToolPermissionLevel,
): { argumentsValue: Record<string, unknown>; deniedReason?: string } {
  const output = structuredClone(argumentsValue);
  const roots = workspaceRoots.map(root => path.resolve(root));
  const base = roots[0];
  if (base && ['run_command', 'terminal_start', 'launch_program'].includes(definition.name) && !String(output.cwd || '').trim()) {
    output.cwd = base;
  }
  for (const key of PATH_ARGUMENTS[definition.name] ?? []) {
    const value = typeof output[key] === 'string' ? String(output[key]).trim() : '';
    if (!value || /^https?:\/\//i.test(value)) continue;
    output[key] = path.isAbsolute(value) ? path.normalize(value) : path.resolve(base || resolveDefaultBase(), value);
  }
  if (permissionLevel !== 'full' && WORKSPACE_MUTATIONS.has(definition.name)) {
    if (roots.length === 0) {
      return { argumentsValue: output, deniedReason: '请先选择工作文件夹；工作区文件权限不会在未指定目录时写入或删除。' };
    }
    const outside = (PATH_ARGUMENTS[definition.name] ?? [])
      .map(key => typeof output[key] === 'string' ? output[key] as string : '')
      .filter(Boolean)
      .find(candidate => !roots.some(root => isPathInside(root, candidate)));
    if (outside) {
      return {
        argumentsValue: output,
        deniedReason: `这一步超出当前工作区权限，没有执行：${outside}`,
      };
    }
  }
  return { argumentsValue: output };
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveDefaultBase(): string {
  return process.env.USERPROFILE || process.env.HOME || process.cwd();
}

function resolveCredentialReferences(
  argumentsValue: Record<string, unknown>,
  resolver: ComputerAgentToolBridgeOptions['resolveCredential'],
): Record<string, unknown> {
  if (!resolver || !isStringRecord(argumentsValue.headers)) return argumentsValue;
  const output = structuredClone(argumentsValue);
  const headers = output.headers as Record<string, string>;
  for (const [name, value] of Object.entries(headers)) {
    headers[name] = value.replace(/credential:\/\/[a-z0-9][a-z0-9._-]{1,63}/gi, reference => {
      const secret = resolver(reference);
      if (!secret) throw new Error(`安全凭据不可用：${reference}`);
      return secret;
    });
  }
  return output;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every(item => typeof item === 'string');
}

const PAYLOAD_ARGUMENTS = ['content', 'body', 'old_text', 'new_text'] as const;
const PREVIEW_CHARS = 1_200;

/**
 * What a step and an approval keep of a call. File and request payloads are
 * reduced to their size. Everything a person has to see to approve the call stays
 * readable - the command, the terminal input, the path, the address - with only
 * secrets masked (ATH-SEC-009). Terminal input used to be hidden with the payloads,
 * which meant approving a terminal_write without seeing the command it typed.
 */
function redactComputerArguments(argumentsValue: Record<string, unknown>): Record<string, unknown> {
  const output = structuredClone(argumentsValue);
  for (const [key, value] of Object.entries(output)) {
    if ((PAYLOAD_ARGUMENTS as readonly string[]).includes(key) && typeof value === 'string') {
      output[key] = `[CONTENT_REDACTED chars=${value.length}]`;
    } else if (typeof value === 'string') {
      output[key] = redactInlineSecrets(value);
    } else if (Array.isArray(value)) {
      output[key] = value.map(item => (typeof item === 'string' ? redactInlineSecrets(item) : item));
    }
  }
  if (output.headers && typeof output.headers === 'object' && !Array.isArray(output.headers)) {
    output.headers = Object.fromEntries(Object.entries(output.headers as Record<string, unknown>).map(([key, value]) => [
      key,
      /authorization|cookie|api[_-]?key|token|secret/i.test(key) ? '[REDACTED]' : value,
    ]));
  }
  return output;
}

function previewComputerArguments(argumentsValue: Record<string, unknown>): Record<string, AgentToolArgumentPreview> {
  const preview: Record<string, AgentToolArgumentPreview> = {};
  for (const key of PAYLOAD_ARGUMENTS) {
    const value = argumentsValue[key];
    if (typeof value !== 'string') continue;
    if (key === 'content' && argumentsValue.encoding === 'base64') {
      preview[key] = { text: `（base64 编码的二进制内容，${value.length} 字符）`, totalChars: value.length };
      continue;
    }
    preview[key] = { text: redactInlineSecrets(value.slice(0, PREVIEW_CHARS)), totalChars: value.length };
  }
  return preview;
}
