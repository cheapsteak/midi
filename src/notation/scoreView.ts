import type { Score } from '../score/types';

export type NoteVisual = 'default' | 'correct' | 'flawed';

/**
 * What the practice session needs from a notation renderer. The OSMD sheet-music view
 * implements it; a falling-notes view (M5) can implement it from `Score` alone.
 */
export interface ScoreView {
  load(musicXml: string): Promise<Score>;
  /** Move the cursor to a score step; null hides it. */
  setActiveStep(scoreStepIndex: number | null): void;
  paintNotes(noteIds: readonly string[], visual: NoteVisual): void;
  /** Return every note to the default colour. */
  resetPaint(): void;
  /** Re-render for a new width (rotation, resize). Keeps cursor and colours. */
  relayout(): void;
  dispose(): void;
}
