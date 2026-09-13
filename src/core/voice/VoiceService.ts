import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { getAppSettings } from '../config/SettingsStore';
import { cleanupVoiceCache, getVoiceTempDir } from '../privacy/PrivacyDataService';
import { resolveProjectRoot, resolveVoiceRootCandidates } from '../runtime/Paths';
import { ensureSufficientDiskSpace, InsufficientDiskSpaceError } from '../runtime/DiskSpaceGuard';
import { PythonWorker, PythonWorkerReply } from './PythonWorker';
import type { TtsEngine } from '../../shared/types';

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
  | 'cancelled'
  | 'service_unavailable'
  | 'unknown';

export interface VoiceCapabilities {
  architecture: 'desktop-local-1.0';
  stt: { mode: 'local'; ready: boolean; runtimePath: string; modelPath: string; reason?: string };
  tts: {
    mode: 'local';
    ready: boolean;
    /** The engine that will actually speak, after falling back if needed. */
    provider: TtsEngine;
    /** Windows voices, which only apply to the SAPI engine. */
    voices: Array<{ name: string; culture: string }>;
    reason?: string;
    piper: { ready: boolean; voice: string; modelPath: string; reason?: string };
    sapi: { ready: boolean; reason?: string };
    /** Piper has no pitch parameter, so the control is inert on that engine. */
    supportsPitch: boolean;
  };
  onlineStt: { available: false; consentGate: 'onlineSpeechToText' };
  onlineTts: { available: false; consentGate: 'onlineTextToSpeech' };
  runtimeDownloadsAllowed: false;
}

interface ProcessResult { code: number | null; stdout: string; stderr: string }

interface SttReadiness {
  ready: boolean;
  python: string;
  model: string;
  code?: VoiceFailureCode;
  reason?: string;
}

const STT_RUNTIME_MISSING = '本地语音运行时未安装。正式包必须提供受管 Python 3.11 sidecar。';
const STT_MODEL_MISSING = '本地 Whisper 模型缺失；Athena 不会在运行时自动下载。';
const TTS_MODEL_MISSING = '本地神经语音模型缺失；Athena 不会在运行时自动下载。';
const STT_TIMEOUT_MS = 90_000;
const TTS_TIMEOUT_MS = 45_000;
const PIPER_VOICE = 'zh_CN-huayan-medium';

/** The first load reads a model off disk cold, so the handshake wait is generous. */
const WORKER_OPTIONS = {
  handshakeTimeoutMs: 120_000,
  // An idle model holds a few hundred megabytes for nothing.
  idleShutdownMs: 5 * 60_000,
  startCooldownMs: 60_000,
  requestTimeoutMs: STT_TIMEOUT_MS,
  maxLineBytes: 1_000_000,
};
const TTS_WORKER_OPTIONS = { ...WORKER_OPTIONS, requestTimeoutMs: TTS_TIMEOUT_MS };

const PROJECT_ROOT = resolveProjectRoot();
const SCRIPT_ROOT = resolveVoiceScriptRoot();
const TEMP_DIR = getVoiceTempDir();
const MAX_SYNTHESIZE_CHARS = 4_000;
const MAX_RECORDING_BYTES = 32 * 1024 * 1024;
const TRANSCRIBE_EXTENSIONS = new Set(['.wav', '.aiff', '.aif', '.flac']);

export class VoiceService {
  private readonly activeOperations = new Set<AbortController>();
  private sttWorker: PythonWorker | null = null;
  private ttsWorker: PythonWorker | null = null;

  /** Release the resident models; the next request warms fresh ones. */
  dispose(): void {
    this.cancelAll();
    this.sttWorker?.dispose();
    this.ttsWorker?.dispose();
    this.sttWorker = null;
    this.ttsWorker = null;
  }

  private getSttWorker(): PythonWorker {
    // Paths are resolved per spawn rather than captured, so a settings or
    // environment change takes effect on the next start instead of being
    // frozen into the first one.
    this.sttWorker ||= new PythonWorker(
      () => {
        const current = resolveSttReadiness();
        return spawn(
          current.python,
          [path.join(SCRIPT_ROOT, 'stt_whisper.py'), '--serve', current.model],
          voiceProcessOptions(),
        );
      },
      WORKER_OPTIONS,
    );
    return this.sttWorker;
  }

