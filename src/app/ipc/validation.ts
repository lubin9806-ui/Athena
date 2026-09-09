import type { ConversationMode } from '../../shared/types';
import * as fs from 'fs';
import * as path from 'path';

export const MAX_CHAT_CHARS = 20_000;

interface SenderEventLike {
  sender: unknown;
}

interface WindowLike {
  isDestroyed(): boolean;
  webContents: unknown;
}

export function isTrustedIpcSender(event: SenderEventLike, window: WindowLike): boolean {
  return !window.isDestroyed() && event.sender === window.webContents;
}

export function cleanChatPayload(value: unknown, fallbackMode: ConversationMode): {
  text: string;
  mode: ConversationMode;
  forceWebSearch: boolean;
  chatWindowId?: number;
  attachmentIds: string[];
  routingTicket?: string;
} | null {
  const payload = isRecord(value) ? value : null;
  const textValue = payload?.text ?? value;
  const text = typeof textValue === 'string' ? textValue.slice(0, MAX_CHAT_CHARS).trim() : '';
  if (!text) return null;
  const mode = payload?.mode === 'create' || payload?.mode === 'companion' || payload?.mode === 'reason' || payload?.mode === 'execute'
    ? payload.mode
    : fallbackMode;
  const chatWindowId = cleanPositiveInteger(payload?.chatWindowId);
  return {
    text,
    mode,
    forceWebSearch: payload?.forceWebSearch === true,
    chatWindowId: chatWindowId || undefined,
    attachmentIds: cleanAttachmentIds(payload?.attachmentIds),
    routingTicket: cleanRoutingTicket(payload?.routingTicket),
  };
}

function cleanRoutingTicket(value: unknown): string | undefined {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}

export function cleanAttachmentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value
    .filter((item): item is string => typeof item === 'string')
    .filter(item => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item));
  return Array.from(new Set(ids)).slice(0, 5);
}

export const MAX_DROPPED_TEXT_CHARS = 200_000;

/**
 * Paths handed over by a drop. Unlike a file picker these may name folders, and
 * the format is decided later by reading the bytes — so this only checks that
 * each path is a real file or directory the renderer could legitimately drop.
 * Symlinks fail both tests and are dropped, matching the attachment store.
 */
export function cleanDroppedPaths(value: unknown, maxPaths = 20, maxChars = 2_048): string[] {
  if (!Array.isArray(value)) return [];
  const paths: string[] = [];
  for (const item of value) {
    if (paths.length >= maxPaths) break;
    if (typeof item !== 'string' || item.length === 0 || item.length > maxChars) continue;
    const resolved = path.resolve(item);
    try {
      const stat = fs.lstatSync(resolved);
      if (stat.isFile() || stat.isDirectory()) paths.push(resolved);
    } catch {
      // A path that no longer exists is simply not accepted.
    }
  }
  return Array.from(new Set(paths));
}

/** Only absolute http(s) URLs are worth a network request on the user's behalf. */
export function cleanHttpUrl(value: unknown, maxChars = 2_048): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxChars) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function cleanExistingFilePath(value: unknown, extensions: readonly string[], maxChars = 2_048): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxChars) return null;
  const resolved = path.resolve(value);
  const extension = path.extname(resolved).toLowerCase().replace(/^\./, '');
  if (!extensions.includes(extension)) return null;
  try {
    return fs.statSync(resolved).isFile() ? resolved : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanPositiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
