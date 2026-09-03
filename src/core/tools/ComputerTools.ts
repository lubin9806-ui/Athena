import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { resolveProjectRoot } from '../runtime/Paths';
import { isSteamToolAllowed } from '../steam/SteamSkuPolicy';
import type { ToolCatalogItem, ToolExecutionStatus, ToolPermissionLevel, ToolSettings } from '../../shared/types';
import {
  COMPUTER_PERMISSION_RANK as PERMISSION_RANK,
  COMPUTER_TOOL_DEFINITIONS as TOOL_DEFINITIONS,
  permissionLabel,
  toolPermissionPrompt,
  type ComputerToolDefinition,
} from './ComputerToolCatalog';

export { permissionLabel, toolPermissionPrompt } from './ComputerToolCatalog';
export type { ComputerToolDefinition } from './ComputerToolCatalog';

const MAX_READ_BYTES = 256 * 1024;
const MAX_WRITE_CHARS = 2_000_000;
const MAX_REPLACE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_COMMAND_OUTPUT = 120_000;
const MAX_HTTP_OUTPUT = 200_000;
const MAX_HTTP_BODY_BYTES = 180 * 1024;
const MAX_TERMINAL_BUFFER = 1024 * 1024;
const MAX_TERMINAL_SESSIONS = 8;
const MAX_RETAINED_TERMINAL_SESSIONS = 16;
const MAX_BATCH_MOVE_FILES = 1_000;
const POWERSHELL_STDIN_LOOP = [
  '$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new();',
  'while (($line = [Console]::In.ReadLine()) -ne $null) {',
  'try { Invoke-Expression $line } catch { Write-Error $_ }',
  '}',
].join(' ');

const FILE_TYPE_PATTERNS: Record<string, string[]> = {
  image: ['*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.bmp', '*.tif', '*.tiff', '*.svg', '*.ico', '*.heic', '*.avif'],
  document: ['*.txt', '*.md', '*.pdf', '*.doc', '*.docx', '*.xls', '*.xlsx', '*.ppt', '*.pptx', '*.csv'],
  video: ['*.mp4', '*.mov', '*.mkv', '*.avi', '*.webm', '*.m4v'],
  audio: ['*.mp3', '*.wav', '*.flac', '*.aac', '*.m4a', '*.ogg'],
  archive: ['*.zip', '*.rar', '*.7z', '*.tar', '*.gz', '*.bz2'],
  all: ['*'],
};

export interface ComputerToolResult {
  status: ToolExecutionStatus;
  summary: string;
  output: string;
}

interface TerminalSession {
  id: string;
  shell: 'powershell' | 'cmd' | 'bash';
  process: ChildProcessWithoutNullStreams;
  cwd: string;
  buffer: string;
  cursor: number;
  createdAt: Date;
  lastActivityAt: Date;
  exitCode: number | null;
  closed: boolean;
}

export class ComputerToolService {
  private readonly terminalSessions = new Map<string, TerminalSession>();
  private terminalSequence = 0;

  applyPermissionLevel(level: ToolPermissionLevel): void {
    if (PERMISSION_RANK[level] < PERMISSION_RANK.full) this.closeAllTerminalSessions();
  }

  getDefinitions(settings: ToolSettings): ComputerToolDefinition[] {
    return TOOL_DEFINITIONS.filter((tool) => (
      PERMISSION_RANK[settings.permissionLevel] >= PERMISSION_RANK[tool.minimumLevel]
      && isSteamToolAllowed(tool.name, tool.minimumLevel)
    ));
  }

  getCatalog(settings: ToolSettings): ToolCatalogItem[] {
    return TOOL_DEFINITIONS.map((tool) => {
      const skuAllowed = isSteamToolAllowed(tool.name, tool.minimumLevel);
      const permissionAllowed = PERMISSION_RANK[settings.permissionLevel] >= PERMISSION_RANK[tool.minimumLevel];
      return {
        ...tool,
        available: skuAllowed && permissionAllowed,
        ...(!skuAllowed
          ? { blockedReason: 'sku' as const }
          : !permissionAllowed
            ? { blockedReason: 'permission' as const }
            : {}),
      };
    });
  }

  async execute(name: string, args: Record<string, unknown>, settings: ToolSettings): Promise<ComputerToolResult> {
    const definition = TOOL_DEFINITIONS.find(tool => tool.name === name);
    if (!definition) {
      return { status: 'failed', summary: `未知工具：${name}`, output: `Tool ${name} is not registered.` };
    }

    if (!isSteamToolAllowed(definition.name, definition.minimumLevel)) {
      return {
        status: 'denied',
        summary: `${definition.label}未包含在 Steam 1.0 SKU 中`,
        output: 'Steam 1.0 excludes Full Execute, terminals, arbitrary HTTP/TCP, program launch, and external-path opening.',
      };
    }

    if (PERMISSION_RANK[settings.permissionLevel] < PERMISSION_RANK[definition.minimumLevel]) {
      return {
        status: 'denied',
        summary: `${definition.label}被当前权限档位拒绝`,
        output: `当前权限为 ${permissionLabel(settings.permissionLevel)}；${definition.label}至少需要 ${permissionLabel(definition.minimumLevel)}。`,
      };
    }

    try {
      switch (name) {
        case 'file_info': return await this.fileInfo(args);
        case 'list_directory': return await this.listDirectory(args);
        case 'read_file': return await this.readFile(args);
        case 'search_files': return await this.searchFiles(args);
        case 'search_text': return await this.searchText(args);
        case 'write_file': return await this.writeFile(args);
        case 'replace_in_file': return await this.replaceInFile(args);
        case 'make_directory': return await this.makeDirectory(args);
        case 'copy_path': return await this.copyPath(args);
        case 'move_path': return await this.movePath(args);
        case 'move_matching_files': return await this.moveMatchingFiles(args);
        case 'delete_path': return await this.deletePath(args);
        case 'run_command': return await this.runCommand(args, settings);
        case 'terminal_start': return await this.terminalStart(args);
        case 'terminal_write': return await this.terminalWrite(args);
        case 'terminal_read': return await this.terminalRead(args);
        case 'terminal_list': return this.terminalList();
        case 'terminal_stop': return await this.terminalStop(args);
        case 'launch_program': return await this.launchProgram(args);
        case 'open_path': return await this.openPath(args);
        case 'http_request': return await this.httpRequest(args, settings);
        case 'check_port': return await this.checkPort(args, settings);
        default: return { status: 'failed', summary: `未实现工具：${name}`, output: '' };
      }
    } catch (error) {
      const operationError = error instanceof ToolOperationError ? error : null;
      return {
        status: 'failed',
        summary: operationError?.message || (error instanceof Error ? error.message : String(error)),
        output: operationError?.output || (error instanceof Error ? error.stack || error.message : String(error)),
      };
    }
  }

