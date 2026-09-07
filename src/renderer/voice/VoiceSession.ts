export type VoiceSessionState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface VoiceSessionSnapshot {
  /** The voice surface is open. Everything else is ignored when it is not. */
  open: boolean;
  recording: boolean;
  transcribing: boolean;
  /** A reply is being generated. */
  streaming: boolean;
  /** Audio is playing, or a streaming reader still has sentences to say. */
  speaking: boolean;
}

/**
 * What a voice conversation is doing right now, derived rather than tracked.
 *
 * The temptation is a state machine that the session drives with enter/exit
 * calls. It would then be a second source of truth about whether the microphone
 * is open, and the two would disagree the first time a recording failed or a
 * reply errored - showing "listening" at a closed microphone is worse than
 * showing nothing.
 *
 * So the state is a pure function of what is already true elsewhere: the
 * recorder's state, whether a reply is streaming, whether audio is playing.
 * There is nothing to keep in sync.
 *
 * Between turns the answer is 'listening' rather than 'idle', because the line
 * stays open in a call - the caller reopens the microphone, and showing 'idle'
 * in the gap would make a continuous conversation look like it had stopped.
 */
export function voiceSessionState(snapshot: VoiceSessionSnapshot): VoiceSessionState {
  if (!snapshot.open) return 'idle';
  if (snapshot.recording) return 'listening';
  // Transcribing and generating are one waiting state to a listener: they said
  // something and Athena has not answered yet. Splitting them would flicker a
  // label for the few hundred milliseconds recognition takes.
  if (snapshot.transcribing || snapshot.streaming) return 'thinking';
  if (snapshot.speaking) return 'speaking';
  return 'listening';
}

/** What the surface says it is doing. Short, because it is read at a glance. */
export function voiceSessionLabel(state: VoiceSessionState): string {
  if (state === 'listening') return '在听';
  if (state === 'thinking') return '在想';
  if (state === 'speaking') return '在说';
  return '';
}

/**
 * How strongly the visualisation should pulse, 0 to 1.
 *
 * Listening follows the microphone, so the person can see they are being heard.
 * Speaking breathes on its own: the playback level is not available frame by
 * frame without tapping the audio graph, and a steady breath reads as presence
 * rather than as a meter that has stopped working. Thinking is quieter still.
 */
export function voiceSessionPulse(state: VoiceSessionState, micLevel: number, elapsedMs: number): number {
  if (state === 'listening') return Math.max(0.08, Math.min(1, micLevel * 5));
  const breath = (Math.sin(elapsedMs / (state === 'speaking' ? 260 : 900)) + 1) / 2;
  return state === 'speaking' ? 0.35 + breath * 0.5 : 0.1 + breath * 0.15;
}
