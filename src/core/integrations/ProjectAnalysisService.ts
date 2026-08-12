import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const MAX_ROOTS = 4;
const MAX_DIRECTORY_ENTRIES = 160;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_README_CHARS = 16_000;
const MAX_GIT_OUTPUT_CHARS = 30_000;
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'release', '.next', '.cache', 'coverage']);
const MANIFEST_NAMES = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'composer.json',
  'Gemfile',
  'CMakeLists.txt',
  'electron-builder.yml',
];
const README_NAMES = ['README.md', 'README.MD', 'README.txt', 'README'];

export interface ProjectInspectionEvidence {
  kind: 'project_inspection';
  inspectedAt: string;
  roots: ProjectRootEvidence[];
}

export interface ProjectRootEvidence {
  configuredRoot: string;
  resolvedRoot: string | null;
  status: 'inspected' | 'missing' | 'not-directory' | 'failed';
  error: string | null;
  entries: Array<{ name: string; type: 'file' | 'directory' | 'symlink' | 'other' }>;
  manifests: ProjectManifestEvidence[];
  readme: null | { path: string; text: string; truncated: boolean };
  git: null | {
    repositoryRoot: string | null;
    branch: string | null;
    status: string;
    recentCommits: string;
  };
}

export interface ProjectManifestEvidence {
  path: string;
  kind: string;
  summary: Record<string, unknown>;
}

export interface ProjectInspectionInput {
  rootIndex?: number;
  includeReadme?: boolean;
  includeGit?: boolean;
}

export class ProjectAnalysisService {
  async inspect(registeredRoots: string[], input: ProjectInspectionInput, signal: AbortSignal): Promise<ProjectInspectionEvidence> {
    if (registeredRoots.length === 0) throw new Error('The active Project has no registered workspace roots');
    const roots = selectRoots(registeredRoots, input.rootIndex);
    const evidence: ProjectRootEvidence[] = [];
    for (const root of roots.slice(0, MAX_ROOTS)) {
      throwIfAborted(signal);
      evidence.push(await this.inspectRoot(root, input, signal));
    }
    return { kind: 'project_inspection', inspectedAt: new Date().toISOString(), roots: evidence };
  }

  private async inspectRoot(configuredRoot: string, input: ProjectInspectionInput, signal: AbortSignal): Promise<ProjectRootEvidence> {
    const base: ProjectRootEvidence = {
      configuredRoot,
      resolvedRoot: null,
      status: 'failed',
      error: null,
      entries: [],
      manifests: [],
      readme: null,
      git: null,
    };
    try {
      const resolvedRoot = await fs.promises.realpath(path.resolve(configuredRoot));
      base.resolvedRoot = resolvedRoot;
      const stat = await fs.promises.stat(resolvedRoot);
      if (!stat.isDirectory()) return { ...base, status: 'not-directory', error: 'Registered workspace root is not a directory' };
      throwIfAborted(signal);
      const directoryEntries = (await fs.promises.readdir(resolvedRoot, { withFileTypes: true }))
        .filter(entry => !IGNORED_DIRECTORIES.has(entry.name))
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, MAX_DIRECTORY_ENTRIES);
      base.entries = directoryEntries.map(entry => ({
        name: entry.name,
        type: entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      }));
      for (const name of MANIFEST_NAMES) {
        throwIfAborted(signal);
        const manifest = await readRegularChildFile(resolvedRoot, name);
        if (manifest !== null) base.manifests.push(summarizeManifest(name, manifest));
      }
      if (input.includeReadme !== false) {
        for (const name of README_NAMES) {
          const readme = await readRegularChildFile(resolvedRoot, name);
          if (readme !== null) {
            base.readme = { path: path.join(resolvedRoot, name), text: readme.slice(0, MAX_README_CHARS), truncated: readme.length > MAX_README_CHARS };
            break;
          }
        }
      }
      if (input.includeGit !== false) base.git = await inspectGit(resolvedRoot, signal);
      return { ...base, status: 'inspected' };
    } catch (error) {
      const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
      if (code === 'ENOENT') return { ...base, status: 'missing', error: 'Registered workspace root does not exist' };
      if (signal.aborted) throw signal.reason || new Error('Project inspection cancelled');
      return { ...base, status: 'failed', error: cleanError(error) };
    }
  }
}

async function readRegularChildFile(root: string, name: string): Promise<string | null> {
  const target = path.join(root, name);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  try {
    const stat = await fs.promises.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) return null;
    return await fs.promises.readFile(target, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return null;
    throw error;
  }
}

