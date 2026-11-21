import { describe, expect, it } from 'vitest';
import type { MidiNote } from '../midi/types';
import type { ExpectedStep } from './expectedSteps';
import {
  DEFAULT_WAIT_MODE_CONFIG,
  initialState,
  reduce,
  type WaitModeConfig,
  type WaitModeEffect,
  type WaitModeInput,
  type WaitModeState,
} from './waitMode';

const step = (required: MidiNote[], optional: MidiNote[] = []): ExpectedStep => ({
  scoreStepIndex: 0,
  required,
  optional,
});

const on = (note: MidiNote, time: number): WaitModeInput => ({
  type: 'noteOn',
  note,
  velocity: 90,
  time,
  channel: 0,
  sourceId: 't',
});
const off = (note: MidiNote, time: number): WaitModeInput => ({
  type: 'noteOff',
  note,
  velocity: 0,
  time,
  channel: 0,
  sourceId: 't',
});

/** Runs a script of inputs from `start` and collects every effect. */
function run(
  steps: ExpectedStep[],
  inputs: WaitModeInput[],
  config: Partial<WaitModeConfig> = {},
): { state: WaitModeState; effects: WaitModeEffect[] } {
  const cfg = { ...DEFAULT_WAIT_MODE_CONFIG, ...config };
  let state = reduce(initialState(), { type: 'start' }, steps, cfg).state;
  const effects: WaitModeEffect[] = [];
  for (const input of inputs) {
    const r = reduce(state, input, steps, cfg);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}

const types = (effects: WaitModeEffect[]) => effects.map((e) => e.type);

describe('wait mode', () => {
  it('starts waiting, or finished when there is nothing to play', () => {
    expect(run([step([60])], []).state.status).toBe('waiting');
    expect(run([], []).state.status).toBe('finished');
  });

  it('advances on a single correct note and finishes after the last step', () => {
    const { state, effects } = run(
      [step([60]), step([62])],
      [on(60, 0), off(60, 100), on(62, 200)],
    );
    expect(types(effects)).toEqual([
      'noteMatched',
      'stepCompleted',
      'noteMatched',
      'stepCompleted',
      'finished',
    ]);
    expect(state).toMatchObject({ status: 'finished', stepIndex: 2 });
    expect(state.stats).toEqual({ stepsCompleted: 2, cleanSteps: 2, wrongNotes: 0 });
  });

  it('accepts a quick staccato chord inside the window', () => {
    const { state } = run(
      [step([60, 64, 67])],
      [on(60, 0), off(60, 40), on(64, 80), off(64, 120), on(67, 200)],
    );
    expect(state.status).toBe('finished');
  });

  it('does not build a chord from notes struck and released too far apart', () => {
    const { state } = run([step([60, 64])], [on(60, 0), off(60, 50), on(64, 400)]);
    expect(state).toMatchObject({ status: 'waiting', stepIndex: 0 });
    expect(state.matched.map((m) => m.target)).toEqual([64]);
  });

  it('allows hold-and-search: a held key stays matched indefinitely', () => {
    const { state } = run([step([60, 64])], [on(60, 0), on(64, 5000)]);
    expect(state.status).toBe('finished');
  });

  it('needs a fresh strike for a repeated note', () => {
    const steps = [step([60]), step([60])];
    const held = run(steps, [on(60, 0)]);
    expect(held.state.stepIndex).toBe(1); // holding the key does not complete step 2
    const restruck = run(steps, [on(60, 0), off(60, 100), on(60, 200)]);
    expect(restruck.state.status).toBe('finished');
  });

  it('treats a second noteOn without a noteOff as a new strike', () => {
    expect(run([step([60]), step([60])], [on(60, 0), on(60, 100)]).state.status).toBe('finished');
  });

  it('counts wrong notes but keeps progress by default', () => {
    const { state, effects } = run([step([60, 64])], [on(60, 0), on(61, 10), on(64, 20)]);
    expect(types(effects)).toEqual([
      'noteMatched',
      'wrongNote',
      'noteMatched',
      'stepCompleted',
      'finished',
    ]);
    expect(state.stats).toEqual({ stepsCompleted: 1, cleanSteps: 0, wrongNotes: 1 });
    const completed = effects.find((e) => e.type === 'stepCompleted');
    expect(completed).toMatchObject({ clean: false });
  });

  it('clears the partial chord on a wrong note when configured', () => {
    const { state } = run([step([60, 64])], [on(60, 0), on(61, 10), on(64, 20)], {
      clearOnWrongNote: true,
    });
    expect(state).toMatchObject({ status: 'waiting', stepIndex: 0 });
    expect(state.matched.map((m) => m.target)).toEqual([64]);
  });

  it('treats optional notes and re-strikes as neutral', () => {
    const { effects } = run([step([60, 64], [48])], [on(60, 0), on(48, 10), on(60, 20)]);
    expect(types(effects)).toEqual(['noteMatched']);
  });

  it('wrong-note counters reset per step', () => {
    const { state } = run([step([60]), step([62])], [on(61, 0), on(60, 10), on(62, 20)]);
    expect(state.stats).toEqual({ stepsCompleted: 2, cleanSteps: 1, wrongNotes: 1 });
  });

  it('octave-lenient mode matches pitch classes, one key per required note', () => {
    const lenient = { octaveStrict: false };
    expect(run([step([60])], [on(72, 0)], lenient).state.status).toBe('finished');
    // Octave doubling C3+C4 needs two different keys.
    const doubled = [step([48, 60])];
    expect(run(doubled, [on(72, 0)], lenient).state.status).toBe('waiting');
    expect(run(doubled, [on(72, 0), on(36, 10)], lenient).state.status).toBe('finished');
    // A wrong pitch class is still wrong.
    expect(types(run([step([60])], [on(61, 0)], lenient).effects)).toEqual(['wrongNote']);
  });

  it('octave-strict mode rejects the right pitch class in the wrong octave', () => {
    expect(types(run([step([60])], [on(72, 0)]).effects)).toEqual(['wrongNote']);
  });

  it('tracks held keys and the pedal, and clears them on allNotesOff', () => {
    let { state } = run([step([60, 64])], [on(60, 0), on(50, 5)]);
    expect(state.down).toEqual([60, 50]);
    const cfg = DEFAULT_WAIT_MODE_CONFIG;
    state = reduce(
      state,
      { type: 'sustain', down: true, value: 127, time: 6, channel: 0, sourceId: 't' },
      [],
      cfg,
    ).state;
    expect(state.sustain).toBe(true);
    state = reduce(state, { type: 'allNotesOff' }, [step([60, 64])], cfg).state;
    expect(state).toMatchObject({ down: [], matched: [] });
  });

  it('seek jumps to a step and clears the partial chord', () => {
    const steps = [step([60]), step([62]), step([64])];
    const cfg = DEFAULT_WAIT_MODE_CONFIG;
    let { state } = run(steps, [on(60, 0)]);
    state = reduce(state, { type: 'seek', stepIndex: 2 }, steps, cfg).state;
    expect(state).toMatchObject({ stepIndex: 2, status: 'waiting', matched: [] });
    state = reduce(state, on(64, 10), steps, cfg).state;
    expect(state.status).toBe('finished');
  });

  it('ignores notes before start and after finishing (but tracks keys)', () => {
    const steps = [step([60])];
    const cfg = DEFAULT_WAIT_MODE_CONFIG;
    const idle = reduce(initialState(), on(60, 0), steps, cfg);
    expect(idle.effects).toEqual([]);
    expect(idle.state.down).toEqual([60]);
    const { state } = run(steps, [on(60, 0), on(61, 10)]);
    expect(state.stats.wrongNotes).toBe(0);
  });
});
