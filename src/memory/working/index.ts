import { getDatabase } from '../database';
import { deleteMemoryIndex, upsertMemoryIndex } from '../indexer';
import type { ChatWindow, ChatWindowMessage, ConversationMode, Message, MessageRole } from '../../shared/types';

export interface MessageInput {
  role: MessageRole;
  content: string;
  emotion?: string;
  mode?: ConversationMode;
}

export interface ChatWindowInput {
  title?: string;
  mode?: ConversationMode;
}

const DEFAULT_CHAT_WINDOW_TITLE = '新聊天';
const MAX_CHAT_WINDOW_TITLE_CHARS = 80;
const MAX_CHAT_WINDOW_SUMMARY_CHARS = 1_200;
const MAX_CHAT_WINDOW_PREVIEW_CHARS = 120;
const MAX_WORKING_STATE_VALUE_CHARS = 120;
const CHAT_WINDOW_MODES = new Set<ConversationMode>(['create', 'companion', 'reason', 'execute']);

export function saveMessage(role: MessageRole, content: string, emotion?: string, mode?: ConversationMode): Message {
  const db = getDatabase();
  const result = db.prepare(`
    INSERT INTO messages (role, content, emotion, mode)
    VALUES (?, ?, ?, ?)
  `).run(role, content, emotion || null, mode || null);
  const id = result.lastInsertRowid as number;
  upsertMemoryIndex('messages', id, `${role} ${content} ${emotion || ''}`);

  return {
    id,
    role,
    content,
    emotion,
    mode,
    created_at: new Date().toISOString(),
  };
}

export function ensureDefaultChatWindow(): ChatWindow {
  const active = getActiveChatWindow();
  if (active) return active;
  return createChatWindow({ title: DEFAULT_CHAT_WINDOW_TITLE, mode: 'companion' });
}

export function createChatWindow(input: ChatWindowInput = {}): ChatWindow {
  const db = getDatabase();
  const title = cleanChatWindowTitle(input.title) || DEFAULT_CHAT_WINDOW_TITLE;
  const mode = cleanChatWindowMode(input.mode) || 'companion';
  const result = db.prepare(`
    INSERT INTO chat_windows (title, mode)
    VALUES (?, ?)
  `).run(title, mode);
  return activateChatWindow(result.lastInsertRowid as number) || ensureDefaultChatWindow();
}

export function getActiveChatWindow(): ChatWindow | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT ${chatWindowSelectFields()}
    ${chatWindowSelectFrom()}
    WHERE cw.deleted_at IS NULL AND cw.archived_at IS NULL
    GROUP BY cw.id
    ORDER BY cw.last_active_at DESC, cw.id DESC
    LIMIT 1
  `).get();
  return row ? rowToChatWindow(row) : null;
}

export function getChatWindow(id: number): ChatWindow | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT ${chatWindowSelectFields()}
    ${chatWindowSelectFrom()}
    WHERE cw.id = ? AND cw.deleted_at IS NULL
    GROUP BY cw.id
    LIMIT 1
  `).get(id);
  return row ? rowToChatWindow(row) : null;
}

export function listChatWindows(includeArchived = false): ChatWindow[] {
  const db = getDatabase();
  const archivedClause = includeArchived ? '' : 'AND archived_at IS NULL';
  const rows = db.prepare(`
    SELECT ${chatWindowSelectFields()}
    ${chatWindowSelectFrom()}
    WHERE cw.deleted_at IS NULL ${archivedClause.replace('archived_at', 'cw.archived_at')}
    GROUP BY cw.id
    ORDER BY cw.archived_at IS NOT NULL ASC, cw.last_active_at DESC, cw.updated_at DESC, cw.id DESC
  `).all() as any[];
  if (rows.length === 0 && !includeArchived) return [ensureDefaultChatWindow()];
  return rows.map(rowToChatWindow);
}

export function activateChatWindow(id: number): ChatWindow | null {
  const db = getDatabase();
  const existing = getChatWindow(id);
  if (!existing || existing.archived_at || existing.deleted_at) return null;
  db.prepare(`
    UPDATE chat_windows
    SET last_active_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
    WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL
  `).run(id);
  return getChatWindow(id);
}

export function renameChatWindow(id: number, title: string): ChatWindow | null {
  const cleaned = cleanChatWindowTitle(title);
  if (!cleaned) return getChatWindow(id);
  const db = getDatabase();
  db.prepare(`
    UPDATE chat_windows
    SET title = ?, updated_at = datetime('now', 'localtime')
    WHERE id = ? AND deleted_at IS NULL
  `).run(cleaned, id);
  return getChatWindow(id);
}