  shutdown(): void {
    this.closeAllTerminalSessions();
  }

  private closeAllTerminalSessions(): void {
    for (const session of this.terminalSessions.values()) {
      if (!session.closed) {
        try { session.process.stdin.end(); } catch { /* Process may already be exiting. */ }
        try { session.process.kill(); } catch { /* Best-effort cleanup during permission revocation. */ }
      }
    }
    this.terminalSessions.clear();
  }

  private pruneClosedTerminalSessions(): void {
    if (this.terminalSessions.size <= MAX_RETAINED_TERMINAL_SESSIONS) return;
    const closed = Array.from(this.terminalSessions.values())
      .filter(session => session.closed)
      .sort((left, right) => left.lastActivityAt.getTime() - right.lastActivityAt.getTime());
    for (const session of closed) {
      if (this.terminalSessions.size <= MAX_RETAINED_TERMINAL_SESSIONS) break;
      this.terminalSessions.delete(session.id);
    }
  }

  private async fileInfo(args: Record<string, unknown>): Promise<ComputerToolResult> {
    const target = resolveComputerPath(requireString(args.path, 'path'));
    const stat = await fs.promises.stat(target);
    const type = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
    const output = [
      `path: ${target}`,
      `type: ${type}`,
      `size: ${stat.size}`,
      `created_at: ${stat.birthtime.toISOString()}`,
      `modified_at: ${stat.mtime.toISOString()}`,
    ].join('\n');
    return completed(`已读取 ${target} 的信息`, output);
  }

  private async listDirectory(args: Record<string, unknown>): Promise<ComputerToolResult> {
    const root = resolveComputerPath(requireString(args.path, 'path'));
    const stat = await fs.promises.stat(root);
    if (!stat.isDirectory()) throw new Error(`${root} 不是目录。`);

    const recursive = args.recursive === true;
    const maxDepth = recursive ? clampInteger(args.max_depth, 1, 12, 3) : 1;
    const limit = clampInteger(args.limit, 1, 500, 200);
    const entries = await walkEntries(root, maxDepth, limit);
    const output = entries.length
      ? entries.map(entry => `${entry.isDirectory ? '[D]' : '[F]'} ${entry.path}${entry.isDirectory ? '' : ` (${entry.size} bytes)`}`).join('\n')
      : '(empty directory)';
    return completed(`已列出 ${root}，共 ${entries.length} 项`, output);
  }

  private async readFile(args: Record<string, unknown>): Promise<ComputerToolResult> {
    const target = resolveComputerPath(requireString(args.path, 'path'));
    const encoding = args.encoding === 'base64' ? 'base64' : 'utf8';
    const offset = clampInteger(args.offset, 0, Number.MAX_SAFE_INTEGER, 0);
    const maxBytes = clampInteger(args.max_bytes, 1, MAX_READ_BYTES, 32 * 1024);
    const handle = await fs.promises.open(target, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error(`${target} 不是普通文件。`);
      const readable = Math.max(0, Math.min(maxBytes, stat.size - offset));
      const buffer = Buffer.alloc(readable);
      const { bytesRead } = await handle.read(buffer, 0, readable, offset);
      const body = buffer.subarray(0, bytesRead).toString(encoding);
      const nextOffset = offset + bytesRead;
      const header = `path: ${target}\noffset: ${offset}\nbytes_read: ${bytesRead}\ntotal_bytes: ${stat.size}\ntruncated: ${nextOffset < stat.size}\nnext_offset: ${nextOffset}`;
      return completed(`已读取 ${target} 的 ${bytesRead} 字节`, `${header}\n\n${body}`);
    } finally {
      await handle.close();
    }
  }

  private async searchFiles(args: Record<string, unknown>): Promise<ComputerToolResult> {
    const root = resolveComputerPath(requireString(args.root, 'root'));
    const pattern = requireString(args.pattern, 'pattern');
    const maxDepth = clampInteger(args.max_depth, 1, 20, 8);
    const maxResults = clampInteger(args.max_results, 1, 500, 100);
    const matcher = makeNameMatcher(pattern);
    const entries = await walkEntries(root, maxDepth, 20_000, entry => matcher(path.basename(entry.path)));
    const matches = entries.slice(0, maxResults);
    const output = matches.length
      ? matches.map(entry => `${entry.isDirectory ? '[D]' : '[F]'} ${entry.path}`).join('\n')
      : '(no matches)';
    return completed(`在 ${root} 找到 ${matches.length} 项`, output);
  }

