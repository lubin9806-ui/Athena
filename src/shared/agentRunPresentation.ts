/**
 * How a durable run's steps and approvals read to a person.
 *
 * Shared by the main process (the chat note after a run) and the renderer (the
 * execution centre and the approval card), so both describe the same call the same
 * way. Everything here works from persisted records only: an approval that has sat
 * overnight must still say exactly what it is asking to do.
 */

interface PresentableStep {
  kind: string;
  title: string;
  status: string;
  input: Record<string, unknown>;
  error?: string | null;
}

interface PresentableApproval {
  id: string;
  capability: string;
  riskLevel: string;
  request: Record<string, unknown>;
}

interface PresentableEvent {
  type: string;
  payload: Record<string, unknown>;
}

export interface AgentApprovalField {
  label: string;
  value: string;
  /** Commands, paths and payloads keep their exact characters and wrap as code. */
  code: boolean;
}

export type AgentApprovalViewKind = 'tool_call' | 'uncertain_replay' | 'model_retry' | 'budget_extension';

export interface AgentApprovalView {
  id: string;
  kind: AgentApprovalViewKind;
  toolName: string;
  title: string;
  riskLevel: string;
  riskLabel: string;
  explanation: string;
  fields: AgentApprovalField[];
  approveLabel: string;
  denyLabel: string;
}

export interface AgentRunFailureView {
  message: string;
  detail: string;
  kind: string;
  code: string;
}

const TARGET_CHARS = 160;
const FIELD_CHARS = 4_000;

const RISK_LABELS: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '极高风险',
};

const STEP_STATUS_LABELS: Record<string, string> = {
  pending: '待执行',
  running: '执行中',
  waiting: '等待审批',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  skipped: '未执行',
};

const ARGUMENT_LABELS: Record<string, string> = {
  command: '命令',
  program: '程序',
  args: '参数',
  session_id: '终端会话',
  input: '写入终端的内容',
  shell: '终端类型',
  cwd: '工作目录',
  url: '地址',
  method: '请求方法',
  headers: '请求头',
  body: '请求正文',
  host: '主机',
  port: '端口',
  path: '路径',
  source: '源路径',
  destination: '目标路径',
  source_directory: '源目录',
  destination_directory: '目标目录',
  mode: '写入方式',
  encoding: '编码',
  content: '写入内容',
  old_text: '被替换的原文',
  new_text: '替换为',
  replace_all: '替换全部匹配',
  overwrite: '覆盖已有目标',
  recursive: '包含子目录',
  file_type: '文件类型',
  patterns: '匹配规则',
  conflict_strategy: '重名处理',
  append_newline: '自动回车',
  wait_ms: '等待输出（毫秒）',
  timeout_seconds: '超时（秒）',
  max_chars: '最多读取字符',
};

const ARGUMENT_ORDER = Object.keys(ARGUMENT_LABELS);

const CODE_ARGUMENTS = new Set([
  'command', 'program', 'args', 'input', 'cwd', 'url', 'headers', 'body', 'path', 'source', 'destination',
  'source_directory', 'destination_directory', 'content', 'old_text', 'new_text', 'patterns', 'session_id',
]);

/** Tools that start a process: a missing cwd is itself something to show. */
const PROCESS_TOOLS = new Set(['run_command', 'terminal_start', 'launch_program']);

export function agentRiskLabel(level: string): string {
  return RISK_LABELS[level] || level;
}

export function agentStepStatusLabel(status: string): string {
  return STEP_STATUS_LABELS[status] || status;
}

export function agentToolLabel(step: Pick<PresentableStep, 'title' | 'input'>): string {
  const label = typeof step.input.toolLabel === 'string' ? step.input.toolLabel.trim() : '';
  if (label) return label;
  const name = typeof step.input.toolName === 'string' ? step.input.toolName : '';
  return name || step.title;
}

