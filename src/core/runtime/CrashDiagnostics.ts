import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { redactLogValue } from '../../engine/Logger';

export type CrashKind = 'uncaught-exception' | 'unhandled-rejection' | 'renderer-gone' | 'window-unresponsive' | 'database-busy' | 'disk-full';

export interface CrashDiagnosticSummary {
  fileCount: number;
  totalBytes: number;
  malformedLines: number;
  events: Array<{
    at: string;
    kind: string;
    runtime: { platform?: string; arch?: string; node?: string; electron?: string | null };
    detail: { name?: string; reason?: string; exitCode?: number };
  }>;
}

let installed = false;

export function installCrashDiagnostics(directory = defaultDiagnosticsDir()): void {
  if (installed) return;
  installed = true;
  process.on('uncaughtExceptionMonitor', error => safeRecord('uncaught-exception', { name: error.name, message: error.message, stack: error.stack }, directory));
  process.on('unhandledRejection', reason => safeRecord('unhandled-rejection', normalizeReason(reason), directory));
}

export function recordCrashDiagnostic(kind: CrashKind, detail: Record<string, unknown>, directory = defaultDiagnosticsDir()): string {
  ensureDiagnosticsDirectory(directory);
  const filePath = path.join(directory, 'crash-diagnostics.jsonl');
  rotate(filePath, 1024 * 1024, 3);
  const safe = sanitizeDiagnostic({
    at: new Date().toISOString(), kind, pid: process.pid, platform: process.platform,
    arch: process.arch, node: process.versions.node, electron: process.versions.electron || null,
    detail,
  });
  fs.appendFileSync(filePath, `${JSON.stringify(safe)}\n`, { encoding: 'utf8', mode: 0o600 });
  return filePath;
}

export function getDiagnosticsDir(): string { return path.resolve(process.env.ATHENA_DIAGNOSTICS_DIR || path.join(os.tmpdir(), 'athena', 'diagnostics')); }

export function readCrashDiagnosticSummary(directory = getDiagnosticsDir()): CrashDiagnosticSummary {
  if (!isRealDirectory(directory)) return { fileCount: 0, totalBytes: 0, malformedLines: 0, events: [] };
  const files = diagnosticFiles(directory).filter(filePath => isRegularFile(filePath));
  let totalBytes = 0;
  let malformedLines = 0;
  const events: CrashDiagnosticSummary['events'] = [];
  for (const filePath of files.reverse()) {
    const bytes = fs.readFileSync(filePath);
    totalBytes += bytes.length;
    for (const line of bytes.toString('utf8').split(/\r?\n/).filter(Boolean).slice(-200)) {
      try {
        const value = JSON.parse(line) as Record<string, unknown>;
        const detail = isRecord(value.detail) ? value.detail : {};
        events.push({
          at: typeof value.at === 'string' ? value.at.slice(0, 40) : '',
          kind: typeof value.kind === 'string' ? value.kind.slice(0, 80) : 'unknown',
          runtime: {
            ...(typeof value.platform === 'string' ? { platform: value.platform.slice(0, 40) } : {}),
            ...(typeof value.arch === 'string' ? { arch: value.arch.slice(0, 40) } : {}),
            ...(typeof value.node === 'string' ? { node: value.node.slice(0, 40) } : {}),
            ...(typeof value.electron === 'string' || value.electron === null ? { electron: value.electron } : {}),
          },
          detail: {
            ...(typeof detail.name === 'string' ? { name: detail.name.slice(0, 120) } : {}),
            ...(typeof detail.reason === 'string' ? { reason: detail.reason.slice(0, 120) } : {}),
            ...(typeof detail.exitCode === 'number' && Number.isInteger(detail.exitCode) ? { exitCode: detail.exitCode } : {}),
          },
        });
      } catch {
        malformedLines += 1;
      }
    }
  }
  return { fileCount: files.length, totalBytes, malformedLines, events: events.slice(-200) };
}

export function clearCrashDiagnostics(directory = getDiagnosticsDir()): number {
  if (!isRealDirectory(directory)) return 0;
  let removed = 0;
  for (const filePath of diagnosticFiles(directory)) {
    if (!isRegularFile(filePath)) continue;
    fs.rmSync(filePath, { force: true });
    removed += 1;
  }
  return removed;
}

function defaultDiagnosticsDir(): string { return getDiagnosticsDir(); }
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
  fs.rmSync(`${filePath}.${keep}`, { force: true });
  for (let index = keep - 1; index >= 1; index -= 1) {
    const source = `${filePath}.${index}`;
    const target = `${filePath}.${index + 1}`;
    if (fs.existsSync(source)) fs.renameSync(source, target);
  }
  fs.renameSync(filePath, `${filePath}.1`);
}

function safeRecord(kind: CrashKind, detail: Record<string, unknown>, directory: string): void {
  try { recordCrashDiagnostic(kind, detail, directory); } catch { /* Diagnostics must never cause a second process failure. */ }
}

function ensureDiagnosticsDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!isRealDirectory(directory)) throw new Error('Diagnostics directory must be a real directory.');
}

function diagnosticFiles(directory: string): string[] {
  const base = path.join(path.resolve(directory), 'crash-diagnostics.jsonl');
  return [base, `${base}.1`, `${base}.2`, `${base}.3`];
}

function isRealDirectory(directory: string): boolean {
  try {
    const stat = fs.lstatSync(directory);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch { return false; }
}

function isRegularFile(filePath: string): boolean {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch { return false; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
