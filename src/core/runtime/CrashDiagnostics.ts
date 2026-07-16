import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { redactLogValue } from '../../engine/Logger';

export type CrashKind = 'uncaught-exception' | 'unhandled-rejection' | 'renderer-gone' | 'window-unresponsive' | 'database-busy' | 'disk-full';

let installed = false;

export function installCrashDiagnostics(directory = defaultDiagnosticsDir()): void {
  if (installed) return;
  installed = true;
  process.on('uncaughtExceptionMonitor', error => recordCrashDiagnostic('uncaught-exception', { name: error.name, message: error.message, stack: error.stack }, directory));
  process.on('unhandledRejection', reason => recordCrashDiagnostic('unhandled-rejection', normalizeReason(reason), directory));
}

export function recordCrashDiagnostic(kind: CrashKind, detail: Record<string, unknown>, directory = defaultDiagnosticsDir()): string {
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, 'crash-diagnostics.jsonl');
  rotate(filePath, 1024 * 1024, 3);
  const safe = sanitizeDiagnostic({
    at: new Date().toISOString(), kind, pid: process.pid, platform: process.platform,
    arch: process.arch, node: process.versions.node, electron: process.versions.electron || null,
    detail,
  });
  fs.appendFileSync(filePath, `${JSON.stringify(safe)}\n`, 'utf8');
  return filePath;
}

function defaultDiagnosticsDir(): string { return process.env.ATHENA_DIAGNOSTICS_DIR || path.join(os.tmpdir(), 'athena', 'diagnostics'); }
function normalizeReason(reason: unknown): Record<string, unknown> { return reason instanceof Error ? { name: reason.name, message: reason.message, stack: reason.stack } : { message: String(reason) }; }
function sanitizeDiagnostic(value: unknown, key = ''): unknown {
  if (/authorization|cookie|password|secret|token|api[_-]?key|credential/i.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactLogValue(value).slice(0, 4_000);
  if (Array.isArray(value)) return value.slice(0, 30).map(item => sanitizeDiagnostic(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 50).map(([childKey, child]) => [childKey, sanitizeDiagnostic(child, childKey)]));
  return value;
}
function rotate(filePath: string, maxBytes: number, keep: number): void {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size < maxBytes) return;
  for (let index = keep - 1; index >= 1; index -= 1) {
    const source = `${filePath}.${index}`;
    const target = `${filePath}.${index + 1}`;
    if (fs.existsSync(source)) fs.renameSync(source, target);
  }
  fs.renameSync(filePath, `${filePath}.1`);
}
