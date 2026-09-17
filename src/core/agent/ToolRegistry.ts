import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import type { AgentCapabilityAccess, AgentRiskLevel } from '../../shared/types';
import type { JsonSchema, ModelToolCall, ModelToolDefinition } from '../ai/model';

export type AgentToolExecutionStatus = 'completed' | 'failed' | 'denied' | 'cancelled';
export type AgentToolApprovalMode = 'never' | 'risk_based' | 'always';

export interface AgentToolPolicyDescriptor {
  capability: string;
  access: AgentCapabilityAccess;
  riskLevel: AgentRiskLevel;
  approval: AgentToolApprovalMode;
  reason: string;
  /**
   * Asked for every time, even when the person has turned approvals off.
   *
   * Reserved for dedicated requests for API keys, tokens, passwords and other
   * secret material. Ordinary computer actions are covered by continuous mode.
   */
  alwaysAsk?: boolean;
}

export interface AgentToolRetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

export interface AgentToolExecutionContext {
  runId: string;
  stepId: string;
  callId: string;
  attempt: number;
  idempotencyKey: string;
  signal: AbortSignal;
}

export interface AgentToolExecutionResult {
  status: AgentToolExecutionStatus;
  summary: string;
  content: string;
  metadata?: Record<string, unknown>;
  retryable?: boolean;
  validations?: Array<{
    id: string;
    status: 'passed' | 'failed';
    evidence: string;
  }>;
}

export interface AgentToolRegistration {
  name: string;
  version: string;
  capability: string;
  label: string;
  description: string;
  parameters: JsonSchema;
  strict?: boolean;
  idempotent: boolean;
  supportsIdempotencyKey?: boolean;
  timeoutMs?: number;
  retry?: Partial<AgentToolRetryPolicy>;
  policy: AgentToolPolicyDescriptor | ((argumentsValue: Record<string, unknown>) => AgentToolPolicyDescriptor);
  redactArguments?: (argumentsValue: Record<string, unknown>) => Record<string, unknown>;
  /**
   * Bounded excerpts of payload arguments that `redactArguments` hides, shown only
   * on an approval card so the person can see what they are agreeing to write.
   */
  previewArguments?: (argumentsValue: Record<string, unknown>) => Record<string, AgentToolArgumentPreview>;
  execute: (
    argumentsValue: Record<string, unknown>,
    context: AgentToolExecutionContext,
  ) => Promise<AgentToolExecutionResult>;
}

export interface AgentToolArgumentPreview {
  text: string;
  totalChars: number;
}

export interface ResolvedAgentTool {
  definition: Readonly<AgentToolRegistration>;
  policy: AgentToolPolicyDescriptor;
  retry: AgentToolRetryPolicy;
  persistedArguments: Record<string, unknown>;
  approvalPreview: Record<string, AgentToolArgumentPreview>;
}

interface RegisteredTool {
  definition: Readonly<AgentToolRegistration>;
  validate: ValidateFunction<Record<string, unknown>>;
  retry: AgentToolRetryPolicy;
}

export class AgentToolRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentToolRegistrationError';
  }
}

export class AgentToolNotFoundError extends Error {
  constructor(name: string) {
    super(`Agent tool is not registered: ${name}`);
    this.name = 'AgentToolNotFoundError';
  }
}

export class AgentToolArgumentsError extends Error {
  constructor(name: string, errors: ErrorObject[] | null | undefined) {
    const details = (errors || [])
      .slice(0, 8)
      .map(error => `${error.instancePath || '/'} ${error.message || 'is invalid'}`)
      .join('; ');
    super(`Invalid arguments for tool ${name}${details ? `: ${details}` : ''}`);
    this.name = 'AgentToolArgumentsError';
  }
}

export class AgentToolRetryableError extends Error {
  constructor(message: string, readonly retryable = true) {
    super(message);
    this.name = 'AgentToolRetryableError';
  }
}

export class ToolRegistry {
  private readonly ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
  private readonly tools = new Map<string, RegisteredTool>();

