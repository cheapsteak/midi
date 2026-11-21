import type { MidiNote } from '../midi/types';
import type { Score, ScoreNote, ScoreStep } from '../score/types';

/** Seconds from the start of playback. */
export interface TimelineNote {
  midi: MidiNote;
  start: number;
  duration: number;
  velocity: number;
}

export interface TimelineStep {
  scoreStepIndex: number;
  time: number;
}

export interface Timeline {
  notes: TimelineNote[];
  steps: TimelineStep[];
  /** When the last note has finished sounding. */
  end: number;
}

export interface TimelineOptions {
  /** Score step to start from (inclusive). */
  fromStep?: number;
  /** 1 = as written, 0.5 = half speed. */
  speed?: number;
  /** Used until the score gives a tempo. Quarter notes per minute. */
  defaultBpm?: number;
}

const GRACE_SECONDS = 0.07;
const EPSILON = 1e-6;
const VELOCITY = { right: 84, left: 64 } as const;

/** Quarter-note BPM → seconds per whole note. */
const wholeNoteSeconds = (bpm: number) => 240 / bpm;

/**
 * Turns a score into timed notes for "Listen". Pure, so it is unit-tested like wait mode.
 * - Tempo changes are followed step by step (OSMD's bpm at each stop).
 * - Tied notes sound once, for the length of the whole tie chain.
 * - Grace notes are played just before their main note.
 * - The melody (right hand) is a little louder than the accompaniment.
 */
export function buildTimeline(score: Score, options: TimelineOptions = {}): Timeline {
  const speed = options.speed && options.speed > 0 ? options.speed : 1;
  const fromStep = Math.max(0, Math.min(options.fromStep ?? 0, score.steps.length));
  const steps = score.steps.slice(fromStep);
  const notes: TimelineNote[] = [];
  const timelineSteps: TimelineStep[] = [];

  // Starting mid-song: carry over the tempo set before the start point.
  let bpm = options.defaultBpm ?? 90;
  for (const earlier of score.steps.slice(0, fromStep))
    if (earlier.bpm && earlier.bpm > 0) bpm = earlier.bpm;
  let time = 0;
  let end = 0;

  steps.forEach((step, i) => {
    const previous = steps[i - 1];
    if (previous) time += ((step.onset - previous.onset) * wholeNoteSeconds(bpm)) / speed;
    if (step.bpm && step.bpm > 0) bpm = step.bpm;
    timelineSteps.push({ scoreStepIndex: step.index, time });

    for (const note of step.notes) {
      // Starting in the middle of a tie: sound the rest of it rather than silence.
      if (note.tiedFromPrevious && i > 0) continue;
      if (note.grace) {
        const start = Math.max(0, time - GRACE_SECONDS / speed);
        notes.push({ midi: note.midi, start, duration: GRACE_SECONDS / speed, velocity: 70 });
        continue;
      }
      const wholeNotes = tiedLength(steps, i, note);
      const duration = (wholeNotes * wholeNoteSeconds(bpm)) / speed;
      notes.push({ midi: note.midi, start: time, duration, velocity: VELOCITY[note.hand] });
      end = Math.max(end, time + duration);
    }
  });

  notes.sort((a, b) => a.start - b.start);
  return { notes, steps: timelineSteps, end };
}

/** Length in whole notes of a note plus the tie continuations that follow it. */
function tiedLength(steps: readonly ScoreStep[], index: number, note: ScoreNote): number {
  let length = note.duration;
  let noteEnd = (steps[index]?.onset ?? 0) + note.duration;
  for (let j = index + 1; j < steps.length; j++) {
    const step = steps[j];
    if (!step) break;
    if (step.onset > noteEnd + EPSILON) break;
    if (step.onset < noteEnd - EPSILON) continue; // something else starts while we sound
    const next = step.notes.find(
      (n) => n.tiedFromPrevious && n.midi === note.midi && n.staff === note.staff,
    );
    if (!next) break;
    length += next.duration;
    noteEnd += next.duration;
  }
  return length;
}

/** Index of the last timeline step at or before `t` (seconds), or -1. */
export function stepAt(timeline: Timeline, t: number): number {
  let lo = 0;
  let hi = timeline.steps.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((timeline.steps[mid]?.time ?? Number.POSITIVE_INFINITY) <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
