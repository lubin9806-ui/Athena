/** 事件总线 — 模块间解耦通信 */

type EventHandler = (...args: any[]) => void;

export class EventBus {
  private listeners: Map<string, Set<EventHandler>> = new Map();
  private onceListeners: Map<string, Set<EventHandler>> = new Map();

  on(event: string, handler: EventHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  once(event: string, handler: EventHandler): void {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, new Set());
    }
    this.onceListeners.get(event)!.add(handler);
  }

  off(event: string, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler);
    this.onceListeners.get(event)?.delete(handler);
  }

  emit(event: string, ...args: any[]): void {
    this.listeners.get(event)?.forEach(handler => {
      try { handler(...args); } catch (e) { console.error(`EventBus error: ${event}`, e); }
    });
    this.onceListeners.get(event)?.forEach(handler => {
      try { handler(...args); } catch (e) { console.error(`EventBus error: ${event}`, e); }
    });
    this.onceListeners.delete(event);
  }

  removeAll(): void {
    this.listeners.clear();
    this.onceListeners.clear();
  }

  listenerCount(event: string): number {
    return (this.listeners.get(event)?.size || 0) + (this.onceListeners.get(event)?.size || 0);
  }
}

export const globalEventBus = new EventBus();