  private async searchText(args: Record<string, unknown>): Promise<ComputerToolResult> {
    const root = resolveComputerPath(requireString(args.root, 'root'));
    const query = requireString(args.query, 'query');
    const caseSensitive = args.case_sensitive === true;
    const filePattern = optionalString(args.file_pattern);
    const fileMatcher = filePattern ? makeNameMatcher(filePattern) : () => true;
    const maxDepth = clampInteger(args.max_depth, 1, 20, 8);
    const maxResults = clampInteger(args.max_results, 1, 300, 80);
    const files = await walkEntries(root, maxDepth, 20_000, entry => !entry.isDirectory && fileMatcher(path.basename(entry.path)));
    const needle = caseSensitive ? query : query.toLocaleLowerCase();
    const matches: string[] = [];
    let scannedFiles = 0;
    let scannedBytes = 0;
    let budgetExhausted = false;

    for (const entry of files) {
      if (matches.length >= maxResults || entry.size > MAX_SEARCH_FILE_BYTES) continue;
      if (scannedBytes + entry.size > MAX_SEARCH_TOTAL_BYTES) {
        budgetExhausted = true;
        break;
      }
      let buffer: Buffer;
      try {
        buffer = await fs.promises.readFile(entry.path);
      } catch {
        continue;
      }
      scannedFiles += 1;
      scannedBytes += buffer.byteLength;
      if (buffer.includes(0)) continue;
      const lines = buffer.toString('utf8').split(/\r?\n/);
      for (let index = 0; index < lines.length && matches.length < maxResults; index += 1) {
        const haystack = caseSensitive ? lines[index] : lines[index].toLocaleLowerCase();
        if (haystack.includes(needle)) {
          matches.push(`${entry.path}:${index + 1}: ${truncate(lines[index].trim(), 360)}`);
        }
      }
    }

    const metadata = [
      `files_scanned: ${scannedFiles}`,
      `bytes_scanned: ${scannedBytes}`,
      `scan_budget_exhausted: ${budgetExhausted}`,
    ].join('\n');
    return completed(
      `在 ${root} 找到 ${matches.length} 处文本匹配${budgetExhausted ? '（已达到扫描上限）' : ''}`,
      `${metadata}\n\n${matches.join('\n') || '(no matches)'}`,
    );
  }

  private async writeFile(args: Record<string, unknown>): Promise<ComputerToolResult> {
    const target = resolveComputerPath(requireString(args.path, 'path'));
    const content = requireString(args.content, 'content', MAX_WRITE_CHARS, true);
    const encoding = args.encoding === 'base64' ? 'base64' : 'utf8';
    const mode = args.mode === 'append' ? 'append' : 'overwrite';
    const bytes = Buffer.from(content, encoding);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    if (mode === 'append') await fs.promises.appendFile(target, bytes);
    else await fs.promises.writeFile(target, bytes);
    return completed(`${mode === 'append' ? '已追加' : '已写入'} ${target}（${bytes.length} 字节）`, `path: ${target}\nmode: ${mode}\nbytes_written: ${bytes.length}`);
  }

  private async replaceInFile(args: Record<string, unknown>): Promise<ComputerToolResult> {
    const target = resolveComputerPath(requireString(args.path, 'path'));
    const oldText = requireString(args.old_text, 'old_text', MAX_WRITE_CHARS);
    const newText = requireString(args.new_text, 'new_text', MAX_WRITE_CHARS, true);
    if (!oldText) throw new Error('old_text 不能为空。');
    const stat = await fs.promises.stat(target);
    if (!stat.isFile()) throw new Error(`${target} 不是普通文件。`);
    if (stat.size > MAX_REPLACE_FILE_BYTES) {
      throw new Error(`文件超过结构化替换上限 ${MAX_REPLACE_FILE_BYTES} 字节，请改用终端或分段工具。`);
    }
    const current = await fs.promises.readFile(target, 'utf8');
    if (!current.includes(oldText)) throw new Error(`在 ${target} 中没有找到指定文本。`);
    const replaceAll = args.replace_all === true;
    const count = replaceAll ? countOccurrences(current, oldText) : 1;
    const projectedLength = current.length + count * (newText.length - oldText.length);
    if (projectedLength > MAX_WRITE_CHARS) {
      throw new Error(`替换后的文件将超过 ${MAX_WRITE_CHARS} 个字符，已取消写入。`);
    }
    const next = replaceAll ? current.split(oldText).join(newText) : current.replace(oldText, newText);
    await fs.promises.writeFile(target, next, 'utf8');
    return completed(`已修改 ${target}，替换 ${count} 处`, `path: ${target}\nreplacements: ${count}`);
  }

  private async makeDirectory(args: Record<string, unknown>): Promise<ComputerToolResult> {
    const target = resolveComputerPath(requireString(args.path, 'path'));
    await fs.promises.mkdir(target, { recursive: true });
    return completed(`已创建目录 ${target}`, `path: ${target}`);
  }

  private async copyPath(args: Record<string, unknown>): Promise<ComputerToolResult> {
    const source = resolveComputerPath(requireString(args.source, 'source'));
    const destination = resolveComputerPath(requireString(args.destination, 'destination'));
    const overwrite = args.overwrite !== false;
    const stat = await fs.promises.stat(source);
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    if (stat.isDirectory()) {
      await fs.promises.cp(source, destination, { recursive: true, force: overwrite, errorOnExist: !overwrite });
    } else {
      await fs.promises.copyFile(source, destination, overwrite ? 0 : fs.constants.COPYFILE_EXCL);
    }
    return completed(`已复制到 ${destination}`, `source: ${source}\ndestination: ${destination}`);
  }

