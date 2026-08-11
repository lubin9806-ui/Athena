import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parseDocument } from 'yaml';
import { resolveSkillDiscoveryRoots, resolveSkillStateFile, resolveUserSkillsRoot } from '../runtime/Paths';
import type {
  AgentSkillDetail,
  AgentSkillInvocationRecord,
  AgentSkillLibrarySnapshot,
  AgentSkillSummary,
  SkillSourceKind,
  SkillTrustStatus,
} from '../../shared/types';

interface SkillState {
  version: 1;
  packages: Record<string, { trust: SkillTrustStatus; enabled: boolean }>;
  invocations: AgentSkillInvocationRecord[];
}

interface ParsedSkill extends AgentSkillDetail {
  skillFile: string;
}

const NAME_PATTERN = /^(?!-)(?!.*--)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEXT_RESOURCE_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.tsv', '.js', '.mjs', '.cjs', '.ts', '.py', '.ps1', '.sh']);
const MAX_SKILL_FILE_BYTES = 512 * 1024;
const MAX_RESOURCE_BYTES = 2 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 24 * 1024 * 1024;
const MAX_PACKAGE_FILES = 2_000;
const MAX_STATE_BYTES = 4 * 1024 * 1024;
const MAX_STATE_PACKAGES = 5_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface SkillLibraryOptions {
  roots?: Array<{ source: SkillSourceKind; path: string }>;
  stateFile?: string;
  userRoot?: string;
}

export class SkillLibrary {
  private readonly roots: Array<{ source: SkillSourceKind; path: string }>;
  private readonly stateFile: string;
  private readonly userRoot: string;
  private state: SkillState;
  private active = new Map<string, ParsedSkill>();
  private diagnostics: Array<{ source: SkillSourceKind; path: string; error: string }> = [];

  constructor(options: SkillLibraryOptions = {}) {
    this.roots = options.roots || resolveSkillDiscoveryRoots();
    this.stateFile = options.stateFile || resolveSkillStateFile();
    this.userRoot = options.userRoot || resolveUserSkillsRoot();
    this.state = readState(this.stateFile);
  }

