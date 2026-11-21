import { describe, expect, it } from 'vitest';
import type { Score, ScoreNote, ScoreStep } from '../score/types';
import { buildTimeline, stepAt } from './timeline';

type N = Partial<ScoreNote> & { midi: number };

function score(steps: { onset: number; bpm?: number; notes: N[] }[]): Score {
  return {
    title: 't',
    staffCount: 2,
    steps: steps.map(
      (s, index): ScoreStep => ({
        index,
        cursorIndex: index,
        measureIndex: 0,
        onset: s.onset,
        bpm: s.bpm,
        notes: s.notes.map((n, k) => ({
          id: `${index}:${k}`,
          hand: 'right',
          staff: 0,
          duration: 0.25,
          tiedFromPrevious: false,
          grace: false,
          ...n,
        })),
      }),
    ),
  };
}

describe('buildTimeline', () => {
  it('converts whole-note onsets to seconds with the score tempo', () => {
    // 120 bpm: a quarter note is 0.5 s.
    const t = buildTimeline(
      score([
        { onset: 0, bpm: 120, notes: [{ midi: 60 }] },
        { onset: 0.25, notes: [{ midi: 62 }] },
        { onset: 0.75, notes: [{ midi: 64, duration: 0.5 }] }, // after a quarter rest
      ]),
    );
    expect(t.steps.map((s) => s.time)).toEqual([0, 0.5, 1.5]);
    expect(t.notes.map((n) => [n.midi, n.start, n.duration])).toEqual([
      [60, 0, 0.5],
      [62, 0.5, 0.5],
      [64, 1.5, 1],
    ]);
    expect(t.end).toBe(2.5);
  });

  it('follows tempo changes and scales by speed', () => {
    const t = buildTimeline(
      score([
        { onset: 0, bpm: 60, notes: [{ midi: 60 }] }, // quarter = 1 s
        { onset: 0.25, bpm: 120, notes: [{ midi: 62 }] }, // quarter = 0.5 s from here
        { onset: 0.5, notes: [{ midi: 64 }] },
      ]),
      { speed: 0.5 },
    );
    expect(t.steps.map((s) => s.time)).toEqual([0, 2, 3]);
  });

  it('starts from a given step', () => {
    const t = buildTimeline(
      score([
        { onset: 0, bpm: 120, notes: [{ midi: 60 }] },
        { onset: 0.25, notes: [{ midi: 62 }] },
        { onset: 0.5, notes: [{ midi: 64 }] },
      ]),
      { fromStep: 1 },
    );
    expect(t.steps).toEqual([
      { scoreStepIndex: 1, time: 0 },
      { scoreStepIndex: 2, time: 0.5 },
    ]);
    expect(t.notes.map((n) => n.midi)).toEqual([62, 64]);
  });

  it('sounds a tie chain once, for its full length', () => {
    const t = buildTimeline(
      score([
        { onset: 0, bpm: 120, notes: [{ midi: 66, duration: 0.75 }] },
        {
          onset: 0.75,
          notes: [{ midi: 66, duration: 0.75, tiedFromPrevious: true }, { midi: 50 }],
        },
        { onset: 1.5, notes: [{ midi: 66, duration: 0.75, tiedFromPrevious: true }] },
        { onset: 2.25, notes: [{ midi: 64 }] },
      ]),
    );
    const fSharp = t.notes.filter((n) => n.midi === 66);
    expect(fSharp).toHaveLength(1);
    expect(fSharp[0]?.duration).toBe(4.5); // 2.25 whole notes at 2 s per whole note
  });

  it('plays grace notes just before the main note, and the melody louder', () => {
    const t = buildTimeline(
      score([
        { onset: 0, bpm: 120, notes: [{ midi: 60 }] },
        {
          onset: 0.25,
          notes: [{ midi: 63, grace: true }, { midi: 64 }, { midi: 48, hand: 'left' }],
        },
      ]),
    );
    const grace = t.notes.find((n) => n.midi === 63);
    expect(grace?.start).toBeCloseTo(0.43);
    const melody = t.notes.find((n) => n.midi === 64);
    const bass = t.notes.find((n) => n.midi === 48);
    expect(melody?.velocity).toBeGreaterThan(bass?.velocity ?? 0);
  });

  it('uses the default tempo when the score has none', () => {
    const t = buildTimeline(
      score([
        { onset: 0, notes: [{ midi: 60 }] },
        { onset: 0.25, notes: [{ midi: 62 }] },
      ]),
      {
        defaultBpm: 60,
      },
    );
    expect(t.steps[1]?.time).toBe(1);
  });
});

describe('stepAt', () => {
  const t = buildTimeline(
    score([
      { onset: 0, bpm: 120, notes: [{ midi: 60 }] },
      { onset: 0.25, notes: [{ midi: 62 }] },
      { onset: 0.5, notes: [{ midi: 64 }] },
    ]),
  );
  it('finds the step sounding at a time', () => {
    expect(stepAt(t, -0.1)).toBe(-1);
    expect(stepAt(t, 0)).toBe(0);
    expect(stepAt(t, 0.49)).toBe(0);
    expect(stepAt(t, 0.5)).toBe(1);
    expect(stepAt(t, 10)).toBe(2);
  });
});

describe('starting mid-tie', () => {
  it('sounds the remainder of a tied note at the start point', () => {
    const t = buildTimeline(
      score([
        { onset: 0, bpm: 120, notes: [{ midi: 66, duration: 0.75 }] },
        { onset: 0.75, notes: [{ midi: 66, duration: 0.75, tiedFromPrevious: true }] },
        { onset: 1.5, notes: [{ midi: 64 }] },
      ]),
      { fromStep: 1 },
    );
    expect(t.notes.map((n) => [n.midi, n.start, n.duration])).toEqual([
      [66, 0, 1.5],
      [64, 1.5, 0.5],
    ]);
  });
});