  private async movePath(args: Record<string, unknown>): Promise<ComputerToolResult> {
    const source = resolveComputerPath(requireString(args.source, 'source'));
    const destination = resolveComputerPath(requireString(args.destination, 'destination'));
    const overwrite = args.overwrite === true;
    if (isSameComputerPath(source, destination)) throw new Error('源路径和目标路径相同，已取消移动。');
    const stat = await fs.promises.lstat(source);
    if (isPathWithin(source, destination)) {
      throw new Error('目标路径包含源路径；覆盖目标会同时删除源数据，已取消移动。');
    }
    if (stat.isDirectory() && isPathWithin(destination, source)) {
      throw new Error('不能把目录移动到它自己的子目录中。');
    }
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    if (overwrite) await fs.promises.rm(destination, { recursive: true, force: true });
    try {
      await fs.promises.rename(source, destination);
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EXDEV') throw error;
      if (stat.isDirectory()) await fs.promises.cp(source, destination, { recursive: true, force: overwrite });
      else await fs.promises.copyFile(source, destination, overwrite ? 0 : fs.constants.COPYFILE_EXCL);
      await fs.promises.rm(source, { recursive: true, force: true });
    }
    return completed(`已移动到 ${destination}`, `source: ${source}\ndestination: ${destination}`);
  }

  private async moveMatchingFiles(args: Record<string, unknown>): Promise<ComputerToolResult> {
    const source = resolveComputerPath(requireString(args.source_directory, 'source_directory'));
    const destination = resolveComputerPath(requireString(args.destination_directory, 'destination_directory'));
    if (isSameComputerPath(source, destination)) throw new Error('源目录和目标目录相同，已取消批量移动。');

    const sourceStat = await fs.promises.stat(source);
    if (!sourceStat.isDirectory()) throw new Error(`${source} 不是目录。`);

    const patterns = resolveBatchMovePatterns(args);
    const matchers = patterns.map(makeNameMatcher);
    const recursive = args.recursive === true;
    const conflictStrategy = normalizeConflictStrategy(args.conflict_strategy);
    const destinationInsideSource = isPathWithin(destination, source);
    const entries = await walkEntries(
      source,
      recursive ? 12 : 1,
      20_000,
      entry => !entry.isDirectory
        && !(destinationInsideSource && (isSameComputerPath(entry.path, destination) || isPathWithin(entry.path, destination)))
        && matchers.some(matcher => matcher(path.basename(entry.path))),
    );
    const matches = entries.slice(0, MAX_BATCH_MOVE_FILES);

    await fs.promises.mkdir(destination, { recursive: true });
    const moved: Array<{ source: string; destination: string }> = [];
    const skipped: string[] = [];
    const failed: Array<{ path: string; error: string }> = [];

    for (const entry of matches) {
      try {
        let target = path.join(destination, path.basename(entry.path));
        if (isSameComputerPath(entry.path, target)) {
          skipped.push(`${entry.path}（已在目标目录）`);
          continue;
        }

        if (await computerPathExists(target)) {
          if (conflictStrategy === 'skip') {
            skipped.push(`${entry.path}（目标已存在）`);
            continue;
          }
          if (conflictStrategy === 'rename') target = await nextAvailableComputerPath(target);
        }

        await this.movePath({
          source: entry.path,
          destination: target,
          overwrite: conflictStrategy === 'overwrite',
        });
        moved.push({ source: entry.path, destination: target });
      } catch (error) {
        failed.push({ path: entry.path, error: error instanceof Error ? error.message : String(error) });
      }
    }

    const capped = entries.length > matches.length;
    const summary = `批量整理完成：移动 ${moved.length} 个，跳过 ${skipped.length} 个，失败 ${failed.length} 个${capped ? '（已达到单次上限）' : ''}`;
    const output = [
      `source_directory: ${source}`,
      `destination_directory: ${destination}`,
      `patterns: ${patterns.join(', ')}`,
      `recursive: ${recursive}`,
      `conflict_strategy: ${conflictStrategy}`,
      `matched: ${entries.length}`,
      `moved: ${moved.length}`,
      `skipped: ${skipped.length}`,
      `failed: ${failed.length}`,
      `limit_reached: ${capped}`,
      '',
      '[moved]',
      moved.map(item => `${item.source} -> ${item.destination}`).join('\n') || '(none)',
      '',
      '[skipped]',
      skipped.join('\n') || '(none)',
      '',
      '[failed]',
      failed.map(item => `${item.path}: ${item.error}`).join('\n') || '(none)',
    ].join('\n');
    return completed(summary, output);
  }

  private async deletePath(args: Record<string, unknown>): Promise<ComputerToolResult> {
    const target = resolveComputerPath(requireString(args.path, 'path'));
    if (isFilesystemRoot(target)) throw new Error('为避免误操作，结构化删除工具不能直接删除磁盘根目录。');
    const stat = await fs.promises.lstat(target);
    const recursive = args.recursive === true;
    if (stat.isDirectory() && !recursive) {
      const entries = await fs.promises.readdir(target);
      if (entries.length > 0) throw new Error('目录非空；如确实需要删除，请明确 recursive=true。');
    }
    await fs.promises.rm(target, { recursive, force: false });
    return completed(`已删除 ${target}`, `path: ${target}\nrecursive: ${recursive}`);
  }

