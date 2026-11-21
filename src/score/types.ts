import type { MidiNote } from '../midi/types';

export type Hand = 'right' | 'left';
export type HandSelection = Hand | 'both';

export interface ScoreNote {
  /** `${stepIndex}:${n}`, stable for a loaded score. */
  id: string;
  midi: MidiNote;
  hand: Hand;
  /** Global 0-based staff index. */
  staff: number;
  /** In whole notes (0.25 = quarter). */
  duration: number;
  /** Continuation of a tie: sounds, but is not struck again. */
  tiedFromPrevious: boolean;
  grace: boolean;
}

/** One cursor stop that starts at least one pitched note. */
export interface ScoreStep {
  index: number;
  /** Number of cursor advances from the start that reach this stop. */
  cursorIndex: number;
  measureIndex: number;
  /** Whole notes from the start, with repeats unrolled. */
  onset: number;
  /** Captured for play-along (M4); unused in wait mode. */
  bpm?: number;
  /** Every pitched note starting here, unfiltered. */
  notes: ScoreNote[];
}

export interface Score {
  title: string;
  staffCount: number;
  steps: ScoreStep[];
}

/** With exactly two staves, the top is the right hand; otherwise everything is "right". */
export function handForStaff(staff: number, staffCount: number): Hand {
  return staffCount === 2 && staff === 1 ? 'left' : 'right';
}
