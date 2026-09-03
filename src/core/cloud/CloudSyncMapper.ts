import type { ChatWindow, ChatWindowMessage } from '../../shared/types';
import type { CloudConversationPayload, CloudConversationTurn, CloudMemoryPayload } from '../../shared/types/cloud';

const MAX_SYNC_TURNS = 40;
const MAX_TURN_CHARS = 4_000;

export function conversationResourceId(windowId: number): string {
  return `conversation.desktop-${windowId}`;
}

export function memoryResourceId(kind: string, id: number): string {
  return `memory.desktop-${kind}-${id}`;
}

export function shouldSyncWindow(window: Pick<ChatWindow, 'mode' | 'is_temporary'>): boolean {
  return window.is_temporary !== true && window.mode !== 'execute';
}

export function toConversationPayload(
  window: Pick<ChatWindow, 'title' | 'mode'>,
  messages: ChatWindowMessage[],
): CloudConversationPayload {
  const turns: CloudConversationTurn[] = messages
    .filter((message): message is ChatWindowMessage & { role: 'user' | 'assistant' } => (
      message.role === 'user' || message.role === 'assistant'
    ))
    .slice(-MAX_SYNC_TURNS)
    .map(message => ({
      role: message.role,
      content: message.content.slice(0, MAX_TURN_CHARS),
      mode: message.mode,
      createdAt: message.created_at,
    }));
  return {
    origin: 'desktop',
    title: window.title,
    mode: window.mode,
    turns,
  };
}

export function toMemoryPayload(item: { kind: string; title: string; content: string; importance?: number }): CloudMemoryPayload {
  return {
    origin: 'desktop',
    kind: item.kind,
    title: item.title.slice(0, 200),
    content: item.content.slice(0, 4_000),
    importance: item.importance,
  };
}

export function incomingConversationTitle(payload: CloudConversationPayload): string {
  const title = payload.title?.trim();
  if (title) return title.slice(0, 80);
  return payload.origin === 'android' ? '来自手机的对话' : '同步对话';
}
