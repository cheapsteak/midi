import { Capacitor } from '@capacitor/core';
import { Emitter } from '../midi/emitter';
import { MidiBridge } from '../native/midiBridge';
import type { Instrument } from './instrument';
import { PianoInstrument, type PianoOptions } from './piano';
import { SynthInstrument } from './synth';

export type SoundState =
  | { state: 'off' }
  | { state: 'loading' }
  | { state: 'ready'; instrument: string }
  | { state: 'fallback'; reason: string };

const PIANO_LOAD_TIMEOUT_MS = 20_000;

/**
 * Owns the AudioContext and the instruments. `unlock()` must be called from a tap or
 * click (browsers, and especially iOS, only start audio from a user gesture).
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private piano: PianoInstrument | null = null;
  private synth: SynthInstrument | null = null;
  private pianoReady = false;
  private loading: Promise<void> | null = null;
  private status: SoundState = { state: 'off' };
  private readonly changed = new Emitter<SoundState>();

  constructor(private readonly pianoOptions: PianoOptions = {}) {}

  getStatus(): SoundState {
    return this.status;
  }

  onStatusChanged(cb: (s: SoundState) => void): () => void {
    return this.changed.on(cb);
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Call synchronously inside a user gesture. Safe to call repeatedly. */
  unlock(): AudioContext {
    if (!this.ctx) {
      // iOS: Web Audio is "ambient" by default, so the silent switch mutes it.
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'playback';
      if (Capacitor.getPlatform() === 'ios') MidiBridge.setAudioPlayback().catch(() => {});
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.synth = new SynthInstrument(this.ctx);
      this.loadPiano(this.ctx);
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
    return this.ctx;
  }

  /** Resolves when the piano is loaded, or when we gave up and use the synth. */
  async whenReady(): Promise<void> {
    await this.loading;
  }

  /** The best instrument available right now. */
  instrument(): Instrument {
    if (this.piano && this.pianoReady) return this.piano;
    if (!this.synth) throw new Error('unlock() first');
    return this.synth;
  }

  stopAll(): void {
    this.piano?.stopAll();
    this.synth?.stopAll();
  }

  private loadPiano(ctx: AudioContext): void {
    if (this.pianoOptions.disabled) {
      this.setStatus({ state: 'fallback', reason: 'Sampled piano disabled (?synth=1).' });
      return;
    }
    this.setStatus({ state: 'loading' });
    try {
      this.piano = new PianoInstrument(ctx, this.pianoOptions);
    } catch (err) {
      this.setStatus({ state: 'fallback', reason: String(err) });
      return;
    }
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timed out')), PIANO_LOAD_TIMEOUT_MS),
    );
    this.loading = Promise.race([this.piano.ready, timeout]).then(
      () => {
        this.pianoReady = true;
        this.setStatus({ state: 'ready', instrument: 'Grand piano' });
      },
      (err: unknown) => {
        // A slow download can still finish later: switch to the piano then.
        this.piano?.ready.then(
          () => {
            this.pianoReady = true;
            this.setStatus({ state: 'ready', instrument: 'Grand piano' });
          },
          () => {},
        );
        this.setStatus({
          state: 'fallback',
          reason: `Piano samples didn't load (${err instanceof Error ? err.message : String(err)}). Using the built-in synth.`,
        });
      },
    );
  }

  private setStatus(status: SoundState): void {
    this.status = status;
    this.changed.emit(status);
  }
}
