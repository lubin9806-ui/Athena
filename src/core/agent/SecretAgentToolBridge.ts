import { hasExecutionCredential } from '../ai/CredentialStore';
import { ToolRegistry, type AgentToolRegistration } from './ToolRegistry';

/**
 * The model asks for secret material through this tool instead of ordinary chat.
 * The renderer stores the value before approving the call; execution returns only
 * an opaque reference that computer tools can resolve inside the main process.
 */
export class SecretAgentToolBridge {
  private registration: Readonly<AgentToolRegistration> | null = null;

  constructor(private readonly registry: ToolRegistry) {}

  refresh(): string[] {
    if (this.registration) this.registry.unregister(this.registration.name, this.registration);
    this.registration = this.registry.register({
      name: 'request_secret',
      version: 'execution-secret-v1',
      capability: 'credential.request',
      label: '安全提供凭据',
      description: '需要 API Key、Token、密码或验证码时使用。绝不要让用户把秘密直接发进聊天；此工具会显示安全输入并只返回 credential:// 引用。',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$' },
          label: { type: 'string', minLength: 2, maxLength: 80 },
          reason: { type: 'string', minLength: 2, maxLength: 500 },
        },
        required: ['service', 'label', 'reason'],
        additionalProperties: false,
      },
      strict: true,
      idempotent: true,
      timeoutMs: 30_000,
      retry: { maxAttempts: 1 },
      policy: {
        capability: 'credential.request',
        access: 'read',
        riskLevel: 'high',
        approval: 'always',
        alwaysAsk: true,
        reason: '需要你通过安全输入提供敏感凭据；内容不会进入聊天记录或模型上下文。',
      },
      execute: async argumentsValue => {
        const service = String(argumentsValue.service || '').trim().toLowerCase();
        if (!hasExecutionCredential(service)) {
          return {
            status: 'failed',
            summary: '没有收到安全凭据',
            content: '安全输入未保存凭据。请再次调用 request_secret。',
            retryable: false,
          };
        }
        return {
          status: 'completed',
          summary: '安全凭据已提供',
          content: `credential_ref: credential://${service}\n在 http_request 的 header 值中使用这个引用；不要索要或输出明文。`,
          retryable: false,
          metadata: { service },
        };
      },
    });
    return ['request_secret'];
  }

  shutdown(): void {
    if (this.registration) this.registry.unregister(this.registration.name, this.registration);
    this.registration = null;
  }
}