/** The one thing a call acts on: the command, the path, the address. */
export function describeAgentToolTarget(argumentsValue: unknown): string {
  const args = isRecord(argumentsValue) ? argumentsValue : {};
  const text = (value: unknown): string => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');
  let target = '';
  if (text(args.command)) {
    target = text(args.command);
  } else if (text(args.session_id) && text(args.input)) {
    target = `${text(args.session_id)} ← ${text(args.input)}`;
  } else if (text(args.program)) {
    target = [text(args.program), ...(Array.isArray(args.args) ? args.args.map(text) : [])].join(' ');
  } else if (text(args.url)) {
    target = `${text(args.method) ? `${text(args.method).toUpperCase()} ` : ''}${text(args.url)}`;
  } else if (text(args.source) && text(args.destination)) {
    target = `${text(args.source)} → ${text(args.destination)}`;
  } else if (text(args.source_directory) && text(args.destination_directory)) {
    target = `${text(args.source_directory)} → ${text(args.destination_directory)}`;
  } else if (text(args.path)) {
    target = text(args.path);
  } else if (text(args.host)) {
    target = `${text(args.host)}${text(args.port) ? `:${text(args.port)}` : ''}`;
  } else if (text(args.root)) {
    const detail = text(args.pattern) || text(args.query);
    target = `${text(args.root)}${detail ? ` · ${detail}` : ''}`;
  } else {
    target = text(args.query) || text(args.name) || text(args.session_id)
      || text(Object.values(args).find(value => typeof value === 'string' && value.trim()));
  }
  return clip(target, TARGET_CHARS);
}

export function describeAgentToolStep(step: Pick<PresentableStep, 'title' | 'input'>): string {
  const target = describeAgentToolTarget(step.input.arguments);
  const label = agentToolLabel(step);
  return target ? `${label} · ${target}` : label;
}

export function presentAgentApproval(approval: PresentableApproval): AgentApprovalView {
  const request = isRecord(approval.request) ? approval.request : {};
  if (request.kind === 'model_retry') return presentModelRetry(approval.id, request);
  if (request.kind === 'budget_extension') return presentBudgetExtension(approval.id, request);

  const toolName = typeof request.toolName === 'string' ? request.toolName : '';
  const label = (typeof request.toolLabel === 'string' && request.toolLabel.trim()) || toolName || approval.capability;
  const args = isRecord(request.arguments) ? request.arguments : {};
  const preview = isRecord(request.preview) ? request.preview : {};
  const fields = toolArgumentFields(toolName, args, preview);
  if (request.kind === 'uncertain_replay') {
    return {
      id: approval.id,
      kind: 'uncertain_replay',
      toolName,
      title: `上次中断时正在执行：${label}`,
      riskLevel: approval.riskLevel,
      riskLabel: agentRiskLabel(approval.riskLevel),
      explanation: 'Athena 上次退出时这一步正在执行，无法确认它是否已经生效。重新执行可能会让效果重复发生。',
      fields,
      approveLabel: '重新执行',
      denyLabel: '跳过这一步',
    };
  }
  return {
    id: approval.id,
    kind: 'tool_call',
    toolName,
    title: label,
    riskLevel: approval.riskLevel,
    riskLabel: agentRiskLabel(approval.riskLevel),
    explanation: cleanPolicyExplanation(request.explanation),
    fields,
    approveLabel: '批准',
    denyLabel: '拒绝',
  };
}

/** The last recorded reason a run failed, as written for a person. */
export function readAgentRunFailure(events: readonly PresentableEvent[]): AgentRunFailureView | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== 'runner.failed') continue;
    const payload = isRecord(event.payload) ? event.payload : {};
    const detail = typeof payload.error === 'string' ? payload.error : '';
    const message = typeof payload.message === 'string' && payload.message.trim() ? payload.message : detail;
    if (!message) return null;
    return {
      message,
      detail,
      kind: typeof payload.failureKind === 'string' ? payload.failureKind : '',
      code: typeof payload.failureCode === 'string' ? payload.failureCode : '',
    };
  }
  return null;
}

/** Short names for why a model request stopped the run; the card's explanation carries the rest. */
export function agentModelFailureHeadline(kind: unknown): string {
  if (kind === 'connection') return '模型服务中断';
  if (kind === 'timeout') return '模型服务没有响应';
  if (kind === 'protocol') return '模型的输出无法执行';
  if (kind === 'auth') return '模型服务拒绝了凭据';
  if (kind === 'rate_limit') return '模型服务限流';
  return '模型请求失败';
}

function presentModelRetry(id: string, request: Record<string, unknown>): AgentApprovalView {
  const failure = isRecord(request.failure) ? request.failure : {};
  const message = typeof failure.message === 'string' && failure.message.trim() ? failure.message : '模型请求失败。';
  const detail = typeof failure.detail === 'string' ? failure.detail : '';
  const fields: AgentApprovalField[] = [
    { label: '已保留的进度', value: `${integer(request.round)} 轮模型调用 · ${integer(request.completedToolSteps)} 个工具步骤已完成`, code: false },
    { label: '已自动尝试', value: `${Math.max(1, integer(request.attempts))} 次`, code: false },
  ];
  if (detail) fields.push({ label: '技术细节', value: clip(detail, FIELD_CHARS), code: true });
  return {
    id,
    kind: 'model_retry',
    toolName: '',
    title: `${agentModelFailureHeadline(failure.kind)}，任务已暂停`,
    riskLevel: 'low',
    riskLabel: '',
    explanation: message,
    fields,
    approveLabel: '从检查点重试',
    denyLabel: '结束任务',
  };
}