  private getTtsWorker(): PythonWorker {
    this.ttsWorker ||= new PythonWorker(
      () => spawn(
        resolveSttReadiness().python,
        [path.join(SCRIPT_ROOT, 'tts_piper.py'), '--serve', resolvePiperModelPath()],
        voiceProcessOptions(),
      ),
      TTS_WORKER_OPTIONS,
    );
    return this.ttsWorker;
  }

  cancelAll(): number {
    let cancelled = 0;
    for (const controller of this.activeOperations) {
      controller.abort();
      cancelled += 1;
    }
    return cancelled;
  }

  private beginOperation(signal?: AbortSignal): { signal: AbortSignal; end: () => void } {
    const controller = new AbortController();
    this.activeOperations.add(controller);
    const onExternalAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onExternalAbort, { once: true });
    }
    return {
      signal: controller.signal,
      end: () => {
        signal?.removeEventListener('abort', onExternalAbort);
        this.activeOperations.delete(controller);
      },
    };
  }
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
          ? STT_RUNTIME_MISSING
          : !modelReady
            ? STT_MODEL_MISSING
            : undefined,
      },
      tts: (() => {
        const piperModel = resolvePiperModelPath();
        const piperReady = pythonReady && fs.existsSync(piperModel);
        const sapiReason = !sapiScriptsReady
          ? '本地朗读组件缺失。'
          : voices.length === 0
            ? 'Windows 没有已启用的系统声音。'
            : !selectedVoiceReady
              ? `设置的系统声音不存在：${selectedVoice}`
              : undefined;
        // What will actually speak, after the fallback: a build without the
        // neural voice packaged still reads aloud, just not as well.
        const engine = resolveTtsEngine() === 'piper' && piperReady ? 'piper' : 'sapi';
        const ready = engine === 'piper' ? piperReady : sapiReady;
        return {
          mode: 'local' as const,
          ready,
          provider: engine,
          voices,
          reason: ready
            ? undefined
            : engine === 'piper'
              ? (!pythonReady ? STT_RUNTIME_MISSING : TTS_MODEL_MISSING)
              : sapiReason,
          piper: {
            ready: piperReady,
            voice: PIPER_VOICE,
            modelPath: piperModel,
            reason: piperReady ? undefined : !pythonReady ? STT_RUNTIME_MISSING : TTS_MODEL_MISSING,
          },
          sapi: { ready: sapiReady, reason: sapiReason },
          // Piper's synthesis config has length, volume and noise, but no pitch.
          supportsPitch: engine === 'sapi',
        };
      })(),
      onlineStt: { available: false, consentGate: 'onlineSpeechToText' },
      onlineTts: { available: false, consentGate: 'onlineTextToSpeech' },
      runtimeDownloadsAllowed: false,
    };
  }

  async synthesize(text: string, signal?: AbortSignal): Promise<VoiceResult> {
    const content = text.trim();
    if (!content) return failure('input_error', '没有可朗读的文本。');
    if (content.length > MAX_SYNTHESIZE_CHARS) return failure('input_error', `朗读文本超过 ${MAX_SYNTHESIZE_CHARS} 个字符上限，请缩短后重试。`);
    const piperModel = resolvePiperModelPath();
    const python = resolvePythonRuntime();
    const piperRuntimePresent = !path.isAbsolute(python) || fs.existsSync(python);
    const usePiper = resolveTtsEngine() === 'piper' && piperRuntimePresent && fs.existsSync(piperModel);
    // SAPI is the only Windows-bound engine; piper runs wherever the sidecar does.
    if (!usePiper && process.platform !== 'win32') {
      return failure('service_unavailable', '当前版本的本地朗读仅支持 Windows。');
    }

    const operation = this.beginOperation(signal);
    try {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
      try { ensureSufficientDiskSpace(TEMP_DIR, 32 * 1024 * 1024); }
      catch (error) { return failure('unknown', error instanceof InsufficientDiskSpaceError ? error.message : '无法检查语音缓存空间。'); }
      const id = randomUUID();
      const textPath = path.join(TEMP_DIR, `${id}.txt`);
      const audioPath = path.join(TEMP_DIR, `${id}.wav`);
      fs.writeFileSync(textPath, content, 'utf8');

      const settings = getAppSettings().voice;
      if (usePiper) {
        const spoken = await this.speakWithPiper(textPath, audioPath, piperModel, settings, operation.signal);
        safeUnlink(textPath);
        if (!spoken.ok) safeUnlink(audioPath);
        else cleanupVoiceCache(getAppSettings().data.voiceCacheRetentionHours);
        return spoken;
      }

      const voiceName = process.env.ATHENA_TTS_VOICE ?? settings.ttsVoice;
      const ttsArgs = [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(SCRIPT_ROOT, 'tts-local.ps1'), '-TextFile', textPath,
      ];
      if (voiceName.trim()) ttsArgs.push('-VoiceName', voiceName.trim());
      // Clamped again here so a hand-edited settings file cannot make the script
      // throw instead of speaking.
      ttsArgs.push('-Rate', String(clamp(settings.ttsRate, -10, 10)));
      ttsArgs.push('-Volume', String(clamp(settings.ttsVolume, 0, 100)));
      ttsArgs.push('-PitchPercent', String(clamp(settings.ttsPitch, -50, 50)));
      ttsArgs.push('-OutputFile', audioPath);
      const result = await runProcess('powershell.exe', ttsArgs, 45_000, operation.signal);
      safeUnlink(textPath);
      if (result.code !== 0 || !fs.existsSync(audioPath)) {
        safeUnlink(audioPath);
        return mapVoiceFailure(result, '本地朗读失败。请确认 Windows 已安装可用语音。');
      }
      cleanupVoiceCache(getAppSettings().data.voiceCacheRetentionHours);
      return { ok: true, audioPath };
    } finally {
      operation.end();
    }
  }

  /**
   * Synthesize with the local neural voice.
   *
   * Same shape as transcription: the resident worker when it is warm, a one-shot
   * spawn otherwise, and a worker that dies mid-sentence falls back rather than
   * failing - an optimisation breaking is not the voice breaking.
   */
  private async speakWithPiper(
    textPath: string,
    audioPath: string,
    model: string,
    settings: { ttsRate: number; ttsVolume: number },
    signal: AbortSignal,
  ): Promise<VoiceResult> {
    const rate = clamp(settings.ttsRate, -10, 10);
    const volume = clamp(settings.ttsVolume, 0, 100);

    const viaWorker = await this.getTtsWorker().run(
      { textFile: textPath, out: audioPath, rate, volume },
      signal,
    );
    if (viaWorker && viaWorker.code !== 'WORKER_LOST') {
      if (viaWorker.ok && fs.existsSync(audioPath)) return { ok: true, audioPath };
      return mapVoiceFailure(
        { code: 1, stdout: '', stderr: `[${viaWorker.code || 'TTS_ERROR'}] ${viaWorker.message || ''}` },
        '本地朗读失败。',
      );
    }

    const result = await runProcess(
      resolveSttReadiness().python,
      [path.join(SCRIPT_ROOT, 'tts_piper.py'), textPath, model, audioPath, String(rate), String(volume)],
      TTS_TIMEOUT_MS,
      signal,
    );
    if (result.code === 0 && fs.existsSync(audioPath)) return { ok: true, audioPath };
    return mapVoiceFailure(result, '本地朗读失败。');
  }

  async transcribe(audioPath: string, signal?: AbortSignal): Promise<VoiceResult> {
    const sourcePath = audioPath.trim();
    if (!sourcePath) return failure('input_error', '音频路径不能为空。');
    if (!path.isAbsolute(sourcePath)) return failure('input_error', '音频路径必须是绝对路径。');
    const extension = path.extname(sourcePath).toLowerCase();
    if (!TRANSCRIBE_EXTENSIONS.has(extension)) {
      return failure('input_error', '仅支持 WAV/AIFF/FLAC 音频文件。');
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(sourcePath);
    } catch {
      return failure('input_error', '音频文件不存在。');
    }
    if (!stat.isFile()) return failure('input_error', '音频路径不是普通文件。');

    const readiness = resolveSttReadiness();
    if (!readiness.ready) {
      return failure(readiness.code ?? 'runtime_missing', readiness.reason ?? '本地语音识别不可用。');
    }
    const operation = this.beginOperation(signal);
    try {
      const language = resolveSttLanguage();
      const viaWorker = isSttWorkerEnabled()
        ? await this.getSttWorker().run({ audio: sourcePath, language }, operation.signal)
        : null;
      // A worker that died mid-utterance is an optimisation failing, not a
      // transcription failing, so the one-shot path still gets its turn.
      if (viaWorker && viaWorker.code !== 'WORKER_LOST') return fromWorkerReply(viaWorker);

      const result = await runProcess(
        readiness.python,
        [path.join(SCRIPT_ROOT, 'stt_whisper.py'), sourcePath, readiness.model, language],
        STT_TIMEOUT_MS,
        operation.signal,
      );
      const text = result.stdout.trim();
      if (result.code === 0 && text) return { ok: true, text };
      return mapVoiceFailure(result, '本地语音识别失败。');
    } finally {
      operation.end();
    }
  }

  async transcribeRecording(audioBytes: Uint8Array, signal?: AbortSignal): Promise<VoiceResult> {
    if (audioBytes.byteLength === 0) return failure('input_error', 'Recording is empty.');
    if (audioBytes.byteLength > MAX_RECORDING_BYTES) return failure('input_error', `录音超过 ${MAX_RECORDING_BYTES / 1024 / 1024} MB 上限，请缩短录音后重试。`);
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    try { ensureSufficientDiskSpace(TEMP_DIR, Math.max(32 * 1024 * 1024, audioBytes.byteLength * 3)); }
    catch (error) { return failure('unknown', error instanceof InsufficientDiskSpaceError ? error.message : '无法检查录音缓存空间。'); }
    const audioPath = path.join(TEMP_DIR, `${randomUUID()}.wav`);
    try {
      fs.writeFileSync(audioPath, Buffer.from(audioBytes.buffer, audioBytes.byteOffset, audioBytes.byteLength));
      return await this.transcribe(audioPath, signal);
    } catch (error) {
      return failure('unknown', compactError(error instanceof Error ? error.message : String(error)));
    } finally {
      safeUnlink(audioPath);
    }
  }

  async play(audioPath: string, signal?: AbortSignal): Promise<VoiceResult> {
    const sourcePath = audioPath.trim();
    if (!sourcePath) return failure('input_error', '音频路径不能为空。');
    if (!path.isAbsolute(sourcePath)) return failure('input_error', '音频路径必须是绝对路径。');
    if (path.extname(sourcePath).toLowerCase() !== '.wav') {
      return failure('input_error', 'Desktop 1.0 本地播放仅接受 WAV 文件。');
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(sourcePath);
    } catch {
      return failure('input_error', '音频文件不存在。');
    }
    if (!stat.isFile()) return failure('input_error', '音频路径不是普通文件。');

    const operation = this.beginOperation(signal);
    try {
      const result = await runProcess('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(SCRIPT_ROOT, 'play_audio_local.ps1'), sourcePath,
      ], 120_000, operation.signal);
      return result.code === 0 ? { ok: true, text: result.stdout.trim() } : mapVoiceFailure(result, '系统音频播放失败。');
    } finally {
      operation.end();
    }
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

