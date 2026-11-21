import type { MidiNote } from '../midi/types';
import type { HandSelection, Score, ScoreNote } from '../score/types';

export interface ExpectedStep {
  scoreStepIndex: number;
  /** Sorted, unique. The selected hand(s), excluding tie continuations and grace notes. */
  required: MidiNote[];
  /** Accepted without complaint, never required. */
  optional: MidiNote[];
}

const inHands = (n: ScoreNote, hands: HandSelection) => hands === 'both' || n.hand === hands;
const sortedUnique = (xs: Iterable<MidiNote>) => [...new Set(xs)].sort((a, b) => a - b);

/**
 * Turns a score into the steps wait mode walks through for the chosen hand(s).
 *
 * - Steps with nothing required (rests, tie continuations, other hand only) are dropped.
 * - Optional: grace notes and tie continuations at the stop, plus — when practising one
 *   hand — the other hand's notes from the previous expected step's stop through this one.
 *   The other hand's note may arrive slightly after the selected hand completed a step,
 *   so it must still be harmless on the next step.
 */
export function buildExpectedSteps(score: Score, hands: HandSelection): ExpectedStep[] {
  const result: ExpectedStep[] = [];
  let previousStop = 0;

  for (const step of score.steps) {
    const mine = step.notes.filter((n) => inHands(n, hands));
    const required = sortedUnique(
      mine.filter((n) => !n.tiedFromPrevious && !n.grace).map((n) => n.midi),
    );
    if (required.length === 0) continue;

    const optional = new Set<MidiNote>(
      step.notes.filter((n) => n.grace || n.tiedFromPrevious).map((n) => n.midi),
    );
    if (hands !== 'both') {
      for (const other of score.steps.slice(previousStop, step.index + 1)) {
        for (const n of other.notes) if (!inHands(n, hands)) optional.add(n.midi);
      }
    }
    for (const r of required) optional.delete(r);

    result.push({ scoreStepIndex: step.index, required, optional: sortedUnique(optional) });
    previousStop = step.index;
  }
  return result;
}
