import type { MidiNote } from '../midi/types';

/** Something that can play notes on an AudioContext timeline. */
export interface Instrument {
  readonly name: string;
  /**
   * Play a note. `time` is AudioContext time (default: now); `duration` in seconds
   * (default: until the returned stop function is called).
   */
  play(midi: MidiNote, velocity: number, time?: number, duration?: number): () => void;
  /** Silence everything, including notes scheduled for later. */
  stopAll(): void;
}