/**
 * Filesystem-only readiness for the transcription hot path.
 *
 * getCapabilities() is the full report for the settings panel: it spawns
 * `python --version` and a PowerShell SAPI voice enumeration. Neither says
 * anything about recognition, and transcribe() used to pay both on every
 * utterance - measured at ~343 ms against a ~449 ms decode. Missing pieces are
 * still classified correctly here, and anything this check cannot see (a broken
 * interpreter, a corrupt model) is classified by the child process itself.
 */
function resolveSttReadiness(): SttReadiness {
  const python = resolvePythonRuntime();
  const model = resolveWhisperModelPath();
  // A bare command name is resolved through PATH by the OS, so only an absolute
  // managed path can be checked from here.
  if (path.isAbsolute(python) && !fs.existsSync(python)) {
    return { ready: false, python, model, code: 'runtime_missing', reason: STT_RUNTIME_MISSING };
  }
  if (!isWhisperModelDirectory(model)) {
    return { ready: false, python, model, code: 'model_missing', reason: STT_MODEL_MISSING };
  }
  return { ready: true, python, model };
}

/**
 * The resident recogniser can be switched off without touching settings, which
 * is how the measurement suite compares the two paths and how a machine with a
 * misbehaving sidecar gets back to the one-shot behaviour.
 */
