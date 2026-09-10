import { ModelCapabilityError, ModelProtocolError, ModelTimeoutError } from './model';

export type ModelFailureKind =
  | 'protocol'
  | 'timeout'
  | 'cancelled'
  | 'connection'
  | 'auth'
  | 'rate_limit'
  | 'capability'
  | 'passthrough';

export interface ClassifiedModelFailure {
  kind: ModelFailureKind;
  /** Shown to the user. Never contains a provider payload, JSON fragment or stack. */
  message: string;
  /** Stable identifier for logs and diagnostics. */
  code: string;
  /** Whether repeating the same request could plausibly succeed. */
  retryable: boolean;
  /** Redacted technical text for logs only. */
  detail: string;
}

const MAX_DETAIL_CHARS = 400;

/**
 * Turns a thrown model error into something a person can act on.
 *
 * Messages that were already written for the user — consent prompts, capability
 * explanations, product rules — are passed through, because replacing them with a
 * generic sentence would lose real guidance. Only the machine-facing categories are
 * rewritten, which is where raw parser text used to reach the chat (ATH-CHAT-003).
 */
export function classifyModelFailure(error: unknown): ClassifiedModelFailure {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const detail = redactModelFailureDetail(raw);

  // Timeouts are checked first because the platform words them as "The operation
  // was aborted due to timeout", which the cancellation test below would otherwise
  // read as the user having pressed stop.
  if (isTimeout(error)) {
    return {
      kind: 'timeout',
      code: 'model.timeout',
      retryable: true,
      detail,
      message: '模型服务中途没有继续返回内容，这一轮已中断。可以再发一次；如果经常这样，通常是当前模型思考太久或网络不稳。',
    };
  }
  if (isCancellation(error)) {
    return { kind: 'cancelled', code: 'model.cancelled', retryable: false, detail, message: '已停止。' };
  }
  if (error instanceof ModelProtocolError) {
    return {
      kind: 'protocol',
      code: 'model.protocol',
      retryable: true,
      detail,
      message: '模型这次返回的内容不完整，没能解析成有效的调用结构，所以本轮没有执行任何操作。可以再发一次；如果反复出现，通常说明当前模型不擅长结构化输出，换一个模型会更稳。',
    };
  }
  if (error instanceof ModelCapabilityError) {
    return { kind: 'capability', code: 'model.capability', retryable: false, detail, message: raw };
  }
  if (/\b(?:401|403)\b|authoriz|authentic|invalid[_ ]?api[_ ]?key|api key/i.test(raw)) {
    return {
      kind: 'auth',
      code: 'model.auth',
      retryable: false,
      detail,
      message: '当前模型服务拒绝了凭据。请到设置里重新填写该 Provider 的 API Key，再点一次“测试连接”。',
    };
  }
  if (/\b429\b|rate[ _-]?limit|too many requests|quota/i.test(raw)) {
    return {
      kind: 'rate_limit',
      code: 'model.rate_limit',
      retryable: true,
      detail,
      message: '模型服务当前限流或额度不足，稍等一会儿再试。',
    };
  }
  if (/timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(raw)) {
    return {
      kind: 'timeout',
      code: 'model.timeout',
      retryable: true,
      detail,
      message: '模型这次没有在超时时间内返回。可以重试；如果经常这样，可以在设置里换一个更快的模型。',
    };
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|fetch failed|network error|failed to fetch|\b5\d\d\b/i.test(raw)) {
    return {
      kind: 'connection',
      code: 'model.connection',
      retryable: true,
      detail,
      message: '连不上当前模型服务。请检查设置里的服务地址是否正确、服务是否已启动，或换一个 Provider。',
    };
  }
  return { kind: 'passthrough', code: 'model.unclassified', retryable: false, detail, message: raw || '未知错误' };
}

/** Strips anything key-shaped before an error string reaches a log. */
export function redactModelFailureDetail(value: string): string {
  return value
    .replace(/\b(?:sk|pk|api)[-_][A-Za-z0-9_-]{8,}/gi, '[REDACTED]')
    .replace(/\b[Bb]earer\s+[A-Za-z0-9._-]{8,}/g, 'Bearer [REDACTED]')
    .replace(/("?(?:api[_-]?key|authorization|token|secret)"?\s*[:=]\s*)("?)[^"',\s]{6,}\2/gi, '$1[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DETAIL_CHARS);
}

/** Only the typed cases; a message that merely says "timed out" keeps its usual precedence. */
function isTimeout(error: unknown): boolean {
  if (error instanceof ModelTimeoutError) return true;
  return (error instanceof Error ? error.name : '') === 'TimeoutError';
}

function isCancellation(error: unknown): boolean {
  if (!error) return false;
  const name = error instanceof Error ? error.name : '';
  if (name === 'AbortError' || name === 'AgentRunCancelledError') return true;
  return /aborted|cancell?ed/i.test(error instanceof Error ? error.message : String(error));
}