  discover(): AgentSkillSummary[] {
    const candidates: ParsedSkill[] = [];
    this.diagnostics = [];
    for (const root of this.roots) {
      if (!fs.existsSync(root.path)) continue;
      for (const directory of skillDirectories(root.path)) {
        try {
          candidates.push(parseSkill(directory, root.source, this.state));
        } catch (error) {
          this.diagnostics.push({
            source: root.source,
            path: directory,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    this.active = resolveActiveSkills(candidates);
    return Array.from(this.active.values()).map(toSummary).sort((a, b) => a.name.localeCompare(b.name));
  }

  snapshot(): AgentSkillLibrarySnapshot {
    if (this.active.size === 0) this.discover();
    return {
      skills: Array.from(this.active.values()).map(toSummary).sort((a, b) => a.name.localeCompare(b.name)),
      invocations: this.state.invocations.slice(-200).reverse().map(item => ({ ...item })),
      roots: this.roots.map(item => ({ ...item })),
      diagnostics: this.diagnostics.map(item => ({ ...item })),
    };
  }

  getPrivacyData(): { packages: SkillState['packages']; invocations: AgentSkillInvocationRecord[] } {
    return {
      packages: structuredClone(this.state.packages),
      invocations: this.state.invocations.map(item => ({ ...item })),
    };
  }

  clearInvocationHistory(): number {
    const deleted = this.state.invocations.length;
    if (deleted === 0) return 0;
    this.state.invocations = [];
    this.persistState();
    return deleted;
  }

  get(name: string): AgentSkillSummary | null {
    if (this.active.size === 0) this.discover();
    const skill = this.active.get(name);
    return skill ? toSummary(skill) : null;
  }

  load(name: string, context: { runId: string; stepId: string }): AgentSkillDetail {
    const skill = this.requireUsable(name);
    this.recordInvocation(skill, 'SKILL.md', context);
    return toDetail(skill);
  }

  readResource(name: string, resourcePath: string, context: { runId: string; stepId: string }): string {
    const skill = this.requireUsable(name);
    const normalized = normalizeResourcePath(resourcePath);
    if (!skill.resources.includes(normalized)) throw new Error(`Skill resource is not indexed: ${name}/${normalized}`);
    if (!TEXT_RESOURCE_EXTENSIONS.has(path.extname(normalized).toLowerCase())) {
      throw new Error(`Skill resource is not a readable text resource: ${normalized}`);
    }
    const target = path.resolve(skill.rootPath, normalized);
    assertInside(skill.rootPath, target);
    const stat = fs.statSync(target);
    if (stat.size > MAX_RESOURCE_BYTES) throw new Error(`Skill resource exceeds ${MAX_RESOURCE_BYTES} bytes`);
    const content = fs.readFileSync(target, 'utf8');
    this.recordInvocation(skill, normalized, context);
    return content;
  }

  setTrust(name: string, packageHash: string, trust: Exclude<SkillTrustStatus, 'builtin'>): AgentSkillSummary {
    const skill = this.requireExact(name, packageHash);
    this.state.packages[packageHash] = {
      trust,
      enabled: trust === 'approved' ? (this.state.packages[packageHash]?.enabled ?? true) : false,
    };
    this.persistState();
    this.discover();
    return this.get(skill.name) || toSummary({ ...skill, trust, enabled: trust === 'approved' });
  }

  setEnabled(name: string, packageHash: string, enabled: boolean): AgentSkillSummary {
    const skill = this.requireExact(name, packageHash);
    if (enabled && skill.trust !== 'approved' && skill.trust !== 'builtin') {
      throw new Error(`Skill ${name} must be approved before it can be enabled`);
    }
    this.state.packages[packageHash] = { trust: skill.trust, enabled };
    this.persistState();
    this.discover();
    return this.get(name) || toSummary({ ...skill, enabled });
  }

  installFromDirectory(sourceDirectory: string, replace = false): AgentSkillSummary {
    const source = path.resolve(sourceDirectory);
    const parsed = parseSkill(source, 'external', this.state);
    this.discover();
    const activeCollision = this.active.get(parsed.name);
    if (activeCollision && (activeCollision.source === 'builtin' || activeCollision.source === 'project')) {
      throw new Error(`Skill name conflicts with ${activeCollision.source} package: ${parsed.name}`);
    }
    fs.mkdirSync(this.userRoot, { recursive: true });
    const target = path.join(this.userRoot, parsed.name);
    const staging = path.join(this.userRoot, `.install-${parsed.name}-${randomUUID()}`);
    const backup = path.join(this.userRoot, `.backup-${parsed.name}-${randomUUID()}`);
    if (fs.existsSync(target) && !replace) throw new Error(`Skill is already installed: ${parsed.name}`);
    const previousPackages = structuredClone(this.state.packages);
    const previousTarget = fs.existsSync(target) ? parseSkill(target, 'user', this.state) : null;
    let targetSwapped = false;
    try {
      copyPackage(source, staging);
      const staged = parseSkill(staging, 'user', this.state, parsed.name);
      if (staged.packageHash !== parsed.packageHash) throw new Error('Installed skill hash changed during copy');
      if (fs.existsSync(target)) fs.renameSync(target, backup);
      fs.renameSync(staging, target);
      targetSwapped = true;
      if (previousTarget) delete this.state.packages[previousTarget.packageHash];
      this.state.packages[staged.packageHash] = { trust: 'untrusted', enabled: false };
      this.persistState();
      if (fs.existsSync(backup)) {
        try { fs.rmSync(backup, { recursive: true, force: true }); } catch {}
      }
      this.discover();
      return this.get(staged.name) || toSummary({ ...staged, rootPath: target });
    } catch (error) {
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
      if (targetSwapped && fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
      if (!fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
      this.state.packages = previousPackages;
      throw error;
    }
  }

  uninstall(name: string, packageHash: string): boolean {
    const skill = this.requireExact(name, packageHash);
    if (skill.source !== 'user') throw new Error(`Only user-installed skills can be uninstalled: ${name}`);
    assertInside(this.userRoot, skill.rootPath);
    const removed = path.join(this.userRoot, `.remove-${name}-${randomUUID()}`);
    const previousPackages = structuredClone(this.state.packages);
    fs.renameSync(skill.rootPath, removed);
    try {
      delete this.state.packages[packageHash];
      this.persistState();
      try { fs.rmSync(removed, { recursive: true, force: true }); } catch {}
      this.discover();
      return true;
    } catch (error) {
      if (!fs.existsSync(skill.rootPath) && fs.existsSync(removed)) fs.renameSync(removed, skill.rootPath);
      this.state.packages = previousPackages;
      throw error;
    }
  }

  private requireUsable(name: string): ParsedSkill {
    if (this.active.size === 0) this.discover();
    const skill = this.active.get(name);
    if (!skill) throw new Error(`Skill not found: ${name}`);
    this.assertPackageUnchanged(skill);
    if (!skill.enabled) throw new Error(`Skill is disabled: ${name}`);
    if (skill.trust !== 'approved' && skill.trust !== 'builtin') throw new Error(`Skill is not trusted: ${name}`);
    return skill;
  }

  private requireExact(name: string, packageHash: string): ParsedSkill {
    if (this.active.size === 0) this.discover();
    const skill = this.active.get(name);
    if (skill) this.assertPackageUnchanged(skill);
    if (!skill || skill.packageHash !== packageHash) throw new Error(`Skill package changed; refresh before modifying trust: ${name}`);
    return skill;
  }

  private assertPackageUnchanged(skill: ParsedSkill): void {
    try {
      const currentHash = hashFiles(skill.rootPath, packageFiles(skill.rootPath));
      if (currentHash === skill.packageHash) return;
    } catch {
      // Missing or unreadable package content is treated as a trust-breaking change.
    }
    this.discover();
    throw new Error(`Skill package changed and must be reviewed again: ${skill.name}`);
  }

  private recordInvocation(skill: ParsedSkill, resourcePath: string, context: { runId: string; stepId: string }): void {
    this.state.invocations.push({
      id: randomUUID(),
      skillName: skill.name,
      packageHash: skill.packageHash,
      runId: context.runId,
      stepId: context.stepId,
      resourcePath,
      loadedAt: new Date().toISOString(),
    });
    this.state.invocations = this.state.invocations.slice(-1_000);
    this.persistState();
  }

  private persistState(): void {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    if (fs.existsSync(this.stateFile)) {
      const existing = fs.lstatSync(this.stateFile);
      if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('Skill state must be a real file');
    }
    const temporary = `${this.stateFile}.${process.pid}.${randomUUID()}.tmp`;
    const serialized = `${JSON.stringify(this.state, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) throw new Error('Skill state exceeds its safety limit');
    try {
      fs.writeFileSync(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporary, this.stateFile);
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    }
  }
}

function parseSkill(directory: string, source: SkillSourceKind, state: SkillState, expectedName?: string): ParsedSkill {
  const rootPath = path.resolve(directory);
  const rootStat = fs.lstatSync(rootPath);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Skill root must be a real directory');
  const skillFile = path.join(rootPath, 'SKILL.md');
  const stat = fs.lstatSync(skillFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SKILL_FILE_BYTES) throw new Error('Invalid SKILL.md file');
  const raw = fs.readFileSync(skillFile, 'utf8').replace(/^\uFEFF/, '');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error('SKILL.md requires YAML frontmatter');
  const document = parseDocument(match[1], { uniqueKeys: true });
  if (document.errors.length > 0) throw new Error(`Invalid skill YAML: ${document.errors[0].message}`);
  const manifest = document.toJS({ maxAliasCount: 20 });
  if (!isRecord(manifest)) throw new Error('Skill frontmatter must be a mapping');
  const name = requireString(manifest.name, 'name', 64);
  if (!NAME_PATTERN.test(name)) throw new Error(`Invalid skill name: ${name}`);
  const folderName = expectedName || path.basename(rootPath);
  if (name !== folderName) throw new Error(`Skill name must match its directory: ${name} != ${folderName}`);
  const description = requireString(manifest.description, 'description', 1_024);
  const instructions = match[2].trim();
  if (!instructions) throw new Error('Skill instructions cannot be empty');
  const files = packageFiles(rootPath);
  const packageHash = hashFiles(rootPath, files);
  const trust = source === 'builtin' ? 'builtin' : state.packages[packageHash]?.trust || 'untrusted';
  const enabled = source === 'builtin' ? true : trust === 'approved' && (state.packages[packageHash]?.enabled ?? true);
  const metadata = stringMap(manifest.metadata);
  const resources = files.filter(file => file !== 'SKILL.md');
  return {
    name,
    description,
    version: metadata.version || null,
    license: optionalString(manifest.license, 500),
    compatibility: optionalString(manifest.compatibility, 500),
    allowedTools: typeof manifest['allowed-tools'] === 'string' ? manifest['allowed-tools'].split(/\s+/).filter(Boolean) : [],
    metadata,
    source,
    rootPath,
    skillFile,
    manifestHash: sha256(raw),
    packageHash,
    trust,
    enabled,
    hasScripts: resources.some(file => file.startsWith('scripts/')),
    resourceCount: resources.length,
    warnings: typeof manifest['allowed-tools'] === 'string' ? ['allowed-tools is experimental and does not grant Athena permissions'] : [],
    instructions,
    resources,
  };
}

function resolveActiveSkills(candidates: ParsedSkill[]): Map<string, ParsedSkill> {
  const output = new Map<string, ParsedSkill>();
  const rank = (skill: ParsedSkill) => (skill.trust === 'builtin' || skill.trust === 'approved' ? 100 : 0)
    + ({ project: 4, user: 3, builtin: 2, external: 1 }[skill.source]);
  for (const skill of candidates.sort((a, b) => rank(b) - rank(a))) {
    if (!output.has(skill.name)) output.set(skill.name, skill);
  }
  return output;
}

function skillDirectories(root: string): string[] {
  const direct = path.join(root, 'SKILL.md');
  if (fs.existsSync(direct)) return [root];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.'))
    .map(entry => path.join(root, entry.name))
    .filter(directory => fs.existsSync(path.join(directory, 'SKILL.md')));
}

function packageFiles(root: string): string[] {
  const files: string[] = [];
  let bytes = 0;
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Skill packages cannot contain symbolic links: ${entry.name}`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        const stat = fs.statSync(absolute);
        bytes += stat.size;
        if (bytes > MAX_PACKAGE_BYTES || files.length >= MAX_PACKAGE_FILES) throw new Error('Skill package exceeds safety limits');
        files.push(path.relative(root, absolute).replace(/\\/g, '/'));
      }
    }
  };
  visit(root);
  return files.sort();
}

function hashFiles(root: string, files: string[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file); hash.update('\0'); hash.update(fs.readFileSync(path.join(root, file))); hash.update('\0');
  }
  return hash.digest('hex');
}

function copyPackage(source: string, target: string): void {
  fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false, dereference: false });
}

function readState(file: string): SkillState {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STATE_BYTES) return emptyState();
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed?.version !== 1 || !isRecord(parsed.packages) || !Array.isArray(parsed.invocations)) return emptyState();
    const packages: SkillState['packages'] = {};
    for (const [hash, value] of Object.entries(parsed.packages).slice(0, MAX_STATE_PACKAGES)) {
      if (!SHA256_PATTERN.test(hash) || !isRecord(value)) continue;
      if (!['approved', 'untrusted', 'quarantined'].includes(String(value.trust)) || typeof value.enabled !== 'boolean') continue;
      packages[hash] = { trust: value.trust as Exclude<SkillTrustStatus, 'builtin'>, enabled: value.enabled };
    }
    const invocations = parsed.invocations.slice(-1_000).map(cleanInvocationRecord).filter(Boolean) as AgentSkillInvocationRecord[];
    return { version: 1, packages, invocations };
  } catch {}
  return emptyState();
}

