// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildExpectedSteps } from '../../engine/expectedSteps';
import { DEFAULT_WAIT_MODE_CONFIG, initialState, reduce } from '../../engine/waitMode';
import type { Score } from '../../score/types';
import { installCanvasStub } from '../../test/canvasStub';
import { extractScore } from './extractScore';
import { loadOsmd } from './loadOsmd';

async function extract(path: string): Promise<Score> {
  const lib = await loadOsmd();
  const host = document.createElement('div');
  document.body.append(host);
  const osmd = new lib.OpenSheetMusicDisplay(host, { backend: 'svg', autoResize: false });
  await osmd.load(readFileSync(path, 'utf8'));
  return extractScore(lib, osmd).score;
}

const pitches = (score: Score) => score.steps.map((s) => s.notes.map((n) => n.midi));

beforeAll(() => installCanvasStub());

describe('extractScore', () => {
  it('reads the bundled Ode to Joy: two staves, hands, chords', async () => {
    const score = await extract('public/songs/ode-to-joy.musicxml');
    expect(score.title).toBe('Ode to Joy');
    expect(score.staffCount).toBe(2);
    const first = score.steps[0];
    expect(first?.notes.map((n) => [n.midi, n.hand])).toEqual(
      expect.arrayContaining([
        [64, 'right'],
        [48, 'left'],
        [52, 'left'],
      ]),
    );
    // 30 right-hand onsets; the left hand only adds onsets where the right hand has none.
    const rightOnsets = score.steps.filter((s) => s.notes.some((n) => n.hand === 'right'));
    expect(rightOnsets).toHaveLength(30);
    expect(
      score.steps
        .at(-1)
        ?.notes.map((n) => n.midi)
        .sort(),
    ).toEqual([48, 52, 60]);
  });

  it('marks ties and grace notes, skips rests, and unrolls repeats', async () => {
    const score = await extract('src/test/fixtures/tie-grace-repeat.musicxml');
    const once = [[60], [62, 64], [67], [67], [72]];
    expect(pitches(score).map((p) => p.sort((a, b) => a - b))).toEqual([...once, ...once]);
    const tied = score.steps[3]?.notes[0];
    expect(tied).toMatchObject({ midi: 67, tiedFromPrevious: true });
    expect(score.steps[1]?.notes.find((n) => n.midi === 62)?.grace).toBe(true);
    expect(score.steps[0]?.notes[0]?.hand).toBe('right'); // one staff: all right hand
  });

  it('plays through in wait mode for every hand selection', async () => {
    const score = await extract('public/songs/ode-to-joy.musicxml');
    for (const hands of ['both', 'right', 'left'] as const) {
      const steps = buildExpectedSteps(score, hands);
      let state = reduce(initialState(), { type: 'start' }, steps, DEFAULT_WAIT_MODE_CONFIG).state;
      let time = 0;
      for (const step of steps) {
        for (const note of step.required) {
          state = reduce(
            state,
            { type: 'noteOn', note, velocity: 80, time, channel: 0, sourceId: 't' },
            steps,
            DEFAULT_WAIT_MODE_CONFIG,
          ).state;
        }
        for (const note of step.required) {
          state = reduce(
            state,
            { type: 'noteOff', note, velocity: 0, time: time + 100, channel: 0, sourceId: 't' },
            steps,
            DEFAULT_WAIT_MODE_CONFIG,
          ).state;
        }
        time += 500;
      }
      expect(state.status, hands).toBe('finished');
      expect(state.stats.wrongNotes, hands).toBe(0);
      expect(state.stats.stepsCompleted, hands).toBe(steps.length);
    }
  });
});
