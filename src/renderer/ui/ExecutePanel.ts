import type {
  ExecuteSessionSnapshot,
  ExecuteTimelineItem,
  ExecuteTimelineTool,
} from '../../shared/executeTimeline';

/**
 * Execute mode as one conversation.
 *
 * It used to be nine panels around a live log of runner events - "分区太多，让人
 * 眼花缭乱" - none of which said what Athena was doing or why. Here the same
 * records read top to bottom: what you asked, what she said before each action,
 * the action with its result folded away, what you decided, what came out.
 */

export interface ExecutePanelCallbacks {
  onApproval(approvalId: string, decision: 'approved' | 'denied', scope: 'item' | 'group'): void;
  onStop(): void;
  onResume(): void;
  onExample(text: string): void;
}

const EXAMPLES = [
  '把这个文件夹里超过 30 天的安装包列出来',
  '给这个项目跑一遍测试，失败了就修好',
  '把今天的截图按日期归档',
];

export class ExecutePanel {
  private readonly openSteps = new Set<string>();
  private lastSignature = '';

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: ExecutePanelCallbacks,
  ) {
    this.container.addEventListener('click', event => this.handleClick(event));
  }

  render(session: ExecuteSessionSnapshot | null): void {
    const nearBottom = this.isNearBottom();
    const signature = session ? `${session.items.length}:${session.state}:${session.items.map(item => item.id).join('|')}` : 'empty';
    this.container.replaceChildren(...(session && session.items.length > 0
      ? [...this.renderTimeline(session.items), this.renderLive(session)]
      : [this.renderEmpty()]));
    if (nearBottom || signature !== this.lastSignature) this.scrollToBottom();
    this.lastSignature = signature;
  }

  private renderTimeline(items: readonly ExecuteTimelineItem[]): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    let turn: HTMLElement | null = null;
    const openTurn = (): HTMLElement => {
      if (turn) return turn;
      turn = document.createElement('div');
      turn.className = 'exec-turn';
      const head = document.createElement('div');
      head.className = 'exec-turn-head';
      const who = document.createElement('span');
      who.className = 'exec-who';
      who.textContent = 'Athena';
      head.appendChild(who);
      turn.appendChild(head);
      nodes.push(turn);
      return turn;
    };
    for (const item of items) {
      if (item.kind === 'user') {
        turn = null;
        const bubble = document.createElement('div');
        bubble.className = 'exec-user';
        bubble.textContent = item.text;
        nodes.push(bubble);
        continue;
      }
      openTurn().appendChild(this.renderItem(item));
    }
    return nodes;
  }

  private renderItem(item: Exclude<ExecuteTimelineItem, { kind: 'user' }>): HTMLElement {
    if (item.kind === 'narration' || item.kind === 'final') {
      const text = document.createElement('p');
      text.className = item.kind === 'final' ? 'exec-final' : 'exec-narr';
      text.textContent = item.text;
      if (item.kind === 'final' && item.verification === 'unverified') {
        const note = document.createElement('span');
        note.className = 'exec-final-note';
        note.textContent = '这次没有可自动核对的验收项，请自己确认结果。';
        text.appendChild(document.createElement('br'));
        text.appendChild(note);
      }
      return text;
    }
    if (item.kind === 'tool') return this.renderTool(item);
    if (item.kind === 'decision') {
      const receipt = document.createElement('div');
      receipt.className = 'exec-receipt';
      receipt.dataset.tone = item.tone;
      receipt.textContent = item.text;
      return receipt;
    }
    if (item.kind === 'error') {
      const error = document.createElement('div');
      error.className = 'exec-error';
      const title = document.createElement('div');
      title.className = 'exec-error-title';
      title.textContent = item.title;
      error.appendChild(title);
      if (item.detail) {
        const detail = document.createElement('pre');
        detail.className = 'exec-error-detail';
        detail.textContent = item.detail;
        error.appendChild(detail);
      }
      return error;
    }
    return this.renderAsk(item);
  }

  private renderTool(item: ExecuteTimelineTool): HTMLElement {
    const card = document.createElement('div');
    card.className = 'exec-step';
    card.dataset.status = item.status;
    card.dataset.open = String(this.openSteps.has(item.id));
    card.dataset.stepId = item.id;

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'exec-step-head';
    head.dataset.execStep = item.id;
    head.setAttribute('aria-expanded', String(this.openSteps.has(item.id)));
    const label = document.createElement('span');
    label.className = 'exec-step-label';
    label.textContent = item.label;
    const target = document.createElement('span');
    target.className = 'exec-step-target';
    target.textContent = item.target;
    const status = document.createElement('span');
    status.className = 'exec-step-status';
    status.textContent = item.summary || item.statusLabel;
    head.append(label, target, status);

    const body = document.createElement('div');
    body.className = 'exec-step-body';
    if (item.fields.length > 0) {
      const fields = document.createElement('dl');
      fields.className = 'agent-approval-fields';
      for (const field of item.fields) {
        const name = document.createElement('dt');
        name.textContent = field.label;
        const value = document.createElement(field.code ? 'pre' : 'dd');
        value.className = field.code ? 'agent-approval-code' : 'agent-approval-value';
        value.textContent = field.value;
        fields.append(name, value);
      }
      body.appendChild(fields);
    }
    if (item.output) {
      const outputLabel = document.createElement('div');
      outputLabel.className = 'exec-step-output-label';
      outputLabel.textContent = '结果';
      const output = document.createElement('pre');
      output.className = 'agent-approval-code exec-step-output';
      output.textContent = item.output;
      body.append(outputLabel, output);
    }
    if (item.fields.length === 0 && !item.output) {
      const empty = document.createElement('div');
      empty.className = 'exec-step-output-label';
      empty.textContent = item.statusLabel;
      body.appendChild(empty);
    }
    card.append(head, body);
    return card;
  }

  private renderAsk(item: Extract<ExecuteTimelineItem, { kind: 'ask' }>): HTMLElement {
    const view = item.view;
    const card = document.createElement('article');
    card.className = 'agent-approval-item exec-ask';
    card.dataset.approvalKind = view.kind;
    card.dataset.riskLevel = view.riskLevel;

    const head = document.createElement('div');
    head.className = 'agent-approval-head';
    const title = document.createElement('div');
    title.className = 'agent-approval-title';
    title.textContent = view.title;
    head.appendChild(title);
    if (view.riskLabel) {
      const risk = document.createElement('span');
      risk.className = 'agent-approval-risk';
      risk.dataset.riskLevel = view.riskLevel;
      risk.textContent = view.riskLabel;
      head.appendChild(risk);
    }

    const body = document.createElement('div');
    body.className = 'agent-approval-body';
    if (view.explanation) {
      const explanation = document.createElement('p');
      explanation.className = 'agent-approval-explanation';
      explanation.textContent = view.explanation;
      body.appendChild(explanation);
    }
    if (view.fields.length > 0) {
      const fields = document.createElement('dl');
      fields.className = 'agent-approval-fields';
      for (const field of view.fields) {
        const label = document.createElement('dt');
        label.textContent = field.label;
        const value = document.createElement(field.code ? 'pre' : 'dd');
        value.className = field.code ? 'agent-approval-code' : 'agent-approval-value';
        value.textContent = field.value;
        fields.append(label, value);
      }
      body.appendChild(fields);
    }

    const actions = document.createElement('div');
    actions.className = 'agent-approval-actions';
    for (const decision of ['denied', 'approved'] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.agentApprovalId = item.approvalId;
      button.dataset.decision = decision;
      button.dataset.scope = 'item';
      button.textContent = decision === 'approved' ? view.approveLabel : view.denyLabel;
      actions.appendChild(button);
    }
    card.append(head, body, actions);
    return card;
  }

  private renderLive(session: ExecuteSessionSnapshot): HTMLElement {
    const live = document.createElement('div');
    live.className = 'exec-live';
    live.dataset.state = session.state;
    live.id = 'execute-live-status';
    const dot = document.createElement('span');
    dot.className = 'exec-live-dot';
    const text = document.createElement('span');
    text.className = 'exec-live-text';
    text.textContent = session.stateLabel;
    const meta = document.createElement('span');
    meta.className = 'exec-live-meta';
    meta.textContent = describeSessionMeta(session);
    live.append(dot, text, meta);
    if (session.canStop) live.appendChild(actionButton('stop', '停止'));
    if (session.canResume) live.appendChild(actionButton('resume', '继续'));
    return live;
  }

  private renderEmpty(): HTMLElement {
    const empty = document.createElement('div');
    empty.className = 'exec-empty';
    const title = document.createElement('h2');
    title.textContent = '新的执行对话';
    const copy = document.createElement('p');
    copy.textContent = '说要在这台电脑上做什么。Athena 会边做边讲，需要你拍板时停下来问。';
    const examples = document.createElement('div');
    examples.className = 'exec-examples';
    for (const example of EXAMPLES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.execExample = example;
      button.textContent = example;
      examples.appendChild(button);
    }
    empty.append(title, copy, examples);
    return empty;
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const approval = target.closest<HTMLElement>('[data-agent-approval-id]');
    if (approval) {
      const decision = approval.dataset.decision === 'approved' ? 'approved' : 'denied';
      const scope = approval.dataset.scope === 'group' ? 'group' : 'item';
      this.callbacks.onApproval(String(approval.dataset.agentApprovalId), decision, scope);
      return;
    }
    const step = target.closest<HTMLElement>('[data-exec-step]');
    if (step) {
      const id = String(step.dataset.execStep);
      if (this.openSteps.has(id)) this.openSteps.delete(id); else this.openSteps.add(id);
      const card = step.closest<HTMLElement>('.exec-step');
      if (card) card.dataset.open = String(this.openSteps.has(id));
      step.setAttribute('aria-expanded', String(this.openSteps.has(id)));
      return;
    }
    const action = target.closest<HTMLElement>('[data-exec-action]');
    if (action) {
      if (action.dataset.execAction === 'stop') this.callbacks.onStop();
      if (action.dataset.execAction === 'resume') this.callbacks.onResume();
      return;
    }
    const example = target.closest<HTMLElement>('[data-exec-example]');
    if (example) this.callbacks.onExample(String(example.dataset.execExample));
  }

  private isNearBottom(): boolean {
    return this.container.scrollHeight - this.container.scrollTop - this.container.clientHeight < 160;
  }

  private scrollToBottom(): void {
    this.container.scrollTop = this.container.scrollHeight;
  }
}

function actionButton(action: 'stop' | 'resume', label: string): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'exec-live-action';
  button.dataset.execAction = action;
  button.textContent = label;
  return button;
}

function describeSessionMeta(session: ExecuteSessionSnapshot): string {
  const parts: string[] = [];
  if (session.actionCount > 0) parts.push(`${session.actionCount} 个动作`);
  if (session.durationMs > 0) parts.push(formatDuration(session.durationMs));
  return parts.join(' · ');
}

function formatDuration(durationMs: number): string {
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${seconds % 60} 秒`;
}
