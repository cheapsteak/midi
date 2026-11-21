import type { MidiNote } from '../midi/types';
import type { Instrument } from './instrument';

const frequency = (midi: MidiNote) => 440 * 2 ** ((midi - 69) / 12);

/**
 * A tiny built-in "electric piano" made of oscillators. Used while the sampled piano is
 * loading, and as the fallback when its samples can't be downloaded (offline).
 */
export class SynthInstrument implements Instrument {
  readonly name = 'Built-in synth';
  private readonly voices = new Set<{ stop: (when?: number) => void }>();
  private readonly out: GainNode;

  constructor(private readonly ctx: AudioContext) {
    this.out = ctx.createGain();
    this.out.gain.value = 0.18;
    this.out.connect(ctx.destination);
  }

  play(midi: MidiNote, velocity: number, time?: number, duration?: number): () => void {
    const ctx = this.ctx;
    const start = Math.max(time ?? ctx.currentTime, ctx.currentTime);
    const peak = 0.25 + (0.75 * Math.min(127, Math.max(1, velocity))) / 127;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(peak, start + 0.008);
    // Piano-like: fast decay to a quiet sustain.
    env.gain.setTargetAtTime(peak * 0.35, start + 0.01, 0.35);
    env.connect(this.out);

    const oscillators = [
      { type: 'triangle' as const, ratio: 1, gain: 1 },
      { type: 'sine' as const, ratio: 2, gain: 0.25 },
    ].map(({ type, ratio, gain }) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = frequency(midi) * ratio;
      const g = ctx.createGain();
      g.gain.value = gain;
      osc.connect(g).connect(env);
      osc.start(start);
      return osc;
    });

    const release = (at: number) => {
      env.gain.cancelScheduledValues(at);
      env.gain.setTargetAtTime(0, at, 0.08);
      for (const osc of oscillators) osc.stop(at + 0.6);
    };
    let released = false;
    const voice = {
      stop: () => {
        if (released) return;
        released = true;
        release(ctx.currentTime);
        this.voices.delete(voice);
      },
    };
    this.voices.add(voice);
    oscillators[0]?.addEventListener('ended', () => this.voices.delete(voice));
    if (duration !== undefined) release(start + duration);
    return () => voice.stop();
  }

  stopAll(): void {
    for (const voice of [...this.voices]) voice.stop();
  }
}