  private async runCommand(args: Record<string, unknown>, settings: ToolSettings): Promise<ComputerToolResult> {
    const command = requireString(args.command, 'command', 20_000);
    const cwd = optionalString(args.cwd) ? resolveComputerPath(requireString(args.cwd, 'cwd')) : resolveProjectRoot();
    const timeoutSeconds = clampInteger(args.timeout_seconds, 1, 300, settings.commandTimeoutSeconds);
    const result = await executeShellCommand(command, cwd, timeoutSeconds * 1000);
    const output = [`cwd: ${cwd}`, `exit_code: ${result.exitCode}`, '', result.stdout, result.stderr ? `\n[stderr]\n${result.stderr}` : '']
      .filter(Boolean)
      .join('\n');
    if (result.exitCode !== 0) {
      throw new ToolOperationError(`命令执行失败（退出码 ${result.exitCode}）`, output);
    }
    return completed(`命令执行完成（退出码 0）`, output);
  }

  private async terminalStart(args: Record<string, unknown>): Promise<ComputerToolResult> {
    this.pruneClosedTerminalSessions();
    const activeSessions = Array.from(this.terminalSessions.values()).filter(session => !session.closed);
    if (activeSessions.length >= MAX_TERMINAL_SESSIONS) {
      throw new Error(`同时最多保留 ${MAX_TERMINAL_SESSIONS} 个终端会话，请先关闭不再使用的会话。`);
    }

    const requestedShell = args.shell === 'cmd' ? 'cmd' : 'powershell';
    const shell: TerminalSession['shell'] = process.platform === 'win32' ? requestedShell : 'bash';
    const cwd = optionalString(args.cwd) ? resolveComputerPath(requireString(args.cwd, 'cwd')) : resolveProjectRoot();
    const initialCommand = optionalString(args.command)?.slice(0, 20_000);
    const id = this.nextTerminalId();
    const executable = shell === 'powershell' ? 'powershell.exe' : shell === 'cmd' ? 'cmd.exe' : '/bin/bash';
    const spawnArgs = shell === 'powershell'
      ? ['-NoLogo', '-NoProfile', '-Command', POWERSHELL_STDIN_LOOP]
      : shell === 'cmd'
        ? ['/D', '/Q', '/K', 'chcp 65001>nul']
        : ['--noprofile', '--norc'];
    const child = spawn(executable, spawnArgs, {
      cwd,
      env: { ...process.env, TERM: 'dumb' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    const now = new Date();
    const session: TerminalSession = {
      id,
      shell,
      process: child,
      cwd,
      buffer: '',
      cursor: 0,
      createdAt: now,
      lastActivityAt: now,
      exitCode: null,
      closed: false,
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => appendTerminalOutput(session, String(chunk)));
    child.stderr.on('data', chunk => appendTerminalOutput(session, `\n[stderr]\n${String(chunk)}`));
    child.once('exit', (code, signal) => {
      session.closed = true;
      session.exitCode = typeof code === 'number' ? code : null;
      appendTerminalOutput(session, `\n[terminal exited: code=${code ?? 'null'}, signal=${signal ?? 'none'}]\n`);
      this.pruneClosedTerminalSessions();
    });
    this.terminalSessions.set(id, session);

    try {
      await waitForSpawn(child);
    } catch (error) {
      this.terminalSessions.delete(id);
      throw error;
    }

    const before = session.buffer.length;
    if (initialCommand) await writeTerminalInput(session, initialCommand, true);
    await waitForTerminalQuiet(
      session,
      before,
      initialCommand ? 3_000 : 800,
      initialCommand ? 500 : 180,
    );
    const read = readTerminalChunk(session, 20_000);
    return completed(
      `已启动 ${terminalShellLabel(shell)} 终端（${id}）`,
      formatTerminalOutput(session, read, initialCommand ? `initial_command_chars: ${initialCommand.length}` : ''),
    );
  }

  private async terminalWrite(args: Record<string, unknown>): Promise<ComputerToolResult> {
    const session = this.requireTerminalSession(requireString(args.session_id, 'session_id', 200));
    if (session.closed || !session.process.stdin.writable) {
      throw new Error(`终端会话 ${session.id} 已结束，不能继续写入。`);
    }
    const input = requireString(args.input, 'input', 20_000, true);
    const appendNewline = args.append_newline !== false;
    const waitMs = clampInteger(args.wait_ms, 0, 5_000, 450);
    const before = session.buffer.length;
    await writeTerminalInput(session, input, appendNewline);
    if (waitMs > 0) await waitForTerminalQuiet(session, before, waitMs);
    const read = readTerminalChunk(session, 30_000);
    return completed(
      `已向终端 ${session.id} 写入 ${input.length} 个字符`,
      formatTerminalOutput(session, read, `input_chars: ${input.length}\nappend_newline: ${appendNewline}`),
    );
  }

  private async terminalRead(args: Record<string, unknown>): Promise<ComputerToolResult> {
    const session = this.requireTerminalSession(requireString(args.session_id, 'session_id', 200));
    const waitMs = clampInteger(args.wait_ms, 0, 10_000, 500);
    const maxChars = clampInteger(args.max_chars, 1, 100_000, 30_000);
    if (session.cursor >= session.buffer.length && !session.closed && waitMs > 0) {
      await waitForTerminalQuiet(session, session.buffer.length, waitMs);
    }
    const read = readTerminalChunk(session, maxChars);
    return completed(
      read.text ? `已读取终端 ${session.id} 的新输出` : `终端 ${session.id} 暂无新输出`,
      formatTerminalOutput(session, read),
    );
  }

  private terminalList(): ComputerToolResult {
    this.pruneClosedTerminalSessions();
    const sessions = Array.from(this.terminalSessions.values());
    const output = sessions.length
      ? sessions.map(session => [
        `session_id: ${session.id}`,
        `shell: ${session.shell}`,
        `pid: ${session.process.pid ?? 'unknown'}`,
        `state: ${session.closed ? 'closed' : 'running'}`,
        `cwd: ${session.cwd}`,
        `created_at: ${session.createdAt.toISOString()}`,
        `last_activity_at: ${session.lastActivityAt.toISOString()}`,
      ].join('\n')).join('\n\n')
      : '(no terminal sessions)';
    return completed(`当前有 ${sessions.length} 个终端会话`, output);
  }

  private async terminalStop(args: Record<string, unknown>): Promise<ComputerToolResult> {
    const session = this.requireTerminalSession(requireString(args.session_id, 'session_id', 200));
    const pid = session.process.pid;
    if (!session.closed) {
      session.process.stdin.end();
      session.process.kill();
      await waitForTerminalExit(session, 1_500);
      if (!session.closed) session.process.kill('SIGKILL');
    }
    this.terminalSessions.delete(session.id);
    return completed(`已关闭终端 ${session.id}`, `session_id: ${session.id}\npid: ${pid ?? 'unknown'}\nclosed: true`);
  }

  private requireTerminalSession(id: string): TerminalSession {
    const session = this.terminalSessions.get(id);
    if (!session) throw new Error(`找不到终端会话 ${id}。可先调用 terminal_list 查看现有会话。`);
    return session;
  }

  private nextTerminalId(): string {
    this.terminalSequence += 1;
    return `term-${Date.now().toString(36)}-${this.terminalSequence.toString(36)}`;
  }

  private async launchProgram(args: Record<string, unknown>): Promise<ComputerToolResult> {
    const program = requireString(args.program, 'program', 2_048);
    const programArgs = Array.isArray(args.args)
      ? args.args.filter((item): item is string => typeof item === 'string').slice(0, 100)
      : [];
    const cwd = optionalString(args.cwd) ? resolveComputerPath(requireString(args.cwd, 'cwd')) : resolveProjectRoot();
    const child = spawn(program, programArgs, {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      shell: false,
    });
    await waitForSpawn(child);
    child.unref();
    return completed(`已启动 ${program}`, `program: ${program}\nargs: ${JSON.stringify(programArgs)}\ncwd: ${cwd}\npid: ${child.pid ?? 'unknown'}`);
  }

  private async openPath(args: Record<string, unknown>): Promise<ComputerToolResult> {
    const rawTarget = requireString(args.path, 'path', 8_192);
    const isUrl = /^https?:\/\//i.test(rawTarget);
    const target = isUrl ? rawTarget : resolveComputerPath(rawTarget);
    const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(command, [target], { detached: true, stdio: 'ignore', windowsHide: false });
    await waitForSpawn(child);
    child.unref();
    return completed(`已打开 ${target}`, `target: ${target}\npid: ${child.pid ?? 'unknown'}`);
  }

  private async httpRequest(args: Record<string, unknown>, settings: ToolSettings): Promise<ComputerToolResult> {
    const rawUrl = requireString(args.url, 'url', 8_192);
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只支持 HTTP 和 HTTPS 地址。');
    if (url.username || url.password) throw new Error('HTTP 地址不能包含用户名或密码，请改用请求头并妥善保管凭据。');
    if (!settings.allowExternalNetwork && !isLocalNetworkHost(url.hostname)) {
      return {
        status: 'denied',
        summary: '外部网络请求需要先完成隐私同意',
        output: `host: ${url.hostname}\nreason: external_tool_network_consent_required`,
      };
    }
    const method = optionalString(args.method)?.toUpperCase() || 'GET';
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) throw new Error(`不支持 HTTP 方法 ${method}。`);
    const headers: Record<string, string> = {};
    if (isRecord(args.headers)) {
      for (const [key, value] of Object.entries(args.headers).slice(0, 50)) {
        if (typeof value === 'string') headers[key] = value.slice(0, 8_192);
      }
    }
    const timeoutSeconds = clampInteger(args.timeout_seconds, 1, 120, Math.min(settings.commandTimeoutSeconds, 60));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : optionalString(args.body)?.slice(0, MAX_WRITE_CHARS),
        signal: controller.signal,
      });
      const body = method === 'HEAD'
        ? { text: '', bytesRead: 0, truncated: false }
        : await readHttpResponseBody(response, MAX_HTTP_BODY_BYTES);
      const output = [
        `url: ${url.toString()}`,
        `status: ${response.status} ${response.statusText}`,
        `content_type: ${response.headers.get('content-type') || ''}`,
        `body_bytes_read: ${body.bytesRead}`,
        `body_truncated: ${body.truncated}`,
        '',
        body.text,
      ].join('\n');
      return completed(`HTTP ${response.status} · ${url.host}`, output);
    } finally {
      clearTimeout(timer);
    }
  }

  private async checkPort(args: Record<string, unknown>, settings: ToolSettings): Promise<ComputerToolResult> {
    const host = optionalString(args.host) || '127.0.0.1';
    const parsedPort = typeof args.port === 'number' ? args.port : Number(args.port);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
      throw new Error('port 必须是 1 到 65535 的整数。');
    }
    const port = parsedPort;
    if (!settings.allowExternalNetwork && args.host && !isLocalNetworkHost(host)) {
      return {
        status: 'denied',
        summary: '外部端口探测需要先完成隐私同意',
        output: `host: ${host}\nport: ${port}\nreason: external_tool_network_consent_required`,
      };
    }
    const timeoutSeconds = clampInteger(args.timeout_seconds, 1, 30, 3);
    const open = await probePort(host, port, timeoutSeconds * 1000);
    return completed(`${host}:${port} ${open ? '可连接' : '未开放'}`, `host: ${host}\nport: ${port}\nopen: ${open}`);
  }
}

