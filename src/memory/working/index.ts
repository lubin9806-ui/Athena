import { getDatabase } from '../database';
import { deleteMemoryIndex, upsertMemoryIndex } from '../indexer';
import { activateProject, ensureDefaultProject, getProject } from '../projects';
import type { ChatAttachment, ChatWindow, ChatWindowMessage, ChatWindowPinnedFact, ContextSnapshotDebugItem, ContextSnapshotRecord, ConversationMode, Message, MessageRole } from '../../shared/types';

export interface MessageInput {
  role: MessageRole;
  content: string;
  emotion?: string;
  mode?: ConversationMode;
}

export interface ChatWindowInput {
  title?: string;
  mode?: ConversationMode;
  projectId?: number;
  temporary?: boolean;
}

export interface ContextSnapshotInput {
  projectId?: number;
  windowId?: number;
  userMessageId?: number;
  mode?: ConversationMode;
  budget: Record<string, unknown>;
  included: ContextSnapshotDebugItem[];
  omitted: ContextSnapshotDebugItem[];
  promptMessageCount: number;
  promptChars: number;
  estimatedPromptTokens: number;
}

const DEFAULT_CHAT_WINDOW_TITLE = '新聊天';
const MAX_CHAT_WINDOW_TITLE_CHARS = 80;
const MAX_CHAT_WINDOW_SUMMARY_CHARS = 1_200;
const MAX_CHAT_WINDOW_PREVIEW_CHARS = 120;
const MAX_WORKING_STATE_VALUE_CHARS = 120;
const MAX_PINNED_FACTS_PER_WINDOW = 24;
const MAX_PINNED_FACT_CHARS = 240;
const MAX_MODE_TRANSITIONS = 12;
const MAX_MODE_HANDOFF_ITEMS = 12;
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

export function ensureDefaultChatWindow(projectId?: number): ChatWindow {
  const project = resolveProject(projectId);
  const active = getActiveChatWindow(project.id);
  if (active) return active;
  return createChatWindow({ title: DEFAULT_CHAT_WINDOW_TITLE, mode: 'companion', projectId: project.id });
}

export function createChatWindow(input: ChatWindowInput = {}): ChatWindow {
  const db = getDatabase();
  const title = cleanChatWindowTitle(input.title) || DEFAULT_CHAT_WINDOW_TITLE;
  const mode = cleanChatWindowMode(input.mode) || 'companion';
  const project = resolveProject(input.projectId);
  const temporary = input.temporary === true ? 1 : 0;
  const result = db.prepare(`
    INSERT INTO chat_windows (title, mode, project_id, project_instructions_snapshot, is_temporary)
    VALUES (?, ?, ?, ?, ?)
  `).run(title, mode, project.id, project.instructions, temporary);
  activateProject(project.id);
  return activateChatWindow(result.lastInsertRowid as number) || ensureDefaultChatWindow(project.id);
}

export function createTemporaryChatWindow(input: ChatWindowInput = {}): ChatWindow {
  return createChatWindow({
    ...input,
    title: cleanChatWindowTitle(input.title) || 'Temporary Chat',
    temporary: true,
  });
}

