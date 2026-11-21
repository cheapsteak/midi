import type { MidiNote } from '../midi/types';
import type { Hand, Score, ScoreNote, ScoreStep } from '../score/types';

type NoteSpec =
  | MidiNote
  | { midi: MidiNote; hand?: Hand; tied?: boolean; grace?: boolean; staff?: number };

/** Builds a Score from compact step specs. Plain numbers are right-hand notes. */
export function makeScore(steps: NoteSpec[][], staffCount = 2): Score {
  return {
    title: 'test',
    staffCount,
    steps: steps.map(
      (specs, index): ScoreStep => ({
        index,
        cursorIndex: index,
        measureIndex: 0,
        onset: index / 4,
        notes: specs.map((spec, n): ScoreNote => {
          const s = typeof spec === 'number' ? { midi: spec } : spec;
          const hand = s.hand ?? 'right';
          return {
            id: `${index}:${n}`,
            midi: s.midi,
            hand,
            staff: s.staff ?? (hand === 'left' ? 1 : 0),
            duration: 0.25,
            tiedFromPrevious: s.tied ?? false,
            grace: s.grace ?? false,
          };
        }),
      }),
    ),
  };
}

export const L = (midi: MidiNote, extra: { tied?: boolean } = {}) => ({
  midi,
  hand: 'left' as const,
  ...extra,
});
