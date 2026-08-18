import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import JSZip from 'jszip';
import { getAppSettings, getSettingsBundle } from '../config/SettingsStore';
import { getExportDir } from '../privacy/PrivacyDataService';
import { clearCrashDiagnostics, getDiagnosticsDir, readCrashDiagnosticSummary } from '../runtime/CrashDiagnostics';
import { getDatabase, getDatabaseFilePath, getStats } from '../../memory/database';
import { APP_VERSION } from '../../shared/constants';

export interface DiagnosticSupplementalData {
  skills?: unknown;
  integrations?: unknown;
}

export interface DiagnosticHealthSnapshot {
  generatedAt: string;
  product: {
    name: 'Athena Desktop';
    version: string;
    sku: string;
    build: { channel?: string; shortCommit?: string; buildInputSha256?: string; cleanCheckout?: boolean } | null;
  };
  runtime: { platform: string; release: string; arch: string; node: string; electron: string | null };
  storage: {
    database: { schema: number; bytes: number; quickCheck: 'ok' | 'failed'; stats: ReturnType<typeof getStats> };
    diagnostics: { path: string; files: number; bytes: number; malformedLines: number };
    exports: { path: string; freeBytes: number | null };
  };
  configuration: {
    provider: string;
    setupComplete: boolean;
    saveHistory: boolean;
    toolPermission: string;
    networkConsent: Record<string, boolean>;
  };
  agent: {
    tasksByStatus: Record<string, number>;
    runsByStatus: Record<string, number>;
    eventsByType: Record<string, number>;
  };
  extensions: {
    skills: { packages: number; invocations: number };
    integrations: { servers: number; enabled: number };
  };
}

export interface DiagnosticBundleResult {
  path: string;
  bytes: number;
  sha256: string;
  includedFiles: string[];
  privacy: 'no-chat-content';
}

const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;

export class DiagnosticsService {
  getHealthSnapshot(supplemental: DiagnosticSupplementalData = {}): DiagnosticHealthSnapshot {
    const db = getDatabase();
    const settings = getAppSettings();
    const bundle = getSettingsBundle();
    const databasePath = getDatabaseFilePath();
    const crash = readCrashDiagnosticSummary();
    const exports = getExportDir();
    const quickCheck = db.pragma('quick_check(1)', { simple: true }) === 'ok' ? 'ok' : 'failed';
    return {
      generatedAt: new Date().toISOString(),
      product: { name: 'Athena Desktop', version: APP_VERSION, sku: bundle.sku, build: readBuildInfo() },
      runtime: {
        platform: process.platform,
        release: os.release(),
        arch: process.arch,
        node: process.versions.node,
        electron: process.versions.electron || null,
      },
      storage: {
        database: {
          schema: Number(db.pragma('user_version', { simple: true })) || 0,
          bytes: regularFileBytes(databasePath),
          quickCheck,
          stats: getStats(),
        },
        diagnostics: {
          path: portablePath(getDiagnosticsDir()),
          files: crash.fileCount,
          bytes: crash.totalBytes,
          malformedLines: crash.malformedLines,
        },
        exports: { path: portablePath(exports), freeBytes: freeBytesFor(exports) },
      },
      configuration: {
        provider: bundle.model.provider,
        setupComplete: bundle.model.setupComplete,
        saveHistory: settings.conversation.saveHistory,
        toolPermission: settings.tools.permissionLevel,
        networkConsent: Object.fromEntries(Object.entries(settings.privacy.networkConsent).map(([key, value]) => [key, value === true])),
      },
      agent: {
        tasksByStatus: groupedCounts('agent_tasks', 'status'),
        runsByStatus: groupedCounts('agent_runs', 'status'),
        eventsByType: groupedCounts('agent_run_events', 'type'),
      },
      extensions: summarizeExtensions(supplemental),
    };
  }

  async exportSupportBundle(supplemental: DiagnosticSupplementalData = {}): Promise<DiagnosticBundleResult> {
    const health = this.getHealthSnapshot(supplemental);
    const crashes = readCrashDiagnosticSummary();
    const files: Record<string, string> = {
      'README.txt': supportReadme(),
      'health.json': `${JSON.stringify(health, null, 2)}\n`,
      'crashes.json': `${JSON.stringify(crashes, null, 2)}\n`,
    };
    files['manifest.json'] = `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: health.generatedAt,
      privacy: 'no-chat-content',
      files: Object.entries(files).map(([name, content]) => ({
        name,
        bytes: Buffer.byteLength(content),
        sha256: sha256(Buffer.from(content)),
      })),
    }, null, 2)}\n`;
    const zip = new JSZip();
    for (const [name, content] of Object.entries(files)) zip.file(name, content, { date: new Date(0) });
    const bytes = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      platform: 'UNIX',
    });
    if (!bytes.length || bytes.length > MAX_BUNDLE_BYTES) throw new Error('Diagnostic support bundle exceeded the 5 MB limit.');
    const exportDir = ensureExportDirectory();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(exportDir, `athena-support-${stamp}.zip`);
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, target);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    return {
      path: target,
      bytes: bytes.length,
      sha256: sha256(bytes),
      includedFiles: Object.keys(files).sort(),
      privacy: 'no-chat-content',
    };
  }

  clear(): { filesDeleted: number } {
    return { filesDeleted: clearCrashDiagnostics() };
  }
}