  register(input: AgentToolRegistration): Readonly<AgentToolRegistration> {
    const name = normalizeToolName(input.name);
    if (this.tools.has(name)) throw new AgentToolRegistrationError(`Duplicate agent tool: ${name}`);
    const label = requireText(input.label, 'Tool label', 160);
    const version = requireText(input.version, 'Tool version', 80);
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(version)) {
      throw new AgentToolRegistrationError(`Tool ${name} has an invalid version`);
    }
    const capability = String(input.capability || '').trim();
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(capability)) {
      throw new AgentToolRegistrationError(`Tool ${name} has an invalid capability id`);
    }
    const description = requireText(input.description, 'Tool description', 2_000);
    const parameters = deepFreeze(cloneJsonSchema(input.parameters));
    if (parameters.type !== 'object') {
      throw new AgentToolRegistrationError(`Tool ${name} parameters must use a top-level object schema`);
    }
    let validate: ValidateFunction<Record<string, unknown>>;
    try {
      validate = this.ajv.compile<Record<string, unknown>>(parameters);
    } catch (error) {
      throw new AgentToolRegistrationError(`Invalid JSON Schema for tool ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const retry = Object.freeze(normalizeRetryPolicy(input.retry));
    const timeoutMs = clampInteger(input.timeoutMs, 250, 10 * 60_000, 60_000);
    const definition = Object.freeze({
      ...input,
      name,
      version,
      capability,
      label,
      description,
      parameters,
      strict: input.strict === true,
      supportsIdempotencyKey: input.supportsIdempotencyKey === true,
      timeoutMs,
      retry,
      policy: typeof input.policy === 'function' ? input.policy : deepFreeze({ ...input.policy }),
    });
    if (typeof definition.policy !== 'function') {
      const policy = resolvePolicy(definition.policy, {});
      validatePolicy(policy, name);
      assertPolicyCapability(name, capability, policy.capability);
    }
    this.tools.set(name, { definition, validate, retry });
    return definition;
  }

  unregister(name: string, expectedDefinition?: Readonly<AgentToolRegistration>): boolean {
    const normalized = name.trim();
    const current = this.tools.get(normalized);
    if (!current || (expectedDefinition && current.definition !== expectedDefinition)) return false;
    return this.tools.delete(normalized);
  }

  has(name: string): boolean {
    return this.tools.has(name.trim());
  }

  list(): ReadonlyArray<Readonly<AgentToolRegistration>> {
    return Array.from(this.tools.values(), item => item.definition)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  getModelDefinitions(names?: readonly string[]): ModelToolDefinition[] {
    const allowed = names ? new Set(names.map(name => name.trim())) : null;
    return this.list()
      .filter(tool => !allowed || allowed.has(tool.name))
      .map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: cloneJsonSchema(tool.parameters),
        strict: tool.strict === true,
      }));
  }

  getModelDefinitionsForCapabilities(capabilities: readonly string[]): ModelToolDefinition[] {
    const allowed = new Set(capabilities.map(item => item.trim()).filter(Boolean));
    return this.list()
      .filter(tool => allowed.has(tool.capability))
      .map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: cloneJsonSchema(tool.parameters),
        strict: tool.strict === true,
      }));
  }

  resolve(call: ModelToolCall): ResolvedAgentTool {
    const registered = this.tools.get(call.name);
    if (!registered) throw new AgentToolNotFoundError(call.name);
    if (!registered.validate(call.arguments)) {
      throw new AgentToolArgumentsError(call.name, registered.validate.errors);
    }
    const policy = resolvePolicy(registered.definition.policy, call.arguments);
    validatePolicy(policy, call.name);
    assertPolicyCapability(call.name, registered.definition.capability, policy.capability);
    const persistedArguments = registered.definition.redactArguments
      ? registered.definition.redactArguments(structuredClone(call.arguments))
      : redactSensitiveValues(call.arguments);
    assertJsonSerializable(persistedArguments, `Persisted arguments for tool ${call.name}`);
    return {
      definition: registered.definition,
      policy,
      retry: registered.retry,
      persistedArguments,
      approvalPreview: normalizeArgumentPreview(registered.definition.previewArguments?.(structuredClone(call.arguments))),
    };
  }

  async execute(
    call: ModelToolCall,
    context: AgentToolExecutionContext,
  ): Promise<AgentToolExecutionResult> {
    const resolved = this.resolve(call);
    return this.executeResolved(call, resolved, context);
  }

  async executeResolved(
    call: ModelToolCall,
    resolved: ResolvedAgentTool,
    context: AgentToolExecutionContext,
  ): Promise<AgentToolExecutionResult> {
    const current = this.tools.get(call.name);
    if (!current || current.definition !== resolved.definition) {
      throw new AgentToolNotFoundError(`${call.name} (registration changed before execution)`);
    }
    const result = await resolved.definition.execute(structuredClone(call.arguments), context);
    return normalizeExecutionResult(call.name, result);
  }
}

function assertPolicyCapability(toolName: string, registered: string, resolved: string): void {
  if (registered !== resolved) {
    throw new AgentToolRegistrationError(`Tool ${toolName} changed capability from ${registered} to ${resolved}`);
  }
}

function resolvePolicy(
  value: AgentToolRegistration['policy'],
  argumentsValue: Record<string, unknown>,
): AgentToolPolicyDescriptor {
  const resolved = typeof value === 'function' ? value(structuredClone(argumentsValue)) : value;
  return {
    capability: String(resolved.capability || '').trim(),
    access: resolved.access,
    riskLevel: resolved.riskLevel,
    approval: resolved.approval,
    reason: String(resolved.reason || '').trim(),
    ...(resolved.alwaysAsk === true ? { alwaysAsk: true } : {}),
  };
}

function validatePolicy(policy: AgentToolPolicyDescriptor, toolName: string): void {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(policy.capability)) {
    throw new AgentToolRegistrationError(`Tool ${toolName} has an invalid capability id`);
  }
  if (!['read', 'write', 'execute', 'network', 'account'].includes(policy.access)) {
    throw new AgentToolRegistrationError(`Tool ${toolName} has an invalid capability access`);
  }
  if (!['low', 'medium', 'high', 'critical'].includes(policy.riskLevel)) {
    throw new AgentToolRegistrationError(`Tool ${toolName} has an invalid risk level`);
  }
  if (!['never', 'risk_based', 'always'].includes(policy.approval)) {
    throw new AgentToolRegistrationError(`Tool ${toolName} has an invalid approval mode`);
  }
  if (!policy.reason) throw new AgentToolRegistrationError(`Tool ${toolName} must explain its policy`);
}

function normalizeExecutionResult(name: string, value: AgentToolExecutionResult): AgentToolExecutionResult {
  if (!value || !['completed', 'failed', 'denied'].includes(value.status)) {
    throw new Error(`Tool ${name} returned an invalid execution status`);
  }
  const result = {
    status: value.status,
    summary: requireText(value.summary, `Tool ${name} summary`, 2_000),
    content: String(value.content ?? '').slice(0, 200_000),
    metadata: value.metadata ? structuredClone(value.metadata) : undefined,
    retryable: value.retryable === true,
    validations: normalizeValidations(value.validations),
  };
  if (result.metadata) assertJsonSerializable(result.metadata, `Tool ${name} metadata`);
  return result;
}

function normalizeValidations(value: AgentToolExecutionResult['validations']): AgentToolExecutionResult['validations'] {
  if (!value) return undefined;
  const ids = new Set<string>();
  return value.slice(0, 100).map((item) => {
    const id = String(item?.id || '').trim();
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(id)) throw new Error(`Invalid tool validation id: ${id || '<empty>'}`);
    if (ids.has(id)) throw new Error(`Duplicate tool validation result: ${id}`);
    ids.add(id);
    if (item.status !== 'passed' && item.status !== 'failed') throw new Error(`Invalid validation status for ${id}`);
    return { id, status: item.status, evidence: String(item.evidence || '').trim().slice(0, 4_000) };
  });
}

function normalizeRetryPolicy(input: Partial<AgentToolRetryPolicy> | undefined): AgentToolRetryPolicy {
  const maxAttempts = clampInteger(input?.maxAttempts, 1, 5, 1);
  const initialDelayMs = clampInteger(input?.initialDelayMs, 0, 30_000, 250);
  return {
    maxAttempts,
    initialDelayMs,
    maxDelayMs: clampInteger(input?.maxDelayMs, initialDelayMs, 120_000, Math.max(initialDelayMs, 4_000)),
  };
}

function normalizeToolName(value: string): string {
  const name = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(name)) throw new AgentToolRegistrationError(`Invalid agent tool name: ${name || '<empty>'}`);
  return name;
}

function cloneJsonSchema(value: JsonSchema): JsonSchema {
  assertJsonSerializable(value, 'Tool JSON Schema');
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function assertJsonSerializable(value: unknown, label: string): void {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('value is undefined');
    JSON.parse(serialized);
  } catch (error) {
    throw new AgentToolRegistrationError(`${label} must be JSON-serializable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeArgumentPreview(value: unknown): Record<string, AgentToolArgumentPreview> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output: Record<string, AgentToolArgumentPreview> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 8)) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (typeof record.text !== 'string') continue;
    output[key] = {
      text: record.text.slice(0, 2_000),
      totalChars: clampInteger(record.totalChars, 0, Number.MAX_SAFE_INTEGER, record.text.length),
    };
  }
  return output;
}

function redactSensitiveValues(value: Record<string, unknown>): Record<string, unknown> {
  return redactValue(value, '', 0) as Record<string, unknown>;
}

function redactValue(value: unknown, key: string, depth: number): unknown {
  if (/authorization|cookie|password|passwd|passphrase|secret|token|api[_-]?key|credential|private[_-]?key/i.test(key)) {
    return '[REDACTED]';
  }
  if (depth >= 8) return '[DEPTH_LIMIT]';
  if (Array.isArray(value)) return value.slice(0, 200).map(item => redactValue(item, key, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, 500)
      .map(([childKey, childValue]) => [childKey, redactValue(childValue, childKey, depth + 1)]));
  }
  return value;
}

function requireText(value: unknown, label: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new AgentToolRegistrationError(`${label} is required`);
  return text.slice(0, maxLength);
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? Math.round(number) : fallback));
}
