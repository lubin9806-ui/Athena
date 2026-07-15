import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { getAppSettings } from '../config/SettingsStore';
import { resolveProjectRoot, resolveVoiceRootCandidates } from '../runtime/Paths';

export interface VoiceResult {
  ok: boolean;
  text?: string;
  audioPath?: string;
  error?: string;
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const PYTHON = process.env.ATHENA_PYTHON || 'python';
const PROJECT_ROOT = resolveProjectRoot();
const SCRIPT_ROOT = resolveVoiceScriptRoot();
const TEMP_DIR = process.env.ATHENA_VOICE_TEMP_DIR || path.join(os.tmpdir(), 'athena', 'voice');

export class VoiceService {
  async synthesize(text: string): Promise<VoiceResult> {
    const content = text.trim();
    if (!content) return { ok: false, error: 'No text to speak.' };

    fs.mkdirSync(TEMP_DIR, { recursive: true });
    const id = randomUUID();
    const textPath = path.join(TEMP_DIR, `${id}.txt`);
    const audioPath = path.join(TEMP_DIR, `${id}.mp3`);
    fs.writeFileSync(textPath, content, 'utf8');

    const voiceName = process.env.ATHENA_TTS_VOICE || getAppSettings().voice.ttsVoice;
    const result = await runPython(path.join(SCRIPT_ROOT, 'tts.py'), [`@${textPath}`, voiceName, audioPath], 45000);
    safeUnlink(textPath);

    if (result.code !== 0 || !fs.existsSync(audioPath)) {
      return {
        ok: false,
        error: compactError(result.stderr || result.stdout || 'TTS failed. Check Python and edge-tts installation.'),
      };
    }

    cleanupOldVoiceFiles(getAppSettings().data.voiceCacheRetentionHours);
    return { ok: true, audioPath };
  }

  async transcribe(audioPath: string): Promise<VoiceResult> {
    const sourcePath = audioPath.trim();
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return { ok: false, error: 'Audio file does not exist.' };
    }

    const sttEngine = process.env.ATHENA_STT_ENGINE || getAppSettings().voice.sttEngine;

    if (sttEngine === 'whisper') {
      const local = await transcribeWithWhisper(sourcePath, 90000);
      if (local.text) return { ok: true, text: local.text };
      const online = await transcribeWithSpeechRecognition(sourcePath);
      if (online.text) return { ok: true, text: online.text };
      return { ok: false, error: compactError(local.error || online.error || 'Speech was not recognized.') };
    }

    const online = await transcribeWithSpeechRecognition(sourcePath);
    if (online.text) return { ok: true, text: online.text };
    if (sttEngine === 'speech_recognition') {
      return { ok: false, error: compactError(online.error || 'Speech was not recognized.') };
    }

    const local = await transcribeWithWhisper(sourcePath, 30000);
    if (local.text) return { ok: true, text: local.text };
    return {
      ok: false,
      error: compactError([online.error, local.error].filter(Boolean).join(' Local fallback: ') || 'Speech was not recognized.'),
    };
  }

  async transcribeRecording(audioBytes: Uint8Array): Promise<VoiceResult> {
    if (audioBytes.byteLength === 0) {
      return { ok: false, error: 'Recording is empty.' };
    }

    fs.mkdirSync(TEMP_DIR, { recursive: true });
    const audioPath = path.join(TEMP_DIR, `${randomUUID()}.wav`);

    try {
      fs.writeFileSync(
        audioPath,
        Buffer.from(audioBytes.buffer, audioBytes.byteOffset, audioBytes.byteLength),
      );
      return await this.transcribe(audioPath);
    } catch (error) {
      return {
        ok: false,
        error: compactError(error instanceof Error ? error.message : String(error)),
      };
    } finally {
      safeUnlink(audioPath);
    }
  }

  async play(audioPath: string): Promise<VoiceResult> {
    const sourcePath = audioPath.trim();
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return { ok: false, error: 'Audio file does not exist.' };
    }

    const result = await runPython(path.join(SCRIPT_ROOT, 'play_audio.py'), [sourcePath], 120000);
    if (result.code !== 0) {
      return {
        ok: false,
        error: compactError(result.stderr || result.stdout || 'System audio playback failed.'),
      };
    }
    return { ok: true, text: result.stdout.trim() };
  }
}

async function transcribeWithSpeechRecognition(audioPath: string): Promise<{ text?: string; error?: string }> {
  const result = await runPython(path.join(SCRIPT_ROOT, 'stt.py'), [audioPath], 45000);
  const text = result.stdout.trim();
  if (result.code === 0 && text) return { text };
  return { error: result.stderr || result.stdout };
}

async function transcribeWithWhisper(
  audioPath: string,
  timeoutMs: number,
): Promise<{ text?: string; error?: string }> {
  const result = await runPython(path.join(SCRIPT_ROOT, 'stt_whisper.py'), [audioPath], timeoutMs);
  const text = result.stdout.trim();
  if (result.code === 0 && text && !text.startsWith('[ERROR]')) return { text };
  return { error: result.stderr || result.stdout };
}

function runPython(scriptPath: string, args: string[], timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, [scriptPath, ...args], {
      cwd: SCRIPT_ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ code: -1, stdout, stderr: stderr || 'Voice command timed out.' });
    }, timeoutMs);

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: error.message });
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function resolveVoiceScriptRoot(): string {
  const candidates = resolveVoiceRootCandidates();

  return candidates.find(candidate => fs.existsSync(path.join(candidate, 'stt.py')))
    || candidates[candidates.length - 1]
    || PROJECT_ROOT;
}

function cleanupOldVoiceFiles(retentionHours: number): void {
  try {
    const cutoff = Date.now() - retentionHours * 60 * 60 * 1000;
    for (const file of fs.readdirSync(TEMP_DIR)) {
      const fullPath = path.join(TEMP_DIR, file);
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs < cutoff) safeUnlink(fullPath);
    }
  } catch {
    // Cleanup is best effort.
  }
}

function safeUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File may already be gone.
  }
}

function compactError(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 260);
}