function groupedCounts(table: 'agent_tasks' | 'agent_runs' | 'agent_run_events', column: 'status' | 'type'): Record<string, number> {
  try {
    const rows = getDatabase().prepare(`SELECT ${column} AS label, COUNT(*) AS count FROM ${table} GROUP BY ${column}`).all() as Array<{ label: string; count: number }>;
    return Object.fromEntries(rows.map(row => [String(row.label).slice(0, 80), Number(row.count)]));
  } catch { return {}; }
}

function summarizeExtensions(data: DiagnosticSupplementalData): DiagnosticHealthSnapshot['extensions'] {
  const skills = isRecord(data.skills) ? data.skills : {};
  const packages = isRecord(skills.packages) ? Object.keys(skills.packages).length : 0;
  const invocations = Array.isArray(skills.invocations) ? skills.invocations.length : 0;
  const integrations = isRecord(data.integrations) && Array.isArray(data.integrations.servers) ? data.integrations.servers : [];
  return {
    skills: { packages, invocations },
    integrations: {
      servers: integrations.length,
      enabled: integrations.filter(server => isRecord(server) && server.enabled === true).length,
    },
  };
}

function ensureExportDirectory(): string {
  const directory = path.resolve(getExportDir());
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Diagnostic export directory must be a real directory.');
  return directory;
}

function freeBytesFor(directory: string): number | null {
  try {
    const existing = fs.existsSync(directory) ? directory : path.dirname(directory);
    const stat = fs.statfsSync(existing);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch { return null; }
}

function regularFileBytes(filePath: string): number {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink() ? stat.size : 0;
  } catch { return 0; }
}

function portablePath(value: string): string {
  const resolved = path.resolve(value);
  const replacements = [
    [path.resolve(os.homedir()), '%USERPROFILE%'],
    [path.resolve(process.cwd()), '<APP_ROOT>'],
  ] as const;
  for (const [prefix, replacement] of replacements) {
    if (resolved.toLowerCase() === prefix.toLowerCase()) return replacement;
    if (resolved.toLowerCase().startsWith(`${prefix.toLowerCase()}${path.sep}`)) return `${replacement}${resolved.slice(prefix.length)}`;
  }
  return `<${path.parse(resolved).root.replace(/[\\/:]/g, '') || 'LOCAL'}>${resolved.slice(path.parse(resolved).root.length)}`;
}

function supportReadme(): string {
  return [
    'Athena local diagnostic support bundle',
    '',
    'This archive is created locally and is never uploaded automatically.',
    'It contains runtime versions, health counters, storage sizes, capability states, and minimized crash event metadata.',
    'It excludes chat content, memory text, task goals, tool arguments/results, commands, URLs, API credentials, attachments, documents, and raw stack traces.',
    'Review the files before sharing this archive with anyone.',
    '',
  ].join('\n');
}

function readBuildInfo(): DiagnosticHealthSnapshot['product']['build'] {
  const candidates = [
    path.join(process.resourcesPath || '', 'build-info.json'),
    path.join(process.cwd(), '.build', 'build-info.json'),
  ];
  for (const candidate of candidates) {
    try {
      const stat = fs.lstatSync(candidate);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 16 * 1024) continue;
      const value = JSON.parse(fs.readFileSync(candidate, 'utf8')) as Record<string, unknown>;
      return {
        ...(typeof value.channel === 'string' ? { channel: value.channel.slice(0, 40) } : {}),
        ...(typeof value.shortCommit === 'string' && /^[0-9a-f]{7,40}$/i.test(value.shortCommit) ? { shortCommit: value.shortCommit } : {}),
        ...(typeof value.buildInputSha256 === 'string' && /^[0-9a-f]{64}$/i.test(value.buildInputSha256) ? { buildInputSha256: value.buildInputSha256.toLowerCase() } : {}),
        ...(typeof value.cleanCheckout === 'boolean' ? { cleanCheckout: value.cleanCheckout } : {}),
      };
    } catch { /* Try the next trusted build-info location. */ }
  }
  return null;
}

function sha256(bytes: Buffer): string { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
