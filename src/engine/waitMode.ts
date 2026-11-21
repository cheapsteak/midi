import type { MidiInputEvent, MidiNote, Ms } from '../midi/types';
import type { ExpectedStep } from './expectedSteps';

export interface WaitModeConfig {
  /** A released key still counts toward a chord for this long after it was struck. */
  chordWindowMs: number;
  /** false: match by pitch class (any octave), one key per required note. */
  octaveStrict: boolean;
  /** true: a wrong note also throws away the partial chord. */
  clearOnWrongNote: boolean;
}

export const DEFAULT_WAIT_MODE_CONFIG: WaitModeConfig = {
  chordWindowMs: 250,
  octaveStrict: true,
  clearOnWrongNote: false,
};

export interface Match {
  target: MidiNote;
  key: MidiNote;
  at: Ms;
}

export interface WaitModeState {
  status: 'idle' | 'waiting' | 'finished';
  stepIndex: number;
  matched: Match[];
  /** Keys physically held right now (drives the on-screen keyboard). */
  down: MidiNote[];
  /** Tracked, not used for matching in v1. */
  sustain: boolean;
  wrongInStep: number;
  stats: { stepsCompleted: number; cleanSteps: number; wrongNotes: number };
}

export type WaitModeInput =
  | MidiInputEvent
  | { type: 'start' }
  | { type: 'seek'; stepIndex: number }
  | { type: 'allNotesOff' };

export type WaitModeEffect =
  | { type: 'noteMatched'; stepIndex: number; note: MidiNote }
  | { type: 'wrongNote'; stepIndex: number; note: MidiNote; time: Ms }
  | { type: 'stepCompleted'; stepIndex: number; clean: boolean; time: Ms }
  | { type: 'finished'; time: Ms };

export interface WaitModeResult {
  state: WaitModeState;
  effects: WaitModeEffect[];
}

export function initialState(): WaitModeState {
  return {
    status: 'idle',
    stepIndex: 0,
    matched: [],
    down: [],
    sustain: false,
    wrongInStep: 0,
    stats: { stepsCompleted: 0, cleanSteps: 0, wrongNotes: 0 },
  };
}

const pitchClass = (n: MidiNote) => ((n % 12) + 12) % 12;

/**
 * Pure wait-mode reducer. No clocks or timers: time only comes from events, and every
 * decision is made on a noteOn. Rules:
 *  1. Fresh strikes only: a required pitch is matched by a noteOn received while its step
 *     is current. Keys held over from the previous step never count.
 *  2. A match survives while its key is held, or for chordWindowMs after it was struck.
 *  3. When every required pitch is matched the step completes and the next one starts.
 *  4. A noteOn that is neither required nor optional is a wrong note (lenient by default).
 *  5. Optional pitches and re-strikes of matched keys are neutral.
 */
export function reduce(
  state: WaitModeState,
  input: WaitModeInput,
  steps: readonly ExpectedStep[],
  config: WaitModeConfig,
): WaitModeResult {
  switch (input.type) {
    case 'start':
      return {
        state: {
          ...initialState(),
          down: state.down,
          sustain: state.sustain,
          status: steps.length > 0 ? 'waiting' : 'finished',
        },
        effects: [],
      };

    case 'seek': {
      const stepIndex = Math.max(0, Math.min(input.stepIndex, steps.length));
      return {
        state: {
          ...state,
          status: stepIndex < steps.length ? 'waiting' : 'finished',
          stepIndex,
          matched: [],
          wrongInStep: 0,
        },
        effects: [],
      };
    }

    case 'allNotesOff':
      return { state: { ...state, down: [], matched: [] }, effects: [] };

    case 'sustain':
      return { state: { ...state, sustain: input.down }, effects: [] };

    case 'noteOff':
      return {
        state: { ...state, down: state.down.filter((n) => n !== input.note) },
        effects: [],
      };

    case 'noteOn':
      return onNoteOn(state, input.note, input.time, steps, config);
  }
}

function onNoteOn(
  prev: WaitModeState,
  note: MidiNote,
  time: Ms,
  steps: readonly ExpectedStep[],
  config: WaitModeConfig,
): WaitModeResult {
  const down = prev.down.includes(note) ? prev.down : [...prev.down, note];
  const step = steps[prev.stepIndex];
  if (prev.status !== 'waiting' || !step) return { state: { ...prev, down }, effects: [] };

  const effects: WaitModeEffect[] = [];
  const stepIndex = prev.stepIndex;

  // Rule 2: prune matches whose key was released more than the chord window ago.
  let matched = prev.matched.filter(
    (m) => down.includes(m.key) || time - m.at <= config.chordWindowMs,
  );

  const sameKey = matched.find((m) => m.key === note);
  if (sameKey) {
    // Rule 5: re-strike of a matched key refreshes it.
    matched = matched.map((m) => (m === sameKey ? { ...m, at: time } : m));
  } else {
    const target = findTarget(note, step, matched, config);
    if (target !== null) {
      matched = [...matched, { target, key: note, at: time }];
      effects.push({ type: 'noteMatched', stepIndex, note: target });
    } else if (!isNeutral(note, step, config)) {
      // Rule 4.
      effects.push({ type: 'wrongNote', stepIndex, note, time });
      const state: WaitModeState = {
        ...prev,
        down,
        matched: config.clearOnWrongNote ? [] : matched,
        wrongInStep: prev.wrongInStep + 1,
        stats: { ...prev.stats, wrongNotes: prev.stats.wrongNotes + 1 },
      };
      return { state, effects };
    }
  }

  // Rule 3.
  const complete = step.required.every((r) => matched.some((m) => m.target === r));
  if (!complete) return { state: { ...prev, down, matched }, effects };

  const clean = prev.wrongInStep === 0;
  effects.push({ type: 'stepCompleted', stepIndex, clean, time });
  const nextIndex = stepIndex + 1;
  const finished = nextIndex >= steps.length;
  if (finished) effects.push({ type: 'finished', time });
  return {
    state: {
      ...prev,
      status: finished ? 'finished' : 'waiting',
      stepIndex: nextIndex,
      matched: [],
      down,
      wrongInStep: 0,
      stats: {
        ...prev.stats,
        stepsCompleted: prev.stats.stepsCompleted + 1,
        cleanSteps: prev.stats.cleanSteps + (clean ? 1 : 0),
      },
    },
    effects,
  };
}

/** The required pitch this key satisfies, or null. */
function findTarget(
  note: MidiNote,
  step: ExpectedStep,
  matched: readonly Match[],
  config: WaitModeConfig,
): MidiNote | null {
  const unmatched = step.required.filter((r) => !matched.some((m) => m.target === r));
  if (unmatched.includes(note)) return note;
  if (config.octaveStrict) return null;
  // Octave-lenient: nearest unmatched required note with the same pitch class.
  const candidates = unmatched.filter((r) => pitchClass(r) === pitchClass(note));
  if (candidates.length === 0) return null;
  return candidates.reduce((best, r) => (Math.abs(r - note) < Math.abs(best - note) ? r : best));
}

function isNeutral(note: MidiNote, step: ExpectedStep, config: WaitModeConfig): boolean {
  const pool = [...step.required, ...step.optional];
  if (config.octaveStrict) return pool.includes(note);
  return pool.some((p) => pitchClass(p) === pitchClass(note));
}
