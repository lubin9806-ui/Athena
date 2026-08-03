import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { getAppSettings } from '../config/SettingsStore';
import { cleanupVoiceCache, getVoiceTempDir } from '../privacy/PrivacyDataService';
import { resolveProjectRoot, resolveVoiceRootCandidates } from '../runtime/Paths';
import { ensureSufficientDiskSpace, InsufficientDiskSpaceError } from '../runtime/DiskSpaceGuard';

export interface VoiceResult {
  ok: boolean;
  text?: string;
  audioPath?: string;
  error?: string;
  code?: VoiceFailureCode;
}

export type VoiceFailureCode =
  | 'runtime_missing'
  | 'dependency_missing'
  | 'model_missing'
  | 'input_error'
  | 'no_speech'
  | 'timeout'
  | 'offline'
  | 'service_unavailable'
  | 'unknown';

export interface VoiceCapabilities {
  architecture: 'desktop-local-1.0';
  stt: { mode: 'local'; ready: boolean; runtimePath: string; modelPath: string; reason?: string };
  tts: {
    mode: 'local';
    ready: boolean;
    provider: 'windows-sapi';
    voices: Array<{ name: string; culture: string }>;
    reason?: string;
  };
  onlineStt: { available: false; consentGate: 'onlineSpeechToText' };
  onlineTts: { available: false; consentGate: 'onlineTextToSpeech' };
  runtimeDownloadsAllowed: false;
}

interface ProcessResult { code: number | null; stdout: string; stderr: string }

const PROJECT_ROOT = resolveProjectRoot();
const SCRIPT_ROOT = resolveVoiceScriptRoot();
const TEMP_DIR = getVoiceTempDir();

export class VoiceService {
  async getCapabilities(): Promise<VoiceCapabilities> {
    const python = resolvePythonRuntime();
    const modelPath = resolveWhisperModelPath();
    const pythonReady = await commandAvailable(python, ['--version']);
    const modelReady = isWhisperModelDirectory(modelPath);
    const sapiScriptsReady = process.platform === 'win32'
      && fs.existsSync(path.join(SCRIPT_ROOT, 'tts-local.ps1'))
      && fs.existsSync(path.join(SCRIPT_ROOT, 'play_audio_local.ps1'))
      && fs.existsSync(path.join(SCRIPT_ROOT, 'tts-capabilities.ps1'));
    const voices = sapiScriptsReady ? await inspectWindowsVoices() : [];
    const selectedVoice = (process.env.ATHENA_TTS_VOICE ?? getAppSettings().voice.ttsVoice).trim();
    const selectedVoiceReady = !selectedVoice || voices.some(voice => voice.name === selectedVoice);
    const sapiReady = sapiScriptsReady && voices.length > 0 && selectedVoiceReady;
    return {
      architecture: 'desktop-local-1.0',
      stt: {
        mode: 'local',
        ready: pythonReady && modelReady,
        runtimePath: python,
        modelPath,
        reason: !pythonReady
          ? '本地语音运行时未安装。正式包必须提供受管 Python 3.11 sidecar。'
          : !modelReady
            ? '本地 Whisper 模型缺失；Athena 不会在运行时自动下载。'
            : undefined,
      },
      tts: {
        mode: 'local',
        ready: sapiReady,
        provider: 'windows-sapi',
        voices,
        reason: sapiReady
          ? undefined
          : !sapiScriptsReady
            ? '本地朗读组件缺失。'
            : voices.length === 0
              ? 'Windows 没有已启用的系统声音。'
              : `设置的系统声音不存在：${selectedVoice}`,
      },
      onlineStt: { available: false, consentGate: 'onlineSpeechToText' },
      onlineTts: { available: false, consentGate: 'onlineTextToSpeech' },
      runtimeDownloadsAllowed: false,
    };
  }

