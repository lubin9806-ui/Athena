import type { AgentCapabilityAccess, AgentRiskLevel, ToolPermissionLevel, ToolSettings } from '../../shared/types';
import { ToolRegistry, type AgentToolPolicyDescriptor, type AgentToolRegistration } from '../agent/ToolRegistry';
import { buildToolConfirmation } from './ToolRuntime';
import { ComputerToolService } from './ComputerTools';
import type { ComputerToolDefinition } from './ComputerToolCatalog';

export interface ComputerAgentToolBridgeOptions {
  registry: ToolRegistry;
  /**
   * Resolved for a specific run when one is executing, so the run's permission
   * ceiling can cap the current setting (ATH-SEC-005). Called without a run id when
   * only the tool catalogue is being built.
   */
  getSettings: (runId?: string) => ToolSettings;
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
      execute: async (argumentsValue, context) => {
        if (context.signal.aborted) throw context.signal.reason || new Error('Tool execution cancelled');
        // Resolved per call and per run: a permission the user revoked mid-run must
        // stop the next tool, and raising the setting again must not restore it.
        const settings = this.options.getSettings(context.runId);
        this.service.applyPermissionLevel(settings.permissionLevel);
        const result = await this.service.execute(
          definition.name,
          capExecutionArguments(definition.name, argumentsValue, settings),
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
    reason: confirmation?.explanation || `${definition.label} uses the active ${definition.minimumLevel} computer permission tier`,
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

function redactComputerArguments(argumentsValue: Record<string, unknown>): Record<string, unknown> {
  const output = structuredClone(argumentsValue);
  for (const key of ['content', 'body', 'old_text', 'new_text', 'input']) {
    if (typeof output[key] === 'string') output[key] = `[CONTENT_REDACTED chars=${String(output[key]).length}]`;
  }
  if (output.headers && typeof output.headers === 'object' && !Array.isArray(output.headers)) {
    output.headers = Object.fromEntries(Object.entries(output.headers as Record<string, unknown>).map(([key, value]) => [
      key,
      /authorization|cookie|api[_-]?key|token|secret/i.test(key) ? '[REDACTED]' : value,
    ]));
  }
  return output;
}
