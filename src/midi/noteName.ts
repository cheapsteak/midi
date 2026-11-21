import type { MidiNote } from './types';

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'] as const;

/** 60 → "C4". */
export function noteName(note: MidiNote): string {
  const octave = Math.floor(note / 12) - 1;
  return `${NAMES[((note % 12) + 12) % 12]}${octave}`;
}

export function isBlackKey(note: MidiNote): boolean {
  const pc = ((note % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}
