import { getDatabase } from '../database';
import { deleteMemoryIndex, upsertMemoryIndex } from '../indexer';
import type { ConversationMode, Message, MessageRole } from '../../shared/types';

export interface MessageInput {
  role: MessageRole;
  content: string;
  emotion?: string;
  mode?: ConversationMode;
}

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
