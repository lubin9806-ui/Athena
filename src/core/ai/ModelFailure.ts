import { ModelCapabilityError, ModelOutputTruncatedError, ModelProtocolError, ModelTimeoutError } from './model';

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
const MAX_CHAIN_DEPTH = 6;
const MAX_CHAIN_LINKS = 12;

interface FailureLink {
  name: string;
  message: string;
  code: string;
  hostname?: string;
  address?: string;
  port?: number;
}

/**
 * Turns a thrown model error into something a person can act on.
 *
 * Messages that were already written for the user — consent prompts, capability
 * explanations, product rules — are passed through, because replacing them with a
 * generic sentence would lose real guidance. Only the machine-facing categories are
 * rewritten, which is where raw parser text used to reach the chat (ATH-CHAT-003).
 *
 * Native `fetch()` reports every transport failure as "fetch failed" (or
 * "terminated" once the body is being read) and keeps what actually happened on
 * `cause`: a DNS miss, a refused port, a reset, a TLS rejection. Those call for
 * different advice, so the cause chain's error codes are read before any text.
 * Matching the joined text instead would, for example, read undici's
 * "Connect Timeout Error" as a slow model and tell the person to pick a faster one.
 */
export function classifyModelFailure(error: unknown): ClassifiedModelFailure {
  const chain = failureChain(error);
  const top = chain[0]?.message || chain[0]?.name || '';
  const detail = describeModelFailure(error);

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
  if (error instanceof ModelOutputTruncatedError) {
    return {
      kind: 'protocol',
      code: 'model.output_truncated',
      // Retrying the same request hits the same limit; the runner raises the budget itself.
      retryable: false,
      detail,
      message: '模型的输出在写完之前就到了长度上限，这一步的调用内容不完整，没有执行。已经自动提高过输出上限；仍然不够时，可以把任务拆小，或换一个输出上限更高的模型。',
    };
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
    return { kind: 'capability', code: 'model.capability', retryable: false, detail, message: top };
  }

  const transport = classifyTransportCodes(chain);
  if (transport) return { ...transport, detail };

  const http = readHttpFailure(top);
  if (http) return { ...classifyHttpStatus(http.status, http.providerMessage), detail };

  // Errors that arrive without structure: a plain string, or a detail line that was
  // persisted earlier and is being read back. Codes written as `code=...` still count.
  const textCodes = Array.from(top.matchAll(/\b(E[A-Z]{2,}[A-Z_]*|UND_ERR_[A-Z_]+|ERR_(?:SSL|TLS|OSSL)_[A-Z0-9_]+|CERT_[A-Z_]+|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_[A-Z_]+)\b/g), match => match[1]);
  const textTransport = classifyTransportCodes(textCodes.map(code => ({ name: '', message: '', code })));
  if (textTransport) return { ...textTransport, detail };
  if (/\b(?:401|403)\b|authoriz|authentic|invalid[_ ]?api[_ ]?key|api key/i.test(top)) {
    return { ...AUTH_FAILURE, detail };
  }
  if (/\b429\b|rate[ _-]?limit|too many requests|quota/i.test(top)) {
    return { ...RATE_LIMIT_FAILURE, detail };
  }
  if (/timeout|timed out/i.test(top)) {
    return {
      kind: 'timeout',
      code: 'model.timeout',
      retryable: true,
      detail,
      message: '模型这次没有在超时时间内返回。可以重试；如果经常这样，可以在设置里换一个更快的模型。',
    };
  }
  if (/^terminated$/i.test(top.trim())) {
    return { ...RESET_FAILURE, detail };
  }
  if (/fetch failed|network error|failed to fetch|\b5\d\d\b/i.test(top)) {
    return {
      kind: 'connection',
      code: 'model.connection',
      retryable: true,
      detail,
      message: '连不上当前模型服务。请检查网络和设置里的服务地址是否正确，或换一个 Provider。',
    };
  }
  return { kind: 'passthrough', code: 'model.unclassified', retryable: false, detail, message: top || '未知错误' };
}