function summarizeManifest(name: string, content: string): ProjectManifestEvidence {
  const manifestPath = name;
  if (name === 'package.json') {
    try {
      const parsed = JSON.parse(content);
      if (isRecord(parsed)) {
        return {
          path: manifestPath,
          kind: 'node',
          summary: {
            name: cleanText(parsed.name, 200) || null,
            version: cleanText(parsed.version, 80) || null,
            private: parsed.private === true,
            packageManager: cleanText(parsed.packageManager, 120) || null,
            scripts: isRecord(parsed.scripts) ? Object.keys(parsed.scripts).sort().slice(0, 100) : [],
            dependencies: isRecord(parsed.dependencies) ? Object.keys(parsed.dependencies).sort().slice(0, 200) : [],
            devDependencies: isRecord(parsed.devDependencies) ? Object.keys(parsed.devDependencies).sort().slice(0, 200) : [],
          },
        };
      }
    } catch {
      return { path: manifestPath, kind: 'node', summary: { parseError: 'Invalid package.json' } };
    }
  }
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).slice(0, 80);
  return {
    path: manifestPath,
    kind: manifestKind(name),
    summary: { lines },
  };
}

async function inspectGit(root: string, signal: AbortSignal): Promise<ProjectRootEvidence['git']> {
  const repositoryRoot = await runGit(root, ['rev-parse', '--show-toplevel'], signal, true);
  if (repositoryRoot === null) return null;
  const [branch, status, recentCommits] = await Promise.all([
    runGit(root, ['branch', '--show-current'], signal, true),
    runGit(root, ['status', '--short', '--branch', '--untracked-files=normal'], signal, true),
    runGit(root, ['log', '-5', '--date=iso-strict', '--pretty=format:%h%x09%ad%x09%s'], signal, true),
  ]);
  return {
    repositoryRoot: repositoryRoot.trim() || null,
    branch: branch?.trim() || null,
    status: (status || '').slice(0, MAX_GIT_OUTPUT_CHARS),
    recentCommits: (recentCommits || '').slice(0, MAX_GIT_OUTPUT_CHARS),
  };
}

function runGit(root: string, args: string[], signal: AbortSignal, allowFailure: boolean): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const executable = resolveGitExecutable();
    if (!executable) {
      resolve(null);
      return;
    }
    const child = execFile(executable, ['--no-optional-locks', '--no-pager', '-C', root, ...args], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: MAX_GIT_OUTPUT_CHARS * 4,
      encoding: 'utf8',
      env: safeGitEnvironment(),
    }, (error, stdout) => {
      signal.removeEventListener('abort', onAbort);
      if (error) {
        if (allowFailure) resolve(null);
        else reject(new Error(`Git inspection failed: ${cleanError(error)}`));
      } else resolve(String(stdout));
    });
    const onAbort = () => {
      child.kill();
      reject(signal.reason || new Error('Project inspection cancelled'));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

let cachedGitExecutable: string | null | undefined;

function resolveGitExecutable(): string | null {
  if (cachedGitExecutable !== undefined) return cachedGitExecutable;
  const executableName = process.platform === 'win32' ? 'git.exe' : 'git';
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, executableName);
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) continue;
      cachedGitExecutable = fs.realpathSync(candidate);
      return cachedGitExecutable;
    } catch {
      // Continue through explicit absolute PATH entries.
    }
  }
  cachedGitExecutable = null;
  return null;
}

function safeGitEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'HOME',
    'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'LANG',
  ];
  const environment: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  environment.GIT_OPTIONAL_LOCKS = '0';
  environment.GIT_TERMINAL_PROMPT = '0';
  environment.GIT_PAGER = 'cat';
  return environment;
}

function selectRoots(roots: string[], rootIndex: unknown): string[] {
  const normalized = roots.map(root => path.resolve(String(root))).filter(Boolean);
  if (rootIndex === undefined || rootIndex === null) return normalized;
  const index = Number(rootIndex);
  if (!Number.isInteger(index) || index < 0 || index >= normalized.length) throw new Error('Project root_index is outside the registered workspace roots');
  return [normalized[index]];
}

function manifestKind(name: string): string {
  if (name === 'pyproject.toml' || name === 'requirements.txt') return 'python';
  if (name === 'Cargo.toml') return 'rust';
  if (name === 'go.mod') return 'go';
  if (name === 'composer.json') return 'php';
  if (name === 'Gemfile') return 'ruby';
  if (name === 'CMakeLists.txt') return 'cmake';
  if (name === 'electron-builder.yml') return 'electron-builder';
  return 'text';
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason || new Error('Project inspection cancelled');
}

function cleanText(value: unknown, maxChars: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxChars) : '';
}

function cleanError(value: unknown): string {
  return (value instanceof Error ? value.message : String(value)).replace(/[\r\n]+/g, ' ').slice(0, 1_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
