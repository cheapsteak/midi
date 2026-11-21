import { pianoToPreset, Sampler } from 'smplr';
import type { MidiNote } from '../midi/types';
import type { Instrument } from './instrument';

/** The MF layer is bundled in public/piano (see its README). */
const LAYER: [number, number] = [85, 100];

export interface PianoOptions {
  /** Where the samples live. Default: public/piano of this app (works offline in the iPad app). */
  baseUrl?: string;
  /** Skip the sampled piano and use the built-in synth (tests, offline). */
  disabled?: boolean;
}

/** smplr only logs a 404 and plays silence for that key; fail loudly so we fall back. */
const strictStorage = {
  async fetch(url: string): Promise<Response> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} for ${decodeURIComponent(url)}`);
    return response;
  },
};

const safeName = (sample: string) => sample.replace(/ /g, '_').replace(/#/g, 's');

/**
 * The sampled grand piano (Splendid Grand Piano via smplr). One velocity layer stretched over
 * every velocity: loudness still follows velocity, and only ~7 MB is downloaded.
 */
export class PianoInstrument implements Instrument {
  readonly name = 'Grand piano';
  readonly ready: Promise<void>;
  private readonly sampler: ReturnType<typeof Sampler>;

  constructor(ctx: AudioContext, options: PianoOptions = {}) {
    const preset = pianoToPreset({
      baseUrl: options.baseUrl ?? `${import.meta.env.BASE_URL}piano`,
      // AAC decodes everywhere we run, including WKWebView (whose user agent hides "Safari").
      formats: ['m4a'],
      decayTime: 0.6,
      detune: 0,
      notesToLoad: { notes: [...Array(128).keys()], velocityRange: LAYER },
    });
    const names = preset.groups.flatMap((g) => g.regions.map((r) => r.sample));
    preset.samples.map = Object.fromEntries(names.map((n) => [n, safeName(n)]));
    for (const group of preset.groups) group.velRange = [1, 127];
    this.sampler = Sampler(ctx, { preset, storage: strictStorage, maxVoices: 48 });
    this.ready = this.sampler.ready;
  }

  play(midi: MidiNote, velocity: number, time?: number, duration?: number): () => void {
    const stop = this.sampler.start({ note: midi, velocity, time, duration });
    return () => stop();
  }

  stopAll(): void {
    this.sampler.stop();
  }
}