function completed(summary: string, output: string): ComputerToolResult {
  return { status: 'completed', summary, output: truncate(output, MAX_HTTP_OUTPUT) };
}

function resolveComputerPath(value: string): string {
  let expanded = value.trim();
  expanded = expanded.replace(/^~(?=$|[\\/])/, process.env.USERPROFILE || process.env.HOME || '~');
  expanded = expanded.replace(/%([^%]+)%/g, (_, key: string) => process.env[key] ?? `%${key}%`);
  expanded = expanded.replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_, key: string) => process.env[key] ?? `$env:${key}`);
  expanded = resolveKnownFolderAlias(expanded);
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(resolveProjectRoot(), expanded);
}

function resolveKnownFolderAlias(value: string): string {
  const normalized = value.replace(/[\\/]+/g, path.sep);
  const match = normalized.match(/^(桌面|我的桌面|desktop|下载|下载目录|downloads)(?:[\\/](.*))?$/i);
  if (!match) return value;

  const alias = match[1].toLocaleLowerCase();
  const child = match[2] || '';
  const folderName = /桌面|desktop/i.test(alias) ? 'Desktop' : 'Downloads';
  const userProfile = process.env.USERPROFILE || process.env.HOME || resolveProjectRoot();
  const candidates = [
    path.join(userProfile, folderName),
    process.env.OneDrive ? path.join(process.env.OneDrive, folderName) : '',
    process.env.OneDriveConsumer ? path.join(process.env.OneDriveConsumer, folderName) : '',
  ].filter(Boolean);
  const base = candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
  return child ? path.join(base, child) : base;
}

function isLocalNetworkHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '0.0.0.0'
    || normalized.startsWith('127.');
}

function resolveBatchMovePatterns(args: Record<string, unknown>): string[] {
  const fileTypeAliases: Record<string, string> = {
    图片: 'image',
    图像: 'image',
    照片: 'image',
    文档: 'document',
    视频: 'video',
    音频: 'audio',
    音乐: 'audio',
    压缩包: 'archive',
    全部: 'all',
  };
  const rawFileType = typeof args.file_type === 'string' ? args.file_type.trim().toLocaleLowerCase() : '';
  const fileType = fileTypeAliases[rawFileType] || rawFileType;
  const typePatterns = FILE_TYPE_PATTERNS[fileType] || [];
  const rawPatterns = Array.isArray(args.patterns)
    ? args.patterns
    : typeof args.patterns === 'string'
      ? args.patterns.split(/[;,，；]/)
      : [];
  const explicitPatterns = rawPatterns
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 50);
  const patterns = Array.from(new Set([...typePatterns, ...explicitPatterns]));
  if (patterns.length === 0) {
    throw new Error('必须提供有效的 file_type 或 patterns，避免误移动整个目录。');
  }
  return patterns;
}

function normalizeConflictStrategy(value: unknown): 'rename' | 'skip' | 'overwrite' {
  if (value === 'skip' || value === 'overwrite') return value;
  return 'rename';
}

async function computerPathExists(target: string): Promise<boolean> {
  try {
    await fs.promises.lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function nextAvailableComputerPath(target: string): Promise<string> {
  const parsed = path.parse(target);
  for (let index = 2; index <= 10_000; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
    if (!await computerPathExists(candidate)) return candidate;
  }
  throw new Error(`无法为重名文件生成可用名称：${target}`);
}

function requireString(value: unknown, name: string, maxLength = 100_000, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${name} 必须是字符串。`);
  if (!allowEmpty && !value.trim()) throw new Error(`${name} 不能为空。`);
  if (value.length > maxLength) throw new Error(`${name} 超过最大长度 ${maxLength}。`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 32))}\n...[output truncated]`;
}

function isFilesystemRoot(target: string): boolean {
  return path.parse(path.resolve(target)).root.toLocaleLowerCase() === path.resolve(target).toLocaleLowerCase();
}

function isSameComputerPath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase()
    : normalizedLeft === normalizedRight;
}

function isPathWithin(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative.length > 0
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function countOccurrences(value: string, needle: string): number {
  let count = 0;
  let cursor = 0;
  while (cursor <= value.length - needle.length) {
    const match = value.indexOf(needle, cursor);
    if (match < 0) break;
    count += 1;
    cursor = match + needle.length;
  }
  return count;
}

interface WalkEntry {
  path: string;
  isDirectory: boolean;
  size: number;
}

async function walkEntries(
  root: string,
  maxDepth: number,
  limit: number,
  include: (entry: WalkEntry) => boolean = () => true,
): Promise<WalkEntry[]> {
  const output: WalkEntry[] = [];
  const queue: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
  let visited = 0;

  while (queue.length > 0 && visited < limit) {
    const current = queue.shift();
    if (!current) break;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current.directory, { withFileTypes: true });
    } catch (error) {
      if (current.depth === 0) throw error;
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    for (const entry of entries) {
      if (visited >= limit) break;
      visited += 1;
      const fullPath = path.join(current.directory, entry.name);
      const isDirectory = entry.isDirectory();
      let size = 0;
      if (!isDirectory) {
        try { size = (await fs.promises.stat(fullPath)).size; } catch { size = 0; }
      }
      const item = { path: fullPath, isDirectory, size };
      if (include(item)) output.push(item);
      if (isDirectory && !entry.isSymbolicLink() && current.depth + 1 < maxDepth) {
        queue.push({ directory: fullPath, depth: current.depth + 1 });
      }
    }
  }
  return output;
}

function makeNameMatcher(pattern: string): (name: string) => boolean {
  const normalized = pattern.trim();
  if (!normalized.includes('*') && !normalized.includes('?')) {
    const needle = normalized.toLocaleLowerCase();
    return name => name.toLocaleLowerCase().includes(needle);
  }
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  const regex = new RegExp(`^${escaped}$`, 'i');
  return name => regex.test(name);
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function executeShellCommand(command: string, cwd: string, timeoutMs: number): Promise<CommandResult> {
  const executable = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
  const shellArgs = process.platform === 'win32'
    ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]
    : ['-lc', command];

  return new Promise((resolve, reject) => {
    execFile(executable, shellArgs, {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 5 * 1024 * 1024,
      encoding: 'utf8',
    }, (error, stdout, stderr) => {
      const result = {
        exitCode: typeof (error as NodeJS.ErrnoException & { code?: number } | null)?.code === 'number'
          ? Number((error as NodeJS.ErrnoException & { code?: number }).code)
          : error ? 1 : 0,
        stdout: truncate(String(stdout || ''), MAX_COMMAND_OUTPUT),
        stderr: truncate(String(stderr || ''), MAX_COMMAND_OUTPUT),
      };
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new ToolOperationError(`无法启动命令解释器 ${executable}`, result.stderr || error.message));
        return;
      }
      resolve(result);
    });
  });
}