  async synthesize(text: string): Promise<VoiceResult> {
    const content = text.trim();
    if (!content) return failure('input_error', '没有可朗读的文本。');
    if (process.platform !== 'win32') return failure('service_unavailable', '当前版本的本地朗读仅支持 Windows。');

    fs.mkdirSync(TEMP_DIR, { recursive: true });
    try { ensureSufficientDiskSpace(TEMP_DIR, 32 * 1024 * 1024); }
    catch (error) { return failure('unknown', error instanceof InsufficientDiskSpaceError ? error.message : '无法检查语音缓存空间。'); }
    const id = randomUUID();
    const textPath = path.join(TEMP_DIR, `${id}.txt`);
    const audioPath = path.join(TEMP_DIR, `${id}.wav`);
    fs.writeFileSync(textPath, content, 'utf8');

    const voiceName = process.env.ATHENA_TTS_VOICE ?? getAppSettings().voice.ttsVoice;
    const ttsArgs = [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(SCRIPT_ROOT, 'tts-local.ps1'), '-TextFile', textPath,
    ];
    if (voiceName.trim()) ttsArgs.push('-VoiceName', voiceName.trim());
    ttsArgs.push('-OutputFile', audioPath);
    const result = await runProcess('powershell.exe', ttsArgs, 45_000);
    safeUnlink(textPath);
    if (result.code !== 0 || !fs.existsSync(audioPath)) {
      safeUnlink(audioPath);
      return mapVoiceFailure(result, '本地朗读失败。请确认 Windows 已安装可用语音。');
    }
    cleanupVoiceCache(getAppSettings().data.voiceCacheRetentionHours);
    return { ok: true, audioPath };
  }

  async transcribe(audioPath: string): Promise<VoiceResult> {
    const sourcePath = audioPath.trim();
    if (!sourcePath || !fs.existsSync(sourcePath)) return failure('input_error', '音频文件不存在。');
    const capabilities = await this.getCapabilities();
    if (!capabilities.stt.ready) {
      return failure(capabilities.stt.reason?.includes('模型') ? 'model_missing' : 'runtime_missing', capabilities.stt.reason || '本地语音识别不可用。');
    }
    const result = await runProcess(
      capabilities.stt.runtimePath,
      [path.join(SCRIPT_ROOT, 'stt_whisper.py'), sourcePath, capabilities.stt.modelPath],
      90_000,
    );
    const text = result.stdout.trim();
    if (result.code === 0 && text) return { ok: true, text };
    return mapVoiceFailure(result, '本地语音识别失败。');
  }

  async transcribeRecording(audioBytes: Uint8Array): Promise<VoiceResult> {
    if (audioBytes.byteLength === 0) return failure('input_error', 'Recording is empty.');
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    try { ensureSufficientDiskSpace(TEMP_DIR, Math.max(32 * 1024 * 1024, audioBytes.byteLength * 3)); }
    catch (error) { return failure('unknown', error instanceof InsufficientDiskSpaceError ? error.message : '无法检查录音缓存空间。'); }
    const audioPath = path.join(TEMP_DIR, `${randomUUID()}.wav`);
    try {
      fs.writeFileSync(audioPath, Buffer.from(audioBytes.buffer, audioBytes.byteOffset, audioBytes.byteLength));
      return await this.transcribe(audioPath);
    } catch (error) {
      return failure('unknown', compactError(error instanceof Error ? error.message : String(error)));
    } finally {
      safeUnlink(audioPath);
    }
  }

  async play(audioPath: string): Promise<VoiceResult> {
    const sourcePath = audioPath.trim();
    if (!sourcePath || !fs.existsSync(sourcePath)) return failure('input_error', '音频文件不存在。');
    if (path.extname(sourcePath).toLowerCase() !== '.wav') {
      return failure('input_error', 'Desktop 1.0 本地播放仅接受 WAV 文件。');
    }
    const result = await runProcess('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(SCRIPT_ROOT, 'play_audio_local.ps1'), sourcePath,
    ], 120_000);
    return result.code === 0 ? { ok: true, text: result.stdout.trim() } : mapVoiceFailure(result, '系统音频播放失败。');
  }
}