function cleanInvocationRecord(value: unknown): AgentSkillInvocationRecord | null {
  if (!isRecord(value)) return null;
  const record = {
    id: boundedString(value.id, 200),
    skillName: boundedString(value.skillName, 64),
    packageHash: boundedString(value.packageHash, 64),
    runId: boundedString(value.runId, 200),
    stepId: boundedString(value.stepId, 200),
    resourcePath: boundedString(value.resourcePath, 500),
    loadedAt: boundedString(value.loadedAt, 50),
  };
  if (Object.values(record).some(item => !item)) return null;
  if (!NAME_PATTERN.test(record.skillName) || !SHA256_PATTERN.test(record.packageHash)) return null;
  if (!Number.isFinite(Date.parse(record.loadedAt))) return null;
  try { normalizeResourcePath(record.resourcePath); } catch { return null; }
  return record;
}

function boundedString(value: unknown, max: number): string {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : '';
}

function emptyState(): SkillState {
  return { version: 1, packages: {}, invocations: [] };
}

function normalizeResourcePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) throw new Error('Invalid skill resource path');
  return normalized;
}

function assertInside(root: string, target: string): void {
  const relative = path.relative(path.resolve(root), target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Skill resource escapes its package root');
}

function requireString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`Invalid skill ${field}`);
  return value.trim();
}

function optionalString(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  return requireString(value, 'optional field', max);
}

function stringMap(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error('Skill metadata must be a mapping');
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') throw new Error('Skill metadata values must be strings');
    output[key] = item;
  }
  return output;
}

function toSummary(skill: ParsedSkill): AgentSkillSummary {
  const { instructions: _instructions, resources: _resources, skillFile: _skillFile, ...summary } = skill;
  return structuredClone(summary);
}

function toDetail(skill: ParsedSkill): AgentSkillDetail {
  const { skillFile: _skillFile, ...detail } = skill;
  return structuredClone(detail);
}

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