export function archiveChatWindow(id: number, archived = true): ChatWindow | null {
  const db = getDatabase();
  db.prepare(`
    UPDATE chat_windows
    SET archived_at = ${archived ? "COALESCE(archived_at, datetime('now', 'localtime'))" : 'NULL'},
        updated_at = datetime('now', 'localtime')
    WHERE id = ? AND deleted_at IS NULL
  `).run(id);
  return getChatWindow(id);
}

export function deleteChatWindow(id: number): boolean {
  const db = getDatabase();
  const result = db.prepare(`
    UPDATE chat_windows
    SET deleted_at = COALESCE(deleted_at, datetime('now', 'localtime')),
        updated_at = datetime('now', 'localtime')
    WHERE id = ? AND deleted_at IS NULL
  `).run(id);
  return result.changes > 0;
}

export function saveChatMessage(
  windowId: number,
  role: MessageRole,
  content: string,
  emotion?: string,
  mode?: ConversationMode,
): ChatWindowMessage | null {
  const window = getChatWindow(windowId);
  if (!window || window.deleted_at) return null;
  const db = getDatabase();
  const result = db.prepare(`
    INSERT INTO chat_messages (window_id, role, content, emotion, mode)
    VALUES (?, ?, ?, ?, ?)
  `).run(windowId, role, content, emotion || null, mode || window.mode);
  const id = result.lastInsertRowid as number;
  const effectiveMode = mode || window.mode;
  const messageCount = (db.prepare(`
    SELECT COUNT(*) as c
    FROM chat_messages
    WHERE window_id = ?
  `).get(windowId) as { c: number }).c;
  const summary = buildChatWindowSummary(window.summary, role, content, id);
  const workingState = buildChatWindowWorkingState(window.working_state_json || window.working_state, {
    id,
    role,
    content,
    mode: effectiveMode,
    messageCount,
  });
  db.prepare(`
    UPDATE chat_windows
    SET mode = ?,
        summary = ?,
        working_state = ?,
        last_active_at = datetime('now', 'localtime'),
        updated_at = datetime('now', 'localtime')
    WHERE id = ? AND deleted_at IS NULL
  `).run(effectiveMode, summary, workingState, windowId);
  return {
    id,
    window_id: windowId,
    role,
    content,
    emotion,
    mode: effectiveMode,
    created_at: new Date().toISOString(),
  };
}

