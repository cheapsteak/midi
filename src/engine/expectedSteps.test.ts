import { describe, expect, it } from 'vitest';
import { buildExpectedSteps } from './expectedSteps';
import { L, makeScore } from './testUtils';

describe('buildExpectedSteps', () => {
  const score = makeScore([
    [64, L(48), L(52)], // 0: RH E4 + LH C3/E3
    [64], // 1: RH only
    [L(48, { tied: true })], // 2: LH tie continuation only
    [{ midi: 62, grace: true }, 60], // 3: grace D4 before C4
    [L(43)], // 4: LH only
    [64, 67], // 5: RH dyad
  ]);

  it('both hands: requires every struck note, drops tie-only steps', () => {
    const steps = buildExpectedSteps(score, 'both');
    expect(steps.map((s) => s.scoreStepIndex)).toEqual([0, 1, 3, 4, 5]);
    expect(steps[0]?.required).toEqual([48, 52, 64]);
    expect(steps[2]).toMatchObject({ required: [60], optional: [62] });
  });

  it('never requires tie continuations or grace notes, but accepts them', () => {
    const tieAndGrace = makeScore([
      [60],
      [{ midi: 60, tied: true }, 64],
      [{ midi: 59, grace: true }, 60],
    ]);
    const steps = buildExpectedSteps(tieAndGrace, 'both');
    expect(steps[1]).toMatchObject({ required: [64], optional: [60] });
    expect(steps[2]).toMatchObject({ required: [60], optional: [59] });
  });

  it('right hand: drops left-only steps and makes nearby left notes optional', () => {
    const steps = buildExpectedSteps(score, 'right');
    expect(steps.map((s) => s.scoreStepIndex)).toEqual([0, 1, 3, 5]);
    expect(steps[0]).toMatchObject({ required: [64], optional: [48, 52] });
    // The step after keeps the previous stop's left notes optional (late other-hand notes).
    expect(steps[1]).toMatchObject({ required: [64], optional: [48, 52] });
    // Step 5 spans stops 3..5, which includes the left-hand G2 at stop 4.
    expect(steps[3]).toMatchObject({ required: [64, 67], optional: [43] });
  });

  it('left hand: only left notes are required', () => {
    const steps = buildExpectedSteps(score, 'left');
    expect(steps.map((s) => s.scoreStepIndex)).toEqual([0, 4]);
    expect(steps[0]).toMatchObject({ required: [48, 52], optional: [64] });
    // Right-hand notes from stops 0..4 are optional; the left tie at stop 2 is not this stop's.
    expect(steps[1]?.optional).toEqual([60, 62, 64]);
  });

  it('does not list a pitch as optional when it is required', () => {
    const shared = makeScore([[60, L(60)]]);
    expect(buildExpectedSteps(shared, 'right')[0]).toMatchObject({ required: [60], optional: [] });
  });
});
