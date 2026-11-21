import type { AudioEngine } from '../audio/audioEngine';
import { stepAt, type Timeline } from './timeline';

/** smplr only cancels notes already handed to it, so schedule at most this far ahead. */
const LOOKAHEAD_S = 0.18;
const SCHEDULE_EVERY_MS = 40;
const LEAD_IN_S = 0.12;
const TAIL_S = 0.4;

export interface PlayerCallbacks {
  /** The cursor should be on this score step now. */
  onStep(scoreStepIndex: number): void;
  onEnd(): void;
}

/**
 * Plays a Timeline on the AudioContext clock. Notes are scheduled a little ahead with a
 * timer; the cursor follows on requestAnimationFrame, compensating for output latency.
 */
export class Player {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame: number | null = null;
  private stops: (() => void)[] = [];
  private playing = false;

  constructor(private readonly engine: AudioEngine) {}

  isPlaying(): boolean {
    return this.playing;
  }

  play(timeline: Timeline, callbacks: PlayerCallbacks): void {
    this.stop();
    const ctx = this.engine.context;
    if (!ctx) throw new Error('Audio is not unlocked');
    this.playing = true;

    const startAt = ctx.currentTime + LEAD_IN_S;
    let next = 0;
    const schedule = () => {
      const horizon = ctx.currentTime + LOOKAHEAD_S;
      const instrument = this.engine.instrument();
      while (next < timeline.notes.length) {
        const note = timeline.notes[next];
        if (!note || startAt + note.start > horizon) break;
        this.stops.push(
          instrument.play(note.midi, note.velocity, startAt + note.start, note.duration),
        );
        next++;
      }
      if (this.stops.length > 256) this.stops = this.stops.slice(-128);
    };
    schedule();
    this.timer = setInterval(schedule, SCHEDULE_EVERY_MS);

    let shown = -1;
    const tick = () => {
      const latency = ctx.outputLatency || ctx.baseLatency || 0;
      const t = ctx.currentTime - startAt - latency;
      const index = stepAt(timeline, t);
      if (index !== shown && index >= 0) {
        shown = index;
        const step = timeline.steps[index];
        if (step) callbacks.onStep(step.scoreStepIndex);
      }
      if (t > timeline.end + TAIL_S) {
        this.stop();
        callbacks.onEnd();
        return;
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.timer = null;
    this.frame = null;
    for (const stop of this.stops) stop();
    this.stops = [];
    if (this.playing) this.engine.stopAll();
    this.playing = false;
  }
}