export function getChatWindowMessages(windowId: number, limit: number = 200): ChatWindowMessage[] {
  const db = getDatabase();
  const safeLimit = Math.max(1, Math.min(500, Math.round(limit)));
  const rows = db.prepare(`
    SELECT id, window_id, role, content, emotion, mode, created_at
    FROM chat_messages
    WHERE window_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(windowId, safeLimit) as any[];
  return rows.reverse().map(rowToChatWindowMessage);
}

export function saveMessages(messages: MessageInput[]): Message[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO messages (role, content, emotion, mode)
    VALUES (?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items: MessageInput[]) => {
    const saved: Message[] = [];
    for (const item of items) {
      const result = stmt.run(item.role, item.content, item.emotion || null, item.mode || null);
      const id = result.lastInsertRowid as number;
      upsertMemoryIndex('messages', id, `${item.role} ${item.content} ${item.emotion || ''}`);
      saved.push({
        id,
        role: item.role,
        content: item.content,
        emotion: item.emotion,
        mode: item.mode,
        created_at: new Date().toISOString(),
      });
    }
    return saved;
  });

  return insertMany(messages);
}

export function getRecentMessages(limit: number = 20, mode?: ConversationMode): Message[] {
  const db = getDatabase();
  const rows = mode
    ? db.prepare(`
      SELECT id, role, content, emotion, mode, created_at
      FROM messages
      WHERE mode = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(mode, limit) as any[]
    : db.prepare(`
      SELECT id, role, content, emotion, mode, created_at
      FROM messages
      ORDER BY id DESC
      LIMIT ?
    `).all(limit) as any[];
  return rows.reverse().map(rowToMessage);
}

export function getMessageHistory(page: number = 1, pageSize: number = 50): { messages: Message[]; total: number } {
  const db = getDatabase();
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, Math.min(200, pageSize));
  const offset = (safePage - 1) * safePageSize;
  const total = (db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).c;
  const rows = db.prepare(`
    SELECT id, role, content, emotion, mode, created_at
    FROM messages
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(safePageSize, offset) as any[];

  return { messages: rows.reverse().map(rowToMessage), total };
}

export function searchMessages(keyword: string, limit: number = 20): Message[] {
  const db = getDatabase();
  const like = `%${keyword}%`;
  const rows = db.prepare(`
    SELECT id, role, content, emotion, mode, created_at
    FROM messages
    WHERE content LIKE ?
    ORDER BY id DESC
    LIMIT ?
  `).all(like, limit) as any[];
  return rows.reverse().map(rowToMessage);
}

export function deleteMessage(id: number): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  if (result.changes > 0) deleteMemoryIndex('messages', id);
  return result.changes > 0;
}

export function clearMessages(): void {
  getDatabase().prepare('DELETE FROM messages').run();
  getDatabase().prepare("DELETE FROM memory_index WHERE source_table = 'messages'").run();
}

function rowToMessage(row: any): Message {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    emotion: row.emotion || undefined,
    mode: row.mode || undefined,
    created_at: row.created_at,
  };
}

function rowToChatWindowMessage(row: any): ChatWindowMessage {
  return {
    ...rowToMessage(row),
    window_id: row.window_id,
  };
}

function rowToChatWindow(row: any): ChatWindow {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary || '',
    mode: row.mode || 'companion',
    working_state: row.working_state || '{}',
    working_state_json: row.working_state || '{}',
    archived_at: row.archived_at || undefined,
    deleted_at: row.deleted_at || undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_active_at: row.last_active_at,
    messageCount: Number(row.message_count || 0),
    lastMessagePreview: row.last_message_preview || undefined,
  };
}

function chatWindowSelectFields(): string {
  return `
    cw.id,
    cw.title,
    cw.summary,
    cw.mode,
    cw.working_state,
    cw.archived_at,
    cw.deleted_at,
    cw.created_at,
    cw.updated_at,
    cw.last_active_at,
    COUNT(cm.id) AS message_count,
    (
      SELECT content
      FROM chat_messages latest
      WHERE latest.window_id = cw.id
      ORDER BY latest.id DESC
      LIMIT 1
    ) AS last_message_preview
  `;
}

function chatWindowSelectFrom(): string {
  return `
    FROM chat_windows cw
    LEFT JOIN chat_messages cm ON cm.window_id = cw.id
  `;
}

function cleanChatWindowTitle(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_WINDOW_TITLE_CHARS)
    : '';
}

function cleanChatWindowMode(value: unknown): ConversationMode | null {
  return CHAT_WINDOW_MODES.has(value as ConversationMode) ? value as ConversationMode : null;
}

function buildChatWindowSummary(existingSummary: string, role: MessageRole, content: string, messageId: number): string {
  const compactContent = truncateChatWindowText(content, 180);
  if (!compactContent) return existingSummary || '';
  const line = `#${messageId} ${role}: ${compactContent}`;
  const existingLines = (existingSummary || '')
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean);
  return trimSummaryLines([...existingLines, line], MAX_CHAT_WINDOW_SUMMARY_CHARS);
}

function buildChatWindowWorkingState(
  existingJson: string,
  update: { id: number; role: MessageRole; content: string; mode: ConversationMode; messageCount: number },
): string {
  const state = parseWorkingState(existingJson);
  state.lastMessageId = update.id;
  state.lastRole = update.role;
  state.lastMode = update.mode;
  state.lastMessagePreview = truncateChatWindowText(update.content, MAX_CHAT_WINDOW_PREVIEW_CHARS);
  state.messageCount = update.messageCount;
  if (update.role === 'user') {
    state.lastUserMessage = truncateChatWindowText(update.content, MAX_WORKING_STATE_VALUE_CHARS);
    const selection = extractUserSelection(update.content);
    if (selection) state.lastUserSelection = selection;
  } else if (update.role === 'assistant') {
    state.lastAssistantMessage = truncateChatWindowText(update.content, MAX_WORKING_STATE_VALUE_CHARS);
  }
  return JSON.stringify(state);
}

function parseWorkingState(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function extractUserSelection(content: string): string {
  const normalized = truncateChatWindowText(content, MAX_WORKING_STATE_VALUE_CHARS);
  const match = normalized.match(/我(?:选择|选了|决定|采用|倾向于|想用)(?:了)?\s*([^，。！？,.!?;；\n]{1,60})/);
  return match ? truncateChatWindowText(match[1], MAX_WORKING_STATE_VALUE_CHARS) : '';
}

function trimSummaryLines(lines: string[], maxChars: number): string {
  const kept: string[] = [];
  let total = 0;
  for (const line of [...lines].reverse()) {
    const projected = total + line.length + (kept.length > 0 ? 1 : 0);
    if (projected > maxChars && kept.length > 0) break;
    kept.unshift(line);
    total = projected;
  }
  const summary = kept.join('\n');
  return summary.length <= maxChars ? summary : summary.slice(Math.max(0, summary.length - maxChars));
}

function truncateChatWindowText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 1))}...`;
}