function isSttWorkerEnabled(): boolean {
  return process.env.ATHENA_STT_WORKER !== '0';
}

/** The packaged neural voice; absent in a build without the voice payload. */
function resolvePiperModelPath(): string {
  if (process.env.ATHENA_PIPER_MODEL?.trim()) return path.resolve(process.env.ATHENA_PIPER_MODEL.trim());
  return path.join(SCRIPT_ROOT, 'models', PIPER_VOICE, `${PIPER_VOICE}.onnx`);
}

function resolveTtsEngine(): TtsEngine {
  const override = process.env.ATHENA_TTS_ENGINE?.trim();
  if (override === 'piper' || override === 'sapi') return override;
  return getAppSettings().voice.ttsEngine;
}

/** The recognition language the sidecar is asked for; 'auto' lets it detect. */
function resolveSttLanguage(): string {
  const override = process.env.ATHENA_STT_LANGUAGE?.trim();
  if (override) return override;
  return getAppSettings().voice.sttLanguage;
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

/** Shared by the one-shot spawns and the resident worker so both stay offline. */
function voiceProcessOptions() {
  return {
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
  };
}

/** Classify a worker reply with the same table the one-shot path uses. */
function fromWorkerReply(reply: PythonWorkerReply): VoiceResult {
  // The reply is whatever the sidecar sent, so its shape is checked rather than
  // trusted before it becomes what the user sees.
  const text = typeof reply.text === 'string' ? reply.text.trim() : '';
  if (reply.ok && text) return { ok: true, text };
  return mapVoiceFailure(
    { code: 1, stdout: '', stderr: `[${reply.code || 'STT_ERROR'}] ${reply.message || ''}` },
    '本地语音识别失败。',
  );
}

function runProcess(command: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, voiceProcessOptions());
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => {
      try { child.kill(); } catch { /* Child may already be gone. */ }
      settle({ code: -1, stdout, stderr: stderr || '[CANCELLED] 语音操作已取消。' });
    };
    const timer = setTimeout(() => {
      if (settled) return;
      try { child.kill(); } catch { /* Child may already be gone. */ }
      settle({ code: -1, stdout, stderr: stderr || '[TIMEOUT] Voice command timed out.' });
    }, timeoutMs);
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => {
      if (settled) return;
      settle({ code: -1, stdout, stderr: `[RUNTIME_MISSING] ${error.message}` });
    });
    child.on('close', code => {
      settle({ code, stdout, stderr });
    });
  });
}

function mapVoiceFailure(result: ProcessResult, fallback: string): VoiceResult {
  const detail = compactError(result.stderr || result.stdout || fallback);
  if (/CANCELLED/i.test(detail)) return failure('cancelled', '语音操作已取消。');
  if (/RUNTIME_MISSING|not recognized|ENOENT/i.test(detail)) return failure('runtime_missing', '本地语音运行时缺失，请修复或重新安装语音组件。');
  if (/DEPENDENCY_ERROR|No module named/i.test(detail)) return failure('dependency_missing', '本地语音依赖不完整，请修复语音组件。');
  if (/MODEL_MISSING|model.*missing/i.test(detail)) return failure('model_missing', '本地 Whisper 模型缺失；为避免隐式联网，Athena 不会自动下载。');
  if (/USAGE_ERROR|INPUT_ERROR/i.test(detail)) return failure('input_error', `语音组件拒绝了这次请求。${detail}`);
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

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min > 0 ? min : 0;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function safeUnlink(filePath: string): void { try { fs.unlinkSync(filePath); } catch {} }
function compactError(value: string): string { return value.trim().replace(/\s+/g, ' ').slice(0, 300); }