function presentBudgetExtension(id: string, request: Record<string, unknown>): AgentApprovalView {
  const used = isRecord(request.used) ? request.used : {};
  const extension = isRecord(request.extension) ? request.extension : {};
  const fields: AgentApprovalField[] = [
    { label: '已用', value: `${integer(used.modelRounds)} 轮模型调用 · ${integer(used.toolCalls)} 次工具调用`, code: false },
    { label: '继续后追加', value: `${integer(extension.modelRounds)} 轮模型调用 · ${integer(extension.toolCalls)} 次工具调用`, code: false },
  ];
  const pending = integer(request.pendingToolCalls);
  if (pending > 0) {
    fields.push({ label: '已提出、尚未执行', value: `${pending} 个工具调用（继续后仍按审批规则逐项处理）`, code: false });
  }
  return {
    id,
    kind: 'budget_extension',
    toolName: '',
    title: '这一轮的执行预算用完了',
    riskLevel: 'low',
    riskLabel: '',
    explanation: request.reason === 'tool_calls'
      ? '工具调用次数到达本轮上限。为了不让任务无限运行，到上限时会先停下来问你。'
      : '模型调用轮次到达本轮上限。为了不让任务无限运行，到上限时会先停下来问你。',
    fields,
    approveLabel: '继续执行',
    denyLabel: '停止并总结',
  };
}

function toolArgumentFields(
  toolName: string,
  args: Record<string, unknown>,
  preview: Record<string, unknown>,
): AgentApprovalField[] {
  const keys = [
    ...ARGUMENT_ORDER.filter(key => key in args),
    ...Object.keys(args).filter(key => !(key in ARGUMENT_LABELS)).sort(),
  ];
  const fields: AgentApprovalField[] = [];
  for (const key of keys) {
    fields.push({
      label: ARGUMENT_LABELS[key] || key,
      value: formatArgument(key, args[key], preview[key]),
      code: CODE_ARGUMENTS.has(key),
    });
  }
  if (PROCESS_TOOLS.has(toolName) && !textValue(args.cwd)) {
    fields.push({ label: '工作目录', value: '未指定（在当前用户的主目录运行）', code: false });
  }
  if (toolName === 'write_file' && args.mode === undefined) {
    fields.push({ label: '写入方式', value: '覆盖（默认）', code: false });
  }
  if (toolName === 'copy_path' && args.overwrite === undefined) {
    fields.push({ label: '覆盖已有目标', value: '是（默认）', code: false });
  }
  if (toolName === 'http_request' && args.method === undefined) {
    fields.push({ label: '请求方法', value: 'GET（默认）', code: false });
  }
  return fields;
}

function formatArgument(key: string, value: unknown, preview: unknown): string {
  if (isRecord(preview) && typeof preview.text === 'string') {
    const total = integer(preview.totalChars);
    const shown = preview.text.length;
    const header = total > shown ? `（共 ${total} 字符，以下是前 ${shown} 字符）\n` : '';
    return `${header}${preview.text}`;
  }
  if (key === 'mode') return value === 'append' ? '追加到文件末尾' : value === 'overwrite' ? '覆盖' : String(value);
  if (typeof value === 'string') {
    const redacted = value.match(/^\[CONTENT[_ ]REDACTED chars=(\d+)\]$/);
    if (redacted) return `（共 ${redacted[1]} 字符，内容未保存预览）`;
    return clip(value, FIELD_CHARS);
  }
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return clip(value.map(item => (typeof item === 'string' ? item : JSON.stringify(item))).join(' '), FIELD_CHARS);
  if (isRecord(value)) {
    return clip(Object.entries(value).map(([name, item]) => `${name}: ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n'), FIELD_CHARS);
  }
  return value === null || value === undefined ? '' : String(value);
}

/** Older records carry an English clause the policy engine used to append. */
function cleanPolicyExplanation(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  return text.replace(/;\s*explicit approval is required for [a-z]+-risk access\s*$/i, '').trim();
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function integer(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function clip(value: string, maxChars: number): string {
  const compact = maxChars <= TARGET_CHARS ? value.replace(/\s+/g, ' ').trim() : value;
  return compact.length <= maxChars ? compact : `${compact.slice(0, maxChars - 1)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
