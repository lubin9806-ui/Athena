/** 状态机 — 管理 Athena 的各种状态 */

export type AppState =
  | 'starting'
  | 'ready'
  | 'thinking'
  | 'speaking'
  | 'idle'
  | 'error';

interface StateTransition {
  from: AppState[];
  to: AppState;
  onTransition?: () => void;
}

export class StateMachine {
  private current: AppState = 'starting';
  private transitions: Map<string, StateTransition> = new Map();
  private listeners: Set<(state: AppState, prev: AppState) => void> = new Set();

  get state(): AppState {
    return this.current;
  }

  addTransition(transition: StateTransition): void {
    const key = `${transition.from.join('|')}->${transition.to}`;
    this.transitions.set(key, transition);
  }

  async transition(to: AppState): Promise<boolean> {
    const prev = this.current;

    // 检查所有可能的转换规则
    for (const [, rule] of this.transitions) {
      if (rule.to === to && rule.from.includes(prev)) {
        this.current = to;
        rule.onTransition?.();
        this.notifyListeners(to, prev);
        return true;
      }
    }

    console.warn(`状态转换无效: ${prev} -> ${to}`);
    return false;
  }

  private notifyListeners(state: AppState, prev: AppState): void {
    this.listeners.forEach(cb => cb(state, prev));
  }

  onChange(callback: (state: AppState, prev: AppState) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
}

/** 默认状态转换规则 */
export function createDefaultStateMachine(): StateMachine {
  const sm = new StateMachine();
  sm.addTransition({ from: ['starting'], to: 'ready' });
  sm.addTransition({ from: ['ready', 'idle'], to: 'thinking' });
  sm.addTransition({ from: ['thinking'], to: 'speaking' });
  sm.addTransition({ from: ['thinking', 'speaking'], to: 'ready' });
  sm.addTransition({ from: ['ready', 'speaking', 'thinking'], to: 'idle' });
  sm.addTransition({ from: ['*' as any], to: 'error' });
  return sm;
}