export function getActiveChatWindow(projectId?: number): ChatWindow | null {
  const db = getDatabase();
  const projectClause = projectId && projectId > 0 ? 'AND cw.project_id = ?' : '';
  const args = projectId && projectId > 0 ? [projectId] : [];
  const row = db.prepare(`
    SELECT ${chatWindowSelectFields()}
    ${chatWindowSelectFrom()}
    WHERE cw.deleted_at IS NULL AND cw.archived_at IS NULL AND cw.is_temporary = 0 ${projectClause}
    GROUP BY cw.id
    ORDER BY cw.last_active_at DESC, cw.id DESC
    LIMIT 1
  `).get(...args);
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

export function listChatWindows(includeArchived = false, includeTemporary = false, projectId?: number): ChatWindow[] {
  const db = getDatabase();
  const archivedClause = includeArchived ? '' : 'AND archived_at IS NULL';
  const temporaryClause = includeTemporary ? '' : 'AND is_temporary = 0';
  const project = projectId && projectId > 0 ? getProject(projectId) : null;
  const projectClause = project ? 'AND cw.project_id = ?' : '';
  const args = project ? [project.id] : [];
  const rows = db.prepare(`
    SELECT ${chatWindowSelectFields()}
    ${chatWindowSelectFrom()}
    WHERE cw.deleted_at IS NULL ${archivedClause.replace('archived_at', 'cw.archived_at')} ${temporaryClause.replace('is_temporary', 'cw.is_temporary')} ${projectClause}
    GROUP BY cw.id
    ORDER BY cw.archived_at IS NOT NULL ASC, cw.last_active_at DESC, cw.updated_at DESC, cw.id DESC
  `).all(...args) as any[];
  if (rows.length === 0 && !includeArchived) return [ensureDefaultChatWindow(project?.id)];
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
  if (existing.project_id) activateProject(existing.project_id);
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
  const existing = getChatWindow(id);
  if (existing?.is_temporary) {
    const result = db.transaction(() => {
      db.prepare('DELETE FROM context_snapshots WHERE window_id = ?').run(id);
      return db.prepare('DELETE FROM chat_windows WHERE id = ? AND is_temporary = 1').run(id);
    })();
    return result.changes > 0;
  }
  const result = db.prepare(`
    UPDATE chat_windows
    SET deleted_at = COALESCE(deleted_at, datetime('now', 'localtime')),
        updated_at = datetime('now', 'localtime')
    WHERE id = ? AND deleted_at IS NULL
  `).run(id);
  return result.changes > 0;
}

export function cleanupTemporaryChatWindows(): number {
  const db = getDatabase();
  const rows = db.prepare('SELECT id FROM chat_windows WHERE is_temporary = 1').all() as Array<{ id: number }>;
  if (rows.length === 0) return 0;
  const ids = rows.map(row => row.id);
  const placeholders = ids.map(() => '?').join(', ');
  db.transaction(() => {
    db.prepare(`DELETE FROM context_snapshots WHERE window_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM chat_windows WHERE id IN (${placeholders})`).run(...ids);
  })();
  return ids.length;
}

// Messages written while "save chat history" was off live only for the session
// that produced them. Their context snapshots go with them explicitly, because
// that foreign key is ON DELETE SET NULL and would otherwise leave the preview
// text behind under a null message id. Attachment rows cascade from chat_messages,
// so AttachmentService.cleanupEphemeralMessageFiles must run BEFORE this to delete
// the managed files while the rows still name them.
export function purgeEphemeralChatMessages(): number {
  const db = getDatabase();
  const windowIds = (db.prepare(`
    SELECT DISTINCT window_id FROM chat_messages WHERE ephemeral = 1
  `).all() as Array<{ window_id: number }>).map(row => row.window_id);
  if (windowIds.length === 0) return 0;
  const placeholders = windowIds.map(() => '?').join(', ');
  return db.transaction(() => {
    db.prepare(`
      DELETE FROM context_snapshots
      WHERE user_message_id IN (SELECT id FROM chat_messages WHERE ephemeral = 1)
    `).run();
    const deleted = db.prepare('DELETE FROM chat_messages WHERE ephemeral = 1').run().changes;
    // Windows that only ever held ephemeral turns keep a stale message count in
    // their working state, so reset the counter for every window we touched.
    for (const windowId of windowIds) {
      const remaining = (db.prepare('SELECT COUNT(*) as c FROM chat_messages WHERE window_id = ?')
        .get(windowId) as { c: number }).c;
      const row = db.prepare('SELECT working_state FROM chat_windows WHERE id = ?')
        .get(windowId) as { working_state: string } | undefined;
      if (!row) continue;
      const state = parseWorkingState(row.working_state);
      state.messageCount = remaining;
      db.prepare('UPDATE chat_windows SET working_state = ? WHERE id = ?')
        .run(JSON.stringify(state), windowId);
    }
    return deleted;
  })();
}

/**
 * Applies the retention window to window chat, which `messages` retention never
 * covered (ATH-DATA-003). Context snapshots go explicitly because that foreign key
 * is SET NULL, and the window summary is rewritten because it carries the text of
 * the messages being removed. Attachment files must be swept first by
 * AttachmentService, while the rows that name them still exist.
 */
export function pruneChatMessagesBefore(cutoffIso: string): { deleted: number; windowsTouched: number } {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT id, window_id FROM chat_messages WHERE created_at < ?
  `).all(cutoffIso) as Array<{ id: number; window_id: number }>;
  if (rows.length === 0) return { deleted: 0, windowsTouched: 0 };

  const removedIds = new Set(rows.map(row => row.id));
  const windowIds = Array.from(new Set(rows.map(row => row.window_id)));
  return db.transaction(() => {
    db.prepare(`
      DELETE FROM context_snapshots
      WHERE user_message_id IN (SELECT id FROM chat_messages WHERE created_at < ?)
    `).run(cutoffIso);
    const deleted = db.prepare('DELETE FROM chat_messages WHERE created_at < ?').run(cutoffIso).changes;
    for (const windowId of windowIds) {
      const window = db.prepare('SELECT summary, working_state FROM chat_windows WHERE id = ?')
        .get(windowId) as { summary: string; working_state: string } | undefined;
      if (!window) continue;
      const remaining = (db.prepare('SELECT COUNT(*) as c FROM chat_messages WHERE window_id = ?')
        .get(windowId) as { c: number }).c;
      const state = parseWorkingState(window.working_state);
      state.messageCount = remaining;
      db.prepare('UPDATE chat_windows SET summary = ?, working_state = ? WHERE id = ?')
        .run(dropSummaryLines(window.summary, removedIds), JSON.stringify(state), windowId);
    }
    return { deleted, windowsTouched: windowIds.length };
  })();
}

// Summary lines are written as "#<id> <role>: <text>", so an expired message can be
// removed from the rolling summary by its id rather than by matching its text.
function dropSummaryLines(summary: string, removedIds: Set<number>): string {
  return (summary || '')
    .split('\n')
    .filter(line => {
      const match = line.match(/^#(\d+)\s/);
      return !match || !removedIds.has(Number(match[1]));
    })
    .join('\n');
}

export function countEphemeralChatMessages(): number {
  return (getDatabase().prepare('SELECT COUNT(*) as c FROM chat_messages WHERE ephemeral = 1')
    .get() as { c: number }).c;
}

export function pinChatWindowFact(windowId: number, text: string): ChatWindow | null {
  const window = getChatWindow(windowId);
  const normalized = truncateChatWindowText(text, MAX_PINNED_FACT_CHARS);
  if (!window || window.deleted_at || !normalized) return window;

  const state = parseWorkingState(window.working_state_json || window.working_state);
  const pinnedFacts = readPinnedFacts(state);
  const existing = pinnedFacts.find(fact => fact.text === normalized);
  if (!existing) {
    pinnedFacts.unshift({
      id: createPinnedFactId(),
      text: normalized,
      createdAt: new Date().toISOString(),
    });
  }
  state.pinnedFacts = pinnedFacts.slice(0, MAX_PINNED_FACTS_PER_WINDOW);
  updateChatWindowWorkingState(windowId, state);
  return getChatWindow(windowId);
}

export function unpinChatWindowFact(windowId: number, factId: string): ChatWindow | null {
  const window = getChatWindow(windowId);
  if (!window || window.deleted_at || !factId.trim()) return window;

  const state = parseWorkingState(window.working_state_json || window.working_state);
  const pinnedFacts = readPinnedFacts(state).filter(fact => fact.id !== factId);
  state.pinnedFacts = pinnedFacts;
  updateChatWindowWorkingState(windowId, state);
  return getChatWindow(windowId);
}

export function saveChatMessage(
  windowId: number,
  role: MessageRole,
  content: string,
  emotion?: string,
  mode?: ConversationMode,
  ephemeral = false,
): ChatWindowMessage | null {
  const window = getChatWindow(windowId);
  if (!window || window.deleted_at) return null;
  const db = getDatabase();
  const result = db.prepare(`
    INSERT INTO chat_messages (window_id, role, content, emotion, mode, ephemeral)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(windowId, role, content, emotion || null, mode || window.mode, ephemeral ? 1 : 0);
  const id = result.lastInsertRowid as number;
  const effectiveMode = mode || window.mode;
  const messageCount = (db.prepare(`
    SELECT COUNT(*) as c
    FROM chat_messages
    WHERE window_id = ?
  `).get(windowId) as { c: number }).c;
  // The window summary and working state carry message text, so an ephemeral
  // message must not be folded into them — otherwise the content outlives the
  // purge in a column nobody thinks of as chat history.
  const summary = ephemeral
    ? window.summary
    : buildChatWindowSummary(window.summary, role, content, id);
  const workingState = ephemeral
    ? (window.working_state_json || window.working_state)
    : buildChatWindowWorkingState(window.working_state_json || window.working_state, {
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
  const messages = rows.reverse().map(rowToChatWindowMessage);
  const attachments = getAttachmentsForMessages(messages.map(message => message.id));
  return messages.map(message => ({ ...message, attachments: attachments.get(message.id) || [] }));
}

function getAttachmentsForMessages(messageIds: number[]): Map<number, ChatAttachment[]> {
  const result = new Map<number, ChatAttachment[]>();
  if (messageIds.length === 0) return result;
  const placeholders = messageIds.map(() => '?').join(', ');
  const rows = getDatabase().prepare(`
    SELECT id, window_id, message_id, kind, mime_type, original_name, bytes, width, height, sha256, status, created_at
    FROM chat_attachments
    WHERE status = 'attached' AND message_id IN (${placeholders})
    ORDER BY created_at ASC, rowid ASC
  `).all(...messageIds) as Array<ChatAttachment & { message_id: number }>;
  for (const row of rows) {
    const items = result.get(row.message_id) || [];
    items.push(row);
    result.set(row.message_id, items);
  }
  return result;
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

export function saveContextSnapshot(input: ContextSnapshotInput): ContextSnapshotRecord {
  const db = getDatabase();
  const result = db.prepare(`
    INSERT INTO context_snapshots (
      project_id,
      window_id,
      user_message_id,
      mode,
      budget_json,
      included_json,
      omitted_json,
      prompt_message_count,
      prompt_chars,
      estimated_prompt_tokens
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.projectId || null,
    input.windowId || null,
    input.userMessageId || null,
    input.mode || null,
    JSON.stringify(input.budget),
    JSON.stringify(input.included),
    JSON.stringify(input.omitted),
    input.promptMessageCount,
    input.promptChars,
    input.estimatedPromptTokens,
  );
  const id = result.lastInsertRowid as number;
  return getContextSnapshot(id) || {
    id,
    project_id: input.projectId,
    window_id: input.windowId,
    user_message_id: input.userMessageId,
    mode: input.mode,
    budget: input.budget,
    included: input.included,
    omitted: input.omitted,
    prompt_message_count: input.promptMessageCount,
    prompt_chars: input.promptChars,
    estimated_prompt_tokens: input.estimatedPromptTokens,
    created_at: new Date().toISOString(),
  };
}

export function getContextSnapshot(id: number): ContextSnapshotRecord | null {
  const row = getDatabase().prepare(`
    SELECT id, project_id, window_id, user_message_id, mode, budget_json, included_json, omitted_json,
           prompt_message_count, prompt_chars, estimated_prompt_tokens, created_at
    FROM context_snapshots
    WHERE id = ?
    LIMIT 1
  `).get(id);
  return row ? rowToContextSnapshot(row) : null;
}

export function getRecentContextSnapshots(windowId?: number, limit: number = 20): ContextSnapshotRecord[] {
  const safeLimit = Math.max(1, Math.min(100, Math.round(limit)));
  const rows = typeof windowId === 'number' && windowId > 0
    ? getDatabase().prepare(`
      SELECT id, project_id, window_id, user_message_id, mode, budget_json, included_json, omitted_json,
             prompt_message_count, prompt_chars, estimated_prompt_tokens, created_at
      FROM context_snapshots
      WHERE window_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(windowId, safeLimit) as any[]
    : getDatabase().prepare(`
      SELECT id, project_id, window_id, user_message_id, mode, budget_json, included_json, omitted_json,
             prompt_message_count, prompt_chars, estimated_prompt_tokens, created_at
      FROM context_snapshots
      ORDER BY id DESC
      LIMIT ?
    `).all(safeLimit) as any[];
  return rows.map(rowToContextSnapshot);
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
    project_id: row.project_id || undefined,
    projectTitle: row.project_title || undefined,
    projectInstructions: row.project_instructions || row.project_instructions_snapshot || undefined,
    projectInstructionsSnapshot: row.project_instructions_snapshot || undefined,
    archived_at: row.archived_at || undefined,
    deleted_at: row.deleted_at || undefined,
    is_temporary: Boolean(row.is_temporary),
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_active_at: row.last_active_at,
    messageCount: Number(row.message_count || 0),
    lastMessagePreview: row.last_message_preview || undefined,
  };
}

function rowToContextSnapshot(row: any): ContextSnapshotRecord {
  return {
    id: row.id,
    project_id: row.project_id || undefined,
    window_id: row.window_id || undefined,
    user_message_id: row.user_message_id || undefined,
    mode: row.mode || undefined,
    budget: parseJsonObject(row.budget_json),
    included: parseJsonArray(row.included_json),
    omitted: parseJsonArray(row.omitted_json),
    prompt_message_count: Number(row.prompt_message_count || 0),
    prompt_chars: Number(row.prompt_chars || 0),
    estimated_prompt_tokens: Number(row.estimated_prompt_tokens || 0),
    created_at: row.created_at,
  };
}

function chatWindowSelectFields(): string {
  return `
    cw.id,
    cw.title,
    cw.summary,
    cw.mode,
    cw.working_state,
    cw.project_id,
    cw.project_instructions_snapshot,
    p.title AS project_title,
    p.instructions AS project_instructions,
    cw.is_temporary,
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
    LEFT JOIN projects p ON p.id = cw.project_id
    LEFT JOIN chat_messages cm ON cm.window_id = cw.id
  `;
}

function resolveProject(projectId?: number) {
  const project = projectId && projectId > 0 ? getProject(projectId) : null;
  return project || ensureDefaultProject();
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
  const previousMode = cleanChatWindowMode(state.lastMode);
  state.modeContinuity = updateModeContinuityState(state.modeContinuity, previousMode, update);
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

function updateModeContinuityState(
  existing: unknown,
  previousMode: ConversationMode | null,
  update: { id: number; role: MessageRole; content: string; mode: ConversationMode; messageCount: number },
): Record<string, unknown> {
  const continuity = isRecord(existing) ? { ...existing } : {};
  const modes = isRecord(continuity.modes) ? { ...continuity.modes } : {};
  const checkpoint = isRecord(modes[update.mode]) ? { ...modes[update.mode] as Record<string, unknown> } : {};
  const now = new Date().toISOString();

  checkpoint.lastMessageId = update.id;
  checkpoint.lastRole = update.role;
  checkpoint.lastMessagePreview = truncateChatWindowText(update.content, MAX_WORKING_STATE_VALUE_CHARS);
  checkpoint.messageCount = nonNegativeInteger(checkpoint.messageCount) + 1;
  checkpoint.updatedAt = now;
  if (update.role === 'user') checkpoint.lastUserMessage = truncateChatWindowText(update.content, MAX_WORKING_STATE_VALUE_CHARS);
  if (update.role === 'assistant') checkpoint.lastAssistantMessage = truncateChatWindowText(update.content, MAX_WORKING_STATE_VALUE_CHARS);
  modes[update.mode] = checkpoint;

  const transitions = readRecordArray(continuity.transitions);
  if (previousMode && previousMode !== update.mode) {
    transitions.push({ from: previousMode, to: update.mode, atMessageId: update.id, createdAt: now });
  }

  const confirmedDecisions = readStringList(continuity.confirmedDecisions);
  const openQuestions = readStringList(continuity.openQuestions);
  const nextActions = readStringList(continuity.nextActions);
  if (update.role === 'user') {
    appendUnique(confirmedDecisions, extractConfirmedDecision(update.content));
  }
  appendUnique(openQuestions, extractOpenQuestion(update.content));
  appendUnique(nextActions, extractNextAction(update.content));

  return {
    version: 1,
    activeMode: update.mode,
    previousMode: previousMode && previousMode !== update.mode ? previousMode : continuity.previousMode,
    lastTransitionMessageId: previousMode && previousMode !== update.mode ? update.id : continuity.lastTransitionMessageId,
    transitions: transitions.slice(-MAX_MODE_TRANSITIONS),
    modes,
    confirmedDecisions: confirmedDecisions.slice(-MAX_MODE_HANDOFF_ITEMS),
    openQuestions: openQuestions.slice(-MAX_MODE_HANDOFF_ITEMS),
    nextActions: nextActions.slice(-MAX_MODE_HANDOFF_ITEMS),
    updatedAt: now,
  };
}

function parseWorkingState(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord).map(item => ({ ...item })) : [];
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => truncateChatWindowText(item, 500))
    .filter(Boolean)
    .slice(-MAX_MODE_HANDOFF_ITEMS);
}

function appendUnique(values: string[], value: string): void {
  if (!value || values.includes(value)) return;
  values.push(value);
}

function extractConfirmedDecision(content: string): string {
  const normalized = truncateChatWindowText(content, 500);
  const match = normalized.match(/(?:我(?:决定|确认|选择|采用|选定|同意)|就按|确定用|方案(?:就)?定为)\s*[:：]?\s*(.{2,320})/i);
  return match ? truncateChatWindowText(match[0], 500) : '';
}

function extractOpenQuestion(content: string): string {
  const normalized = truncateChatWindowText(content, 500);
  const match = normalized.match(/(?:待确认|需要确认|尚未确定|还没确定|未决问题|open question)\s*[:：]?\s*(.{2,320})/i);
  return match ? truncateChatWindowText(match[0], 500) : '';
}

function extractNextAction(content: string): string {
  const normalized = truncateChatWindowText(content, 500);
  const match = normalized.match(/(?:下一步|接下来|后续动作|待办|next step)\s*[:：]?\s*(.{2,320})/i);
  return match ? truncateChatWindowText(match[0], 500) : '';
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string): ContextSnapshotDebugItem[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed as ContextSnapshotDebugItem[] : [];
  } catch {
    return [];
  }
}

function readPinnedFacts(state: Record<string, unknown>): ChatWindowPinnedFact[] {
  const raw = state.pinnedFacts;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): ChatWindowPinnedFact | null => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const text = typeof record.text === 'string' ? truncateChatWindowText(record.text, MAX_PINNED_FACT_CHARS) : '';
      if (!text) return null;
      const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : createPinnedFactId();
      const createdAt = typeof record.createdAt === 'string' && record.createdAt.trim() ? record.createdAt : new Date().toISOString();
      return { id, text, createdAt };
    })
    .filter((item): item is ChatWindowPinnedFact => Boolean(item))
    .slice(0, MAX_PINNED_FACTS_PER_WINDOW);
}

function updateChatWindowWorkingState(windowId: number, state: Record<string, unknown>): void {
  getDatabase().prepare(`
    UPDATE chat_windows
    SET working_state = ?,
        updated_at = datetime('now', 'localtime')
    WHERE id = ? AND deleted_at IS NULL
  `).run(JSON.stringify(state), windowId);
}

function createPinnedFactId(): string {
  return `pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
