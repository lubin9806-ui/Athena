import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { AgentArtifactRecord } from '../../shared/types';
import { AgentStore } from '../agent/AgentStore';

export interface PersistArtifactInput {
  runId: string;
  stepId: string;
  idempotencyKey: string;
  kind: string;
  name: string;
  filename: string;
  extension: string;
  contentType: string;
  bytes: Buffer;
  metadata?: Record<string, unknown>;
  validate: (bytes: Buffer) => void;
}

export interface PersistedArtifact {
  record: AgentArtifactRecord;
  path: string;
  bytes: number;
  sha256: string;
  reused: boolean;
}

export interface ArtifactWorkspaceServiceOptions {
  store?: AgentStore;
  resolveProjectRoots: (runId: string) => string[];
}

const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;

export class ArtifactWorkspaceService {
  private readonly store: AgentStore;

  constructor(private readonly options: ArtifactWorkspaceServiceOptions) {
    this.store = options.store || new AgentStore();
  }

  persist(input: PersistArtifactInput): PersistedArtifact {
    if (!input.bytes.length || input.bytes.length > MAX_ARTIFACT_BYTES) {
      throw new Error(`Artifact size must be between 1 byte and ${MAX_ARTIFACT_BYTES} bytes`);
    }
    input.validate(input.bytes);
    const run = this.store.getRun(input.runId);
    if (!run) throw new Error(`Agent run not found: ${input.runId}`);
    const task = this.store.getTask(run.taskId);
    if (!task?.projectId) throw new Error(`Agent run ${input.runId} has no active Project`);
    const step = this.store.getStep(input.stepId);
    if (!step || step.runId !== run.id) throw new Error(`Agent step ${input.stepId} does not belong to run ${run.id}`);

    const root = this.resolveWritableRoot(input.runId);
    const previous = this.store.listArtifacts(task.id, run.id).find(artifact => (
      artifact.metadata.idempotencyKey === input.idempotencyKey
    ));
    if (previous?.uri && isRealFileInside(root, previous.uri) && isValidatedFile(previous.uri, previous.metadata.sha256)) {
      const stat = fs.statSync(previous.uri);
      return {
        record: previous,
        path: previous.uri,
        bytes: stat.size,
        sha256: String(previous.metadata.sha256),
        reused: true,
      };
    }

    const directory = ensureArtifactDirectory(root, task.id);
    const filename = safeFilename(input.filename, input.extension);
    const target = uniqueTarget(directory, filename);
    const temporary = path.join(directory, `.${path.basename(target)}.${randomSuffix(input.idempotencyKey)}-${randomUUID()}.tmp`);
    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    let wroteTarget = false;
    try {
      fs.writeFileSync(temporary, input.bytes, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, target);
      wroteTarget = true;
      if (!isRealFileInside(root, target)) throw new Error('Persisted artifact escaped the Project workspace');
      const persisted = fs.readFileSync(target);
      input.validate(persisted);
      const persistedHash = createHash('sha256').update(persisted).digest('hex');
      if (persistedHash !== sha256) throw new Error('Artifact hash changed after persistence');
      const record = this.store.addArtifact({
        taskId: task.id,
        runId: run.id,
        stepId: step.id,
        kind: input.kind,
        name: input.name,
        uri: target,
        metadata: {
          ...input.metadata,
          contentType: input.contentType,
          bytes: persisted.length,
          sha256,
          idempotencyKey: input.idempotencyKey,
          workspaceRoot: root,
        },
        validationStatus: 'passed',
      });
      return { record, path: target, bytes: persisted.length, sha256, reused: false };
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      if (wroteTarget) fs.rmSync(target, { force: true });
      throw error;
    }
  }

  private resolveWritableRoot(runId: string): string {
    const roots = this.options.resolveProjectRoots(runId);
    if (roots.length === 0) throw new Error('This Project has no workspace root for artifact output');
    const requested = path.resolve(roots[0]);
    const stat = fs.lstatSync(requested);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The primary Project workspace root must be a real directory');
    return fs.realpathSync.native(requested);
  }
}

function ensureArtifactDirectory(root: string, taskId: string): string {
  const safeTaskId = taskId.replace(/[^A-Za-z0-9_-]/g, '');
  if (!safeTaskId) throw new Error('Agent task id cannot be used for artifact storage');
  let current = root;
  for (const segment of ['.athena', 'artifacts', safeTaskId]) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe artifact directory: ${current}`);
    } else {
      fs.mkdirSync(current, { mode: 0o700 });
    }
    const resolved = fs.realpathSync.native(current);
    assertInside(root, resolved);
    current = resolved;
  }
  return current;
}

function safeFilename(value: string, extension: string): string {
  const normalizedExtension = extension.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalizedExtension) throw new Error('Artifact extension is invalid');
  const requested = String(value || '').trim();
  if (requested && (path.basename(requested) !== requested || /[\\/]/.test(requested))) {
    throw new Error('Artifact filename must not contain a path');
  }
  const stem = (requested || 'artifact')
    .replace(/\.[A-Za-z0-9]{1,10}$/u, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 100) || 'artifact';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) throw new Error('Artifact filename is reserved by Windows');
  return `${stem}.${normalizedExtension}`;
}

function uniqueTarget(directory: string, filename: string): string {
  const extension = path.extname(filename);
  const stem = path.basename(filename, extension);
  for (let index = 0; index < 1_000; index += 1) {
    const candidate = path.join(directory, index === 0 ? filename : `${stem}-${index + 1}${extension}`);
    assertInside(directory, candidate);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Artifact filename allocation was exhausted');
}

function assertInside(root: string, candidate: string): void {
  if (!isInside(root, candidate)) throw new Error('Artifact path escaped the Project workspace');
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function randomSuffix(idempotencyKey: string): string {
  return createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 12);
}

function isValidatedFile(filePath: string, expectedHash: unknown): boolean {
  if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ARTIFACT_BYTES) return false;
    return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex') === expectedHash;
  } catch {
    return false;
  }
}

function isRealFileInside(root: string, filePath: string): boolean {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    return isInside(fs.realpathSync.native(root), fs.realpathSync.native(filePath));
  } catch {
    return false;
  }
}
