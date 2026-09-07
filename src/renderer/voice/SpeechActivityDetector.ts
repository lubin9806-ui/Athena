export type SpeechActivityState = 'calibrating' | 'quiet' | 'speech';

export interface SpeechActivityOptions {
  /** Frames spent measuring the room before any decision is made. */
  calibrationFrames: number;
  /** How far above the measured floor a frame must sit to count as speech. */
  floorMultiplier: number;
  /** Lower bound on the threshold, so a silent room stays sane. */
  minimumLevel: number;
  /** Cap on the *measured* floor, in case calibration caught someone talking. */
  maximumFloor: number;
  /** Consecutive loud frames before speech is declared. */
  onsetFrames: number;
  /** Consecutive quiet frames before speech is considered finished. */
  releaseFrames: number;
  /** How fast the floor follows a quiet room, 0 to 1 per frame. */
  floorAdaptation: number;
  /** Unbroken speech longer than this means the floor was measured too low. */
  maxSpeechFrames: number;
}

/**
 * Decides whether a run of loudness readings is someone talking.
 *
 * The previous rule was a single constant: any frame above 0.008 RMS, twice in a
 * row, was speech (ATH-VOICE-006). That is two failures in one. In a room with a
 * fan or an air conditioner the noise never drops under the constant, so the
 * pause that ends a recording never arrives; in a very quiet room someone
 * speaking softly never reaches it, and the recording is rejected as "no sound
 * detected".
 *
 * So the threshold is measured instead of assumed: the first frames establish
 * the room's floor, and speech has to stand above *that*. The old constant
 * survives as a lower bound, so a silent room cannot make a draught count.
 *
 * Nothing is decided while calibrating. Using the bare constant during that
 * window looked like a way to catch someone who starts talking at once, but in a
 * room noisier than the constant it makes calibration itself register as speech
 * - the exact defect being fixed. The cost is a blind first ~500ms, and it is
 * only blind to *noticing*: capture starts at frame zero either way, and this
 * output drives when to stop listening, not what gets recorded.
 *
 * Pure and synchronous on purpose: it is the part most likely to be wrong, and
 * this way it can be driven by recorded sequences instead of a microphone.
 */
export class SpeechActivityDetector {
  private readonly options: SpeechActivityOptions;
  private calibration: number[] = [];
  private floor = 0;
  private onsetRun = 0;
  private releaseRun = 0;
  private speechRun = 0;
  private speaking = false;
  private heardSpeech = false;
  private capFloor = true;

  constructor(options: SpeechActivityOptions) {
    this.options = options;
  }

  /** The measured room level; 0 until calibration finishes. */
  get noiseFloor(): number {
    return this.floor;
  }

  /** The level a frame must exceed right now to count towards speech. */
  get threshold(): number {
    return Math.max(this.options.minimumLevel, this.floor * this.options.floorMultiplier);
  }

  /** Whether speech has been heard at any point since the last reset. */
  get hasHeardSpeech(): boolean {
    return this.heardSpeech;
  }

  reset(): void {
    this.capFloor = true;
    this.recalibrate();
    this.heardSpeech = false;
  }

  push(level: number): SpeechActivityState {
    const reading = Number.isFinite(level) && level > 0 ? level : 0;

    if (this.calibration.length < this.options.calibrationFrames) {
      this.calibration.push(reading);
      if (this.calibration.length === this.options.calibrationFrames) this.settleFloor();
      return 'calibrating';
    }

    if (reading > this.threshold) {
      this.onsetRun += 1;
      this.releaseRun = 0;
      // A single loud frame is a door or a keystroke. Speech is sustained.
      if (this.onsetRun >= this.options.onsetFrames) {
        this.speaking = true;
        this.heardSpeech = true;
      }
    } else {
      this.onsetRun = 0;
      this.releaseRun += 1;
      if (this.speaking && this.releaseRun >= this.options.releaseFrames) {
        this.speaking = false;
        this.speechRun = 0;
      }
      // The floor follows the room only while nobody is talking, so a long
      // sentence cannot raise it until speech stops registering as speech.
      if (!this.speaking) {
        this.floor = this.floor * (1 - this.options.floorAdaptation) + reading * this.options.floorAdaptation;
      }
    }

    if (!this.speaking) return 'quiet';

    this.speechRun += 1;
    if (this.speechRun >= this.options.maxSpeechFrames) {
      // Speech that never pauses is a floor measured too low - a room louder
      // than the cap allows for. The cap guards against calibrating while
      // someone talks, and after this much unbroken "speech" that is no longer
      // the likely explanation, so the re-measurement is allowed to exceed it.
      this.capFloor = false;
      this.recalibrate();
      return 'calibrating';
    }
    return 'speech';
  }

  private recalibrate(): void {
    this.calibration = [];
    this.floor = 0;
    this.onsetRun = 0;
    this.releaseRun = 0;
    this.speechRun = 0;
    this.speaking = false;
  }

  /**
   * The quietest frame in the window, not the average.
   *
   * The floor being estimated is the room with nobody talking, and the quietest
   * moment is the closest thing to that the window contains. It is also what
   * survives someone talking through calibration: speech has gaps between
   * syllables, and those gaps sit near the room level. The cap is the backstop
   * for when even the gaps are loud.
   */
  private settleFloor(): void {
    const quietest = Math.min(...this.calibration);
    this.floor = this.capFloor ? Math.min(quietest, this.options.maximumFloor) : quietest;
  }
}

/**
 * Tuned for 4096-sample frames, which is ~85ms at the usual 48kHz capture rate:
 * ~510ms of calibration, ~170ms of speech before onset, ~1.2s of quiet before
 * release, and ~40s of unbroken speech before the floor is assumed wrong.
 *
 * minimumLevel is the constant the old fixed rule used, kept as a lower bound so
 * nothing that used to be heard stops being heard. maximumFloor sits above
 * ordinary room tone and well under speech, which is what lets a floor measured
 * while someone was talking still be usable.
 *
 * These are starting values from synthetic sequences, not from recordings of
 * real rooms. They are named and in one place so tuning against real audio is a
 * change of numbers rather than a change of design.
 */
export const RECORDING_ACTIVITY_OPTIONS: SpeechActivityOptions = {
  calibrationFrames: 6,
  floorMultiplier: 2.5,
  minimumLevel: 0.008,
  maximumFloor: 0.02,
  onsetFrames: 2,
  releaseFrames: 14,
  floorAdaptation: 0.05,
  maxSpeechFrames: 470,
};