function waitForSpawn(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    child.once('error', onError);
    child.once('spawn', () => {
      child.removeListener('error', onError);
      resolve();
    });
  });
}

function probePort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function readHttpResponseBody(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; bytesRead: number; truncated: boolean }> {
  if (!response.body) return { text: '', bytesRead: 0, truncated: false };

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytesRead = 0;
  let truncated = false;

  try {
    while (bytesRead < maxBytes) {
      const next = await reader.read();
      if (next.done) break;
      const remaining = maxBytes - bytesRead;
      const value = next.value.byteLength > remaining ? next.value.subarray(0, remaining) : next.value;
      chunks.push(Buffer.from(value));
      bytesRead += value.byteLength;
      if (value.byteLength < next.value.byteLength) {
        truncated = true;
        break;
      }
    }

    if (!truncated && bytesRead >= maxBytes) {
      const next = await reader.read();
      truncated = !next.done;
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => {});
    else reader.releaseLock();
  }

  return {
    text: Buffer.concat(chunks, bytesRead).toString('utf8'),
    bytesRead,
    truncated,
  };
}

interface TerminalReadResult {
  text: string;
  moreAvailable: boolean;
}

function terminalShellLabel(shell: TerminalSession['shell']): string {
  if (shell === 'powershell') return 'PowerShell';
  if (shell === 'cmd') return 'CMD';
  return 'Bash';
}

function appendTerminalOutput(session: TerminalSession, value: string): void {
  const normalized = stripAnsi(value).replace(/\r(?=\n)/g, '');
  if (!normalized) return;
  session.buffer += normalized;
  if (session.buffer.length > MAX_TERMINAL_BUFFER) {
    const dropped = session.buffer.length - MAX_TERMINAL_BUFFER;
    session.buffer = session.buffer.slice(dropped);
    session.cursor = Math.max(0, session.cursor - dropped);
  }
  session.lastActivityAt = new Date();
}

function writeTerminalInput(session: TerminalSession, input: string, appendNewline: boolean): Promise<void> {
  const suffix = appendNewline ? '\n' : '';
  const payload = `${input}${suffix}`;
  return new Promise((resolve, reject) => {
    session.process.stdin.write(payload, 'utf8', (error) => {
      if (error) reject(error);
      else {
        session.lastActivityAt = new Date();
        resolve();
      }
    });
  });
}

async function waitForTerminalQuiet(
  session: TerminalSession,
  previousLength: number,
  maxWaitMs: number,
  quietMs = 140,
): Promise<void> {
  if (maxWaitMs <= 0) return;
  const startedAt = Date.now();
  let lastLength = session.buffer.length;
  let lastChangeAt = startedAt;
  let sawChange = lastLength > previousLength;

  while (!session.closed && Date.now() - startedAt < maxWaitMs) {
    await delay(35);
    if (session.buffer.length !== lastLength) {
      lastLength = session.buffer.length;
      lastChangeAt = Date.now();
      sawChange = true;
      continue;
    }
    if (sawChange && Date.now() - lastChangeAt >= quietMs) return;
  }
}

function readTerminalChunk(session: TerminalSession, maxChars: number): TerminalReadResult {
  const end = Math.min(session.buffer.length, session.cursor + maxChars);
  const text = session.buffer.slice(session.cursor, end);
  session.cursor = end;
  return {
    text,
    moreAvailable: session.cursor < session.buffer.length,
  };
}

function formatTerminalOutput(session: TerminalSession, read: TerminalReadResult, extra = ''): string {
  return [
    `session_id: ${session.id}`,
    `shell: ${session.shell}`,
    `pid: ${session.process.pid ?? 'unknown'}`,
    `state: ${session.closed ? 'closed' : 'running'}`,
    `cwd: ${session.cwd}`,
    `more_output_available: ${read.moreAvailable}`,
    extra,
    '',
    read.text || '(no new output)',
  ].filter((line, index) => Boolean(line) || index === 7).join('\n');
}

function waitForTerminalExit(session: TerminalSession, timeoutMs: number): Promise<void> {
  if (session.closed) return Promise.resolve();
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const finish = () => {
      if (timer) clearTimeout(timer);
      session.process.removeListener('exit', finish);
      resolve();
    };
    session.process.once('exit', finish);
    timer = setTimeout(finish, timeoutMs);
  });
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class ToolOperationError extends Error {
  constructor(message: string, readonly output: string) {
    super(message);
    this.name = 'ToolOperationError';
  }
}