/**
 * Keeps the useful part of Node's nested network errors without persisting a
 * stack, request body, headers, or credentials. Native `fetch()` commonly throws
 * only "fetch failed" at the top level while the actionable code (for example
 * `ENOTFOUND`, `ECONNRESET`, or `UND_ERR_CONNECT_TIMEOUT`) lives on `cause`, and a
 * connection attempt across several addresses reports each one on `errors`.
 */
export function describeModelFailure(error: unknown): string {
  const parts: string[] = [];
  for (const link of failureChain(error)) {
    const text = [link.message || link.name, link.code ? `code=${link.code}` : ''].filter(Boolean).join(' ');
    if (text && !parts.includes(text)) parts.push(text);
  }
  return redactModelFailureDetail(parts.join(' <- ') || 'Unknown model error');
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

function failureChain(error: unknown): FailureLink[] {
  const links: FailureLink[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): void => {
    if (value === null || value === undefined || depth >= MAX_CHAIN_DEPTH || links.length >= MAX_CHAIN_LINKS) return;
    if (typeof value !== 'object') {
      const text = String(value).trim();
      if (text) links.push({ name: '', message: text, code: '' });
      return;
    }
    if (seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    links.push({
      name: typeof record.name === 'string' ? record.name : '',
      message: typeof record.message === 'string' ? record.message.trim() : '',
      code: typeof record.code === 'string' || typeof record.code === 'number' ? String(record.code) : '',
      hostname: typeof record.hostname === 'string' ? record.hostname : undefined,
      address: typeof record.address === 'string' ? record.address : undefined,
      port: typeof record.port === 'number' ? record.port : undefined,
    });
    if (Array.isArray(record.errors)) {
      for (const child of record.errors.slice(0, 3)) visit(child, depth + 1);
    }
    visit(record.cause, depth + 1);
  };
  visit(error, 0);
  return links;
}

type TransportFailure = Omit<ClassifiedModelFailure, 'detail'>;

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'EAI_NONAME', 'EAI_NODATA']);
const RESET_CODES = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED', 'ERR_STREAM_PREMATURE_CLOSE']);
const CONNECT_TIMEOUT_CODES = new Set(['UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT', 'ESOCKETTIMEDOUT']);
const RESPONSE_TIMEOUT_CODES = new Set(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
const UNREACHABLE_CODES = new Set(['ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'EHOSTDOWN']);

function isTlsCode(code: string): boolean {
  return /^(?:ERR_SSL_|ERR_TLS_|ERR_OSSL_|CERT_)/.test(code)
    || /^(?:DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_(?:VERIFY_LEAF_SIGNATURE|GET_ISSUER_CERT(?:_LOCALLY)?))$/.test(code);
}

/** Most specific first: a TLS or DNS code explains a surrounding reset, not the other way round. */
function classifyTransportCodes(chain: readonly FailureLink[]): TransportFailure | null {
  const find = (test: (code: string) => boolean) => chain.find(link => link.code && test(link.code));
  // Codes stay in `detail`; the message is for a person and says what to check.
  if (find(isTlsCode)) {
    return {
      kind: 'connection',
      code: 'model.connection.tls',
      retryable: false,
      message: '和模型服务建立加密连接失败。常见原因是代理或安全软件替换了证书，或者服务地址的 https/http 写反了。',
    };
  }
  const dns = find(code => DNS_CODES.has(code));
  if (dns) {
    const host = dns.hostname ? `（${dns.hostname}）` : '';
    return {
      kind: 'connection',
      code: 'model.connection.dns',
      retryable: true,
      message: `解析不到模型服务的地址${host}。请检查网络、代理或 DNS 是否正常，以及设置里的服务地址有没有写错。`,
    };
  }
  const refused = find(code => code === 'ECONNREFUSED');
  if (refused) {
    const target = refused.address ? `（${refused.address}${refused.port ? `:${refused.port}` : ''}）` : '';
    return {
      kind: 'connection',
      code: 'model.connection.refused',
      retryable: true,
      message: `模型服务${target}拒绝了连接：那个地址上没有服务在监听。本地模型请确认服务已经启动；远程服务请检查地址和端口。`,
    };
  }
  if (find(code => UNREACHABLE_CODES.has(code))) {
    return {
      kind: 'connection',
      code: 'model.connection.unreachable',
      retryable: true,
      message: '网络不可达，请检查网络连接或代理设置。',
    };
  }
  if (find(code => CONNECT_TIMEOUT_CODES.has(code))) {
    return {
      kind: 'connection',
      code: 'model.connection.timeout',
      retryable: true,
      message: '连接模型服务超时：在限定时间内没能建立连接，可能是网络、代理或防火墙挡住了。',
    };
  }
  if (find(code => RESET_CODES.has(code))) return RESET_FAILURE;
  if (find(code => RESPONSE_TIMEOUT_CODES.has(code))) {
    return {
      kind: 'timeout',
      code: 'model.timeout',
      retryable: true,
      message: '模型服务接受了连接，但迟迟没有返回内容。可以重试；如果经常这样，可能是服务端负载过高。',
    };
  }
  return null;
}

const RESET_FAILURE: TransportFailure = {
  kind: 'connection',
  code: 'model.connection.reset',
  retryable: true,
  message: '与模型服务的连接在请求途中被断开。这通常是临时的网络波动、代理中断或服务端过载，稍后重试一般能恢复。',
};

const AUTH_FAILURE: TransportFailure = {
  kind: 'auth',
  code: 'model.auth',
  retryable: false,
  message: '当前模型服务拒绝了凭据。请到设置里重新填写该 Provider 的 API Key，再点一次“测试连接”。',
};

const RATE_LIMIT_FAILURE: TransportFailure = {
  kind: 'rate_limit',
  code: 'model.rate_limit',
  retryable: true,
  message: '模型服务当前限流或额度不足，稍等一会儿再试。',
};

/** Matches the adapters' `${label} request failed: ${status} ${statusText} - ${body}`. */
function readHttpFailure(message: string): { status: number; providerMessage: string } | null {
  const match = message.match(/\brequest failed: (\d{3})\b[^-]*(?:-\s*([\s\S]*))?$/);
  if (!match) return null;
  return { status: Number(match[1]), providerMessage: readProviderMessage(match[2] || '') };
}

function readProviderMessage(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  let text = trimmed;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const nested = parsed.error && typeof parsed.error === 'object' ? parsed.error as Record<string, unknown> : null;
    const candidate = nested?.message ?? parsed.message ?? parsed.error;
    if (typeof candidate === 'string' && candidate.trim()) text = candidate;
  } catch {
    // Not JSON: the provider answered with plain text or HTML.
    if (/^</.test(trimmed)) return '';
  }
  return redactModelFailureDetail(text).slice(0, 160);
}

function classifyHttpStatus(status: number, providerMessage: string): TransportFailure {
  if (status === 401 || status === 403) return AUTH_FAILURE;
  if (status === 429) return RATE_LIMIT_FAILURE;
  if (status === 408) {
    return {
      kind: 'timeout',
      code: 'model.timeout',
      retryable: true,
      message: '模型服务在处理这次请求时超时（HTTP 408）。可以重试。',
    };
  }
  if (status >= 500) {
    return {
      kind: 'connection',
      code: 'model.server_error',
      retryable: true,
      message: `模型服务端暂时出错（HTTP ${status}），不是这边的配置问题，稍后重试一般能恢复。`,
    };
  }
  return {
    kind: 'passthrough',
    code: 'model.request_rejected',
    retryable: false,
    message: providerMessage
      ? `模型服务拒绝了这次请求（HTTP ${status}）。服务返回：${providerMessage}`
      : `模型服务拒绝了这次请求（HTTP ${status}）。请检查设置里的模型名和服务地址。`,
  };
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
