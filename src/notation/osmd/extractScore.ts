import type { Note, OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { handForStaff, type Score, type ScoreNote, type ScoreStep } from '../../score/types';
import type { OsmdLib } from './loadOsmd';

export interface ExtractedScore {
  score: Score;
  /** noteId → OSMD note, for painting. Private to the OSMD adapter. */
  osmdNotes: Map<string, Note>;
}

/** Safety net against a malformed score looping the iterator forever. */
const MAX_STOPS = 200_000;

/**
 * Walks the loaded sheet exactly like `cursor.next()` does (repeats unrolled) and records
 * every stop that starts a pitched note. Needs `osmd.load()` only, not `render()`.
 */
export function extractScore(lib: OsmdLib, osmd: OpenSheetMusicDisplay): ExtractedScore {
  const sheet = osmd.Sheet;
  const staffCount = sheet.Staves.length;
  const steps: ScoreStep[] = [];
  const osmdNotes = new Map<string, Note>();

  const it = new lib.MusicPartManagerIterator(sheet);
  for (let cursorIndex = 0; !it.EndReached && cursorIndex < MAX_STOPS; cursorIndex++) {
    const stepIndex = steps.length;
    const notes: ScoreNote[] = [];
    for (const voiceEntry of it.CurrentVisibleVoiceEntries()) {
      for (const n of voiceEntry.Notes) {
        if (n.isRest() || n.IsCueNote) continue;
        const staff = n.ParentStaff.idInMusicSheet;
        const id = `${stepIndex}:${notes.length}`;
        notes.push({
          id,
          midi: n.halfTone + 12, // OSMD halfTone 48 = C4 = MIDI 60
          hand: handForStaff(staff, staffCount),
          staff,
          duration: n.Length.RealValue,
          tiedFromPrevious: n.NoteTie !== undefined && n.NoteTie.StartNote !== n,
          grace: n.IsGraceNote,
        });
        osmdNotes.set(id, n);
      }
    }
    if (notes.length > 0) {
      steps.push({
        index: stepIndex,
        cursorIndex,
        measureIndex: it.CurrentMeasureIndex,
        onset: it.CurrentEnrolledTimestamp.RealValue,
        bpm: it.CurrentBpm || undefined,
        notes,
      });
    }
    it.moveToNextVisibleVoiceEntry(false);
  }

  return {
    score: { title: sheet.TitleString || 'Untitled', staffCount, steps },
    osmdNotes,
  };
}
