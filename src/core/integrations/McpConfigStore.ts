import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { resolveMcpServersFile } from '../runtime/Paths';
import type { McpProtocolMode, McpServerConfig, McpServerInput } from '../../shared/types';

interface McpConfigState {
  version: 1;
  servers: McpServerConfig[];
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]{0,127}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_STATE_BYTES = 512 * 1024;
const MAX_SERVERS = 128;

export class McpConfigStore {
  private readonly file: string;
  private state: McpConfigState;

  constructor(file = resolveMcpServersFile()) {
    this.file = file;
    this.state = readState(file);
  }

  list(): McpServerConfig[] {
    return this.state.servers.map(server => structuredClone(server));
  }

  get(id: string): McpServerConfig | null {
    const server = this.state.servers.find(item => item.id === id);
    return server ? structuredClone(server) : null;
  }

  upsert(input: McpServerInput): McpServerConfig {
    const previous = structuredClone(this.state);
    const existing = input.id ? this.state.servers.find(item => item.id === input.id) : undefined;
    const normalized = normalizeServerInput(input, existing);
    const now = new Date().toISOString();
    const configFingerprint = fingerprintConfig(normalized);
    const changed = !existing || existing.configFingerprint !== configFingerprint;
    const next: McpServerConfig = {
      ...normalized,
      enabled: changed ? false : existing.enabled,
      configFingerprint,
      approvedFingerprint: changed ? null : existing.approvedFingerprint,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    if (existing) {
      this.state.servers = this.state.servers.map(item => item.id === existing.id ? next : item);
    } else {
      if (this.state.servers.length >= MAX_SERVERS) throw new Error(`MCP server limit reached (${MAX_SERVERS})`);
      if (this.state.servers.some(item => item.id === next.id)) throw new Error(`MCP server id already exists: ${next.id}`);
      this.state.servers.push(next);
    }
    try { this.persist(); } catch (error) { this.state = previous; throw error; }
    return structuredClone(next);
  }

  setApproved(id: string, fingerprint: string, approved: boolean): McpServerConfig {
    const previous = structuredClone(this.state);
    const server = this.requireExact(id, fingerprint);
    server.approvedFingerprint = approved ? fingerprint : null;
    if (!approved) server.enabled = false;
    server.updatedAt = new Date().toISOString();
    try { this.persist(); } catch (error) { this.state = previous; throw error; }
    return structuredClone(server);
  }

  setEnabled(id: string, fingerprint: string, enabled: boolean): McpServerConfig {
    const previous = structuredClone(this.state);
    const server = this.requireExact(id, fingerprint);
    if (enabled && server.approvedFingerprint !== server.configFingerprint) {
      throw new Error(`MCP server configuration must be approved before enabling: ${id}`);
    }
    server.enabled = enabled;
    server.updatedAt = new Date().toISOString();
    try { this.persist(); } catch (error) { this.state = previous; throw error; }
    return structuredClone(server);
  }

  remove(id: string, fingerprint: string): boolean {
    const previous = structuredClone(this.state);
    this.requireExact(id, fingerprint);
    this.state.servers = this.state.servers.filter(item => item.id !== id);
    try { this.persist(); } catch (error) { this.state = previous; throw error; }
    return true;
  }

  getPrivacyData(): McpConfigState {
    return structuredClone(this.state);
  }

  private requireExact(id: string, fingerprint: string): McpServerConfig {
    const server = this.state.servers.find(item => item.id === id);
    if (!server || server.configFingerprint !== fingerprint) {
      throw new Error(`MCP server configuration changed; refresh before modifying it: ${id}`);
    }
    return server;
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (fs.existsSync(this.file)) {
      const stat = fs.lstatSync(this.file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('MCP configuration state must be a real file');
    }
    const serialized = `${JSON.stringify(this.state, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) throw new Error('MCP configuration state exceeds its safety limit');
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    }
  }
}

function normalizeServerInput(input: McpServerInput, existing?: McpServerConfig): Omit<McpServerConfig, 'enabled' | 'configFingerprint' | 'approvedFingerprint' | 'createdAt' | 'updatedAt'> {
  const name = requireText(input.name, 'MCP server name', 120);
  const id = input.id ? normalizeId(input.id) : uniqueId(name);
  const protocolMode = normalizeProtocolMode(input.protocolMode || existing?.protocolMode || 'auto');
  if (input.transport === 'stdio') {
    const command = requireSingleLine(input.stdio?.command, 'MCP stdio command', 1_024);
    const args = normalizeArgumentList(input.stdio?.args, 64, 2_000);
    const cwdValue = input.stdio?.cwd;
    const cwd = cwdValue ? path.resolve(requireSingleLine(cwdValue, 'MCP working directory', 2_048)) : null;
    const envKeys = normalizeEnvKeys(input.stdio?.envKeys);
    return { id, name, transport: 'stdio', protocolMode, stdio: { command, args, cwd, envKeys }, http: null };
  }
  if (input.transport === 'streamable-http') {
    const url = normalizeMcpUrl(input.http?.url);
    const bearerTokenEnv = input.http?.bearerTokenEnv
      ? normalizeEnvKey(input.http.bearerTokenEnv)
      : null;
    return { id, name, transport: 'streamable-http', protocolMode, stdio: null, http: { url, bearerTokenEnv } };
  }
  throw new Error('Unsupported MCP transport');
}

function readState(file: string): McpConfigState {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STATE_BYTES) return emptyState();
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed?.version !== 1 || !Array.isArray(parsed.servers)) return emptyState();
    const clean = parsed.servers.slice(0, MAX_SERVERS).map(cleanStoredServer).filter(Boolean) as McpServerConfig[];
    const servers = clean.filter((server, index) => clean.findIndex(item => item.id === server.id) === index);
    return { version: 1, servers };
  } catch {
    return emptyState();
  }
}

function cleanStoredServer(value: unknown): McpServerConfig | null {
  if (!isRecord(value)) return null;
  try {
    const normalized = normalizeServerInput(value as unknown as McpServerInput);
    const configFingerprint = fingerprintConfig(normalized);
    const approvedFingerprint = value.approvedFingerprint === configFingerprint && SHA256_PATTERN.test(configFingerprint)
      ? configFingerprint
      : null;
    return {
      ...normalized,
      enabled: value.enabled === true && approvedFingerprint === configFingerprint,
      configFingerprint,
      approvedFingerprint,
      createdAt: validIso(value.createdAt) || new Date(0).toISOString(),
      updatedAt: validIso(value.updatedAt) || new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function fingerprintMcpConfig(server: Pick<McpServerConfig, 'id' | 'transport' | 'protocolMode' | 'stdio' | 'http'>): string {
  return fingerprintConfig(server);
}

export function describeMcpLaunch(server: McpServerConfig): string {
  if (server.transport === 'streamable-http') return `Connect to ${server.http?.url || '<invalid URL>'}`;
  const quote = (value: string) => /[\s"]/u.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  return [server.stdio?.command || '', ...(server.stdio?.args || [])].map(quote).join(' ');
}

function fingerprintConfig(value: Pick<McpServerConfig, 'id' | 'transport' | 'protocolMode' | 'stdio' | 'http'>): string {
  return createHash('sha256').update(JSON.stringify({
    id: value.id,
    transport: value.transport,
    protocolMode: value.protocolMode,
    stdio: value.stdio,
    http: value.http,
  })).digest('hex');
}

function normalizeMcpUrl(value: unknown): string {
  const raw = requireSingleLine(value, 'MCP URL', 2_048);
  const url = new URL(raw);
  if (url.username || url.password || url.hash) throw new Error('MCP URL cannot contain credentials or a fragment');
  const localhost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname.toLowerCase());
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localhost)) {
    throw new Error('Remote MCP URLs require HTTPS; HTTP is allowed only for localhost');
  }
  return url.toString();
}

function normalizeProtocolMode(value: unknown): McpProtocolMode {
  if (value === 'legacy' || value === 'auto' || value === '2026-07-28') return value;
  throw new Error('Invalid MCP protocol mode');
}

function normalizeEnvKeys(value: unknown): string[] {
  const list = normalizeStringList(value, 'MCP environment keys', 64, 128);
  return Array.from(new Set(list.map(normalizeEnvKey))).sort();
}

function normalizeEnvKey(value: unknown): string {
  const key = requireSingleLine(value, 'MCP environment key', 128);
  if (!ENV_KEY_PATTERN.test(key)) throw new Error(`Invalid environment variable name: ${key}`);
  return key;
}

function normalizeStringList(value: unknown, label: string, maxItems: number, maxChars: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label} must contain at most ${maxItems} items`);
  return value.map(item => requireSingleLine(item, label, maxChars));
}

function normalizeArgumentList(value: unknown, maxItems: number, maxChars: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`MCP stdio arguments must contain at most ${maxItems} items`);
  return value.map(item => {
    if (typeof item !== 'string' || item.length === 0 || item.length > maxChars) {
      throw new Error(`MCP stdio argument is required and must be at most ${maxChars} characters`);
    }
    if (/[\0\r\n]/u.test(item)) throw new Error('MCP stdio argument must be a single line');
    return item;
  });
}

function normalizeId(value: unknown): string {
  const id = requireSingleLine(value, 'MCP server id', 48).toLowerCase();
  if (!ID_PATTERN.test(id)) throw new Error(`Invalid MCP server id: ${id}`);
  return id;
}

function uniqueId(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'mcp';
  return normalizeId(`${base}-${randomUUID().slice(0, 8)}`);
}

function requireText(value: unknown, label: string, max: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > max) throw new Error(`${label} is required and must be at most ${max} characters`);
  return text;
}

function requireSingleLine(value: unknown, label: string, max: number): string {
  const text = requireText(value, label, max);
  if (/[\0\r\n]/u.test(text)) throw new Error(`${label} must be a single line`);
  return text;
}

function validIso(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function emptyState(): McpConfigState { return { version: 1, servers: [] }; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
