export type ChatRole = 'user' | 'assistant';
export type ChatMode = 'create' | 'companion' | 'reason' | 'execute';

export interface ChatSource {
  id: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
}

export interface ChatResearchMeta {
  readPageCount: number;
  searchRounds: number;
}

export interface ChatToolExecution {
  id: string;
  name: string;
  label: string;
  status: 'completed' | 'failed' | 'denied';
  summary: string;
  inputPreview: string;
  outputPreview: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export class ChatPanel {
  private streamingMessage: HTMLDivElement | null = null;
  private lastAssistantMessage: HTMLDivElement | null = null;
  private lastAssistantContent = '';
  private showTimestamps = false;
  private activeMode: ChatMode = 'companion';

  constructor(private readonly container: HTMLElement) {}

  setShowTimestamps(enabled: boolean): void {
    this.showTimestamps = enabled;
    this.container.dataset.timestamps = String(enabled);
  }

  setActiveMode(mode: ChatMode): void {
    this.activeMode = mode;
    this.container.dataset.activeMode = mode;
    this.streamingMessage = null;
    const messages = this.container.querySelectorAll<HTMLDivElement>(`.message.assistant[data-mode="${mode}"]`);
    this.lastAssistantMessage = messages.length > 0 ? messages.item(messages.length - 1) : null;
    this.lastAssistantContent = this.lastAssistantMessage?.dataset.rawContent || '';
    this.scrollToBottom();
  }

  addMessage(content: string, role: ChatRole, emotion?: string): HTMLDivElement {
    const message = document.createElement('div');
    message.className = `message ${role}`;
    message.dataset.mode = this.activeMode;
    message.dataset.rawContent = content;
    message.textContent = content;
    if (this.showTimestamps) this.appendTimestamp(message);
    this.container.appendChild(message);

    if (role === 'assistant') {
      this.lastAssistantMessage = message;
      this.lastAssistantContent = content;
      if (emotion) this.appendEmotion(message, emotion);
    }

    this.scrollToBottom();
    return message;
  }

  updateStreamingMessage(content: string): void {
    if (!this.streamingMessage) {
      this.streamingMessage = this.addMessage('', 'assistant');
    }

    this.streamingMessage.replaceChildren(document.createTextNode(content));
    this.streamingMessage.dataset.rawContent = content;
    if (this.showTimestamps) this.appendTimestamp(this.streamingMessage);
    this.lastAssistantMessage = this.streamingMessage;
    this.lastAssistantContent = content;
    this.scrollToBottom();
  }

  finalizeStreaming(emotion?: string): void {
    if (this.streamingMessage && emotion) {
      this.appendEmotion(this.streamingMessage, emotion);
    }
    this.streamingMessage = null;
    this.scrollToBottom();
  }

  setLastAssistantEmotion(emotion: string): void {
    if (!this.lastAssistantMessage) return;
    this.appendEmotion(this.lastAssistantMessage, emotion);
  }

  setLastAssistantSources(sources: ChatSource[], research?: ChatResearchMeta): void {
    if (!this.lastAssistantMessage || sources.length === 0) return;
    this.appendSources(this.lastAssistantMessage, sources, research);
    this.scrollToBottom();
  }

  setLastAssistantTools(executions: ChatToolExecution[]): void {
    if (!this.lastAssistantMessage || executions.length === 0) return;
    this.appendTools(this.lastAssistantMessage, executions);
    this.scrollToBottom();
  }

  getLastAssistantContent(): string {
    return this.lastAssistantContent;
  }

  private appendEmotion(message: HTMLDivElement, emotion: string): void {
    const existing = message.querySelector('.emotion-badge');
    if (existing) existing.remove();

    const badge = document.createElement('div');
    badge.className = 'emotion-badge';
    badge.textContent = `状态 · ${emotion}`;
    message.appendChild(badge);
  }

  private appendTimestamp(message: HTMLDivElement): void {
    const meta = document.createElement('div');
    meta.className = 'message-time';
    meta.textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    message.appendChild(meta);
  }

  private appendSources(message: HTMLDivElement, sources: ChatSource[], research?: ChatResearchMeta): void {
    message.querySelector('.message-sources')?.remove();

    const section = document.createElement('section');
    section.className = 'message-sources';
    section.setAttribute('aria-label', `联网来源，共 ${sources.length} 条`);

    const heading = document.createElement('div');
    heading.className = 'message-sources-heading';
    const details = [`联网来源 · ${sources.length}`];
    if ((research?.readPageCount ?? 0) > 0) details.push(`深读 ${research?.readPageCount} 页`);
    if ((research?.searchRounds ?? 1) > 1) details.push(`${research?.searchRounds} 轮搜索`);
    heading.textContent = details.join(' · ');
    section.appendChild(heading);

    const cards = document.createElement('div');
    cards.className = 'message-source-cards';
    for (const source of sources) {
      const link = document.createElement('a');
      link.className = 'message-source-card';
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = source.snippet || source.title;

      const index = document.createElement('span');
      index.className = 'message-source-index';
      index.textContent = String(source.id);

      const body = document.createElement('span');
      body.className = 'message-source-body';
      const title = document.createElement('span');
      title.className = 'message-source-title';
      title.textContent = source.title;
      const domain = document.createElement('span');
      domain.className = 'message-source-domain';
      domain.textContent = source.domain;
      body.append(title, domain);
      link.append(index, body);
      cards.appendChild(link);
    }

    section.appendChild(cards);
    message.appendChild(section);
  }

  private appendTools(message: HTMLDivElement, executions: ChatToolExecution[]): void {
    message.querySelector('.message-tools')?.remove();

    const section = document.createElement('section');
    section.className = 'message-tools';
    section.setAttribute('aria-label', `电脑工具执行记录，共 ${executions.length} 条`);

    const heading = document.createElement('div');
    heading.className = 'message-tools-heading';
    const succeeded = executions.filter(item => item.status === 'completed').length;
    heading.textContent = `电脑操作 · ${succeeded}/${executions.length} 完成`;
    section.appendChild(heading);

    const cards = document.createElement('div');
    cards.className = 'message-tool-cards';
    for (const execution of executions) {
      const card = document.createElement('details');
      card.className = 'message-tool-card';
      card.dataset.status = execution.status;

      const title = document.createElement('summary');
      title.className = 'message-tool-title';
      const status = execution.status === 'completed' ? '完成' : execution.status === 'denied' ? '已拒绝' : '失败';
      const duration = execution.durationMs >= 1000
        ? `${(execution.durationMs / 1000).toFixed(1)}s`
        : `${execution.durationMs}ms`;
      title.textContent = `${execution.label} · ${status} · ${duration}`;

      const body = document.createElement('div');
      body.className = 'message-tool-body';
      const summary = document.createElement('div');
      summary.className = 'message-tool-summary';
      summary.textContent = execution.summary;
      body.appendChild(summary);

      if (execution.inputPreview) {
        const inputLabel = document.createElement('div');
        inputLabel.className = 'message-tool-meta-label';
        inputLabel.textContent = '调用参数';
        const input = document.createElement('pre');
        input.textContent = execution.inputPreview;
        body.append(inputLabel, input);
      }

      if (execution.outputPreview) {
        const outputLabel = document.createElement('div');
        outputLabel.className = 'message-tool-meta-label';
        outputLabel.textContent = '执行结果';
        const output = document.createElement('pre');
        output.textContent = execution.outputPreview;
        body.append(outputLabel, output);
      }

      card.append(title, body);
      cards.appendChild(card);
    }

    section.appendChild(cards);
    message.appendChild(section);
  }

  private scrollToBottom(): void {
    this.container.scrollTop = this.container.scrollHeight;
  }
}