function resolvePythonRuntime(): string {
  if (process.env.ATHENA_PYTHON?.trim()) return process.env.ATHENA_PYTHON.trim();
  const managed = path.join(SCRIPT_ROOT, 'python', 'python.exe');
  if (fs.existsSync(managed)) return managed;
  // System Python is a development-only fallback. Packaged builds never silently
  // bind to an arbitrary machine installation.
  return process.resourcesPath ? managed : 'python';
}

function resolveWhisperModelPath(): string {
  if (process.env.ATHENA_WHISPER_MODEL_DIR?.trim()) return path.resolve(process.env.ATHENA_WHISPER_MODEL_DIR.trim());
  return path.join(SCRIPT_ROOT, 'models', 'whisper-tiny');
}

function isWhisperModelDirectory(modelPath: string): boolean {
  return fs.existsSync(modelPath)
    && fs.existsSync(path.join(modelPath, 'config.json'))
    && fs.readdirSync(modelPath).some(name => /model.*\.(?:bin|onnx)$/i.test(name));
}

function commandAvailable(command: string, args: string[]): Promise<boolean> {
  return runProcess(command, args, 5_000).then(result => result.code === 0);
}

async function inspectWindowsVoices(): Promise<Array<{ name: string; culture: string }>> {
  const result = await runProcess('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(SCRIPT_ROOT, 'tts-capabilities.ps1'),
  ], 10_000);
  if (result.code !== 0) return [];
  try {
    const parsed = JSON.parse(result.stdout.trim()) as { voices?: unknown };
    if (!Array.isArray(parsed.voices)) return [];
    return parsed.voices.flatMap((voice) => {
      if (!voice || typeof voice !== 'object') return [];
      const record = voice as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      const culture = typeof record.culture === 'string' ? record.culture.trim() : '';
      return name ? [{ name, culture }] : [];
    });
  } catch {
    return [];
  }
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: SCRIPT_ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONUTF8: '1',
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
      },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ code: -1, stdout, stderr: stderr || '[TIMEOUT] Voice command timed out.' });
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `[RUNTIME_MISSING] ${error.message}` });
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function mapVoiceFailure(result: ProcessResult, fallback: string): VoiceResult {
  const detail = compactError(result.stderr || result.stdout || fallback);
  if (/RUNTIME_MISSING|not recognized|ENOENT/i.test(detail)) return failure('runtime_missing', '本地语音运行时缺失，请修复或重新安装语音组件。');
  if (/DEPENDENCY_ERROR|No module named/i.test(detail)) return failure('dependency_missing', '本地语音依赖不完整，请修复语音组件。');
  if (/MODEL_MISSING|model.*missing/i.test(detail)) return failure('model_missing', '本地 Whisper 模型缺失；为避免隐式联网，Athena 不会自动下载。');
  if (/NO_SPEECH/i.test(detail)) return failure('no_speech', '没有识别到清晰语音，请靠近麦克风后重试。');
  if (/TIMEOUT|timed out/i.test(detail)) return failure('timeout', '语音处理超时；系统资源可能不足，请缩短录音后重试。');
  if (/network|connection|offline|service request/i.test(detail)) return failure('offline', '网络不可用；当前操作没有可用的联网语音适配器。');
  return failure('unknown', `${fallback} ${detail}`.trim());
}

function failure(code: VoiceFailureCode, error: string): VoiceResult { return { ok: false, code, error }; }

function resolveVoiceScriptRoot(): string {
  const candidates = resolveVoiceRootCandidates();
  return candidates.find(candidate => fs.existsSync(path.join(candidate, 'stt_whisper.py')))
    || candidates[candidates.length - 1]
    || PROJECT_ROOT;
}

function safeUnlink(filePath: string): void { try { fs.unlinkSync(filePath); } catch {} }
function compactError(value: string): string { return value.trim().replace(/\s+/g, ' ').slice(0, 300); }
