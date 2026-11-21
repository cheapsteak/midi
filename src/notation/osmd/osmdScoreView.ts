import type { Note, OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { Score } from '../../score/types';
import type { NoteVisual, ScoreView } from '../scoreView';
import { extractScore } from './extractScore';
import { loadOsmd } from './loadOsmd';

const COLORS: Record<NoteVisual, string> = {
  default: '#000000',
  correct: '#16a34a',
  flawed: '#d97706',
};

interface NoteheadNote {
  getNoteheadSVGs(): SVGElement[];
  vfnoteIndex: number;
}

/**
 * Sheet music via OpenSheetMusicDisplay. Renders once per song and per width; during play
 * only the cursor moves and noteheads change colour (attribute writes, well under 1 ms).
 */
export class OsmdScoreView implements ScoreView {
  private osmd: OpenSheetMusicDisplay | null = null;
  private score: Score | null = null;
  private osmdNotes = new Map<string, Note>();
  private readonly visuals = new Map<string, NoteVisual>();
  private cursorIndex = 0; // where the OSMD cursor currently is
  private activeStep: number | null = null;
  private lastCursorTop = -1;
  private generation = 0;

  constructor(private readonly container: HTMLElement) {}

  async load(musicXml: string): Promise<Score> {
    const generation = ++this.generation;
    const lib = await loadOsmd();
    if (generation !== this.generation) throw new Error('Superseded by a newer load');
    this.teardown();
    const osmd = new lib.OpenSheetMusicDisplay(this.container, {
      backend: 'svg',
      autoResize: false, // we relayout ourselves, debounced
      followCursor: false, // we scroll ourselves, only on a new system
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawCredits: false,
      drawPartNames: false,
      cursorsOptions: [{ type: 0, color: '#38bdf8', alpha: 0.35, follow: false }],
    });
    await osmd.load(musicXml);
    if (generation !== this.generation) {
      osmd.destroy();
      throw new Error('Superseded by a newer load');
    }
    const extracted = extractScore(lib, osmd);
    this.osmd = osmd;
    this.score = extracted.score;
    this.osmdNotes = extracted.osmdNotes;
    this.visuals.clear();
    this.applyZoom();
    osmd.render();
    this.cursorIndex = 0;
    this.activeStep = null;
    return extracted.score;
  }

  setActiveStep(scoreStepIndex: number | null, force = false): void {
    // Called after every MIDI event; only move when the step actually changed.
    if (scoreStepIndex === this.activeStep && !force) return;
    this.activeStep = scoreStepIndex;
    const cursor = this.osmd?.cursor;
    if (!cursor || !this.score) return;
    const step = scoreStepIndex === null ? undefined : this.score.steps[scoreStepIndex];
    if (!step) {
      cursor.hide();
      return;
    }
    if (step.cursorIndex < this.cursorIndex) {
      cursor.reset();
      this.cursorIndex = 0;
    }
    for (; this.cursorIndex < step.cursorIndex; this.cursorIndex++) {
      cursor.Iterator.moveToNextVisibleVoiceEntry(false);
    }
    cursor.show();
    cursor.update();
    this.scrollToCursor();
  }

  paintNotes(noteIds: readonly string[], visual: NoteVisual): void {
    for (const id of noteIds) {
      if (visual === 'default') this.visuals.delete(id);
      else this.visuals.set(id, visual);
      this.paint(id, visual);
    }
  }

  resetPaint(): void {
    const ids = [...this.visuals.keys()];
    this.visuals.clear();
    for (const id of ids) this.paint(id, 'default');
  }

  relayout(): void {
    const osmd = this.osmd;
    if (!osmd) return;
    this.applyZoom();
    osmd.render(); // drops our colours and resets the cursor
    for (const [id, visual] of this.visuals) this.paint(id, visual);
    this.cursorIndex = 0;
    this.lastCursorTop = -1;
    osmd.cursor?.reset();
    this.setActiveStep(this.activeStep, true);
  }

  dispose(): void {
    this.generation++; // cancels a load in flight
    this.teardown();
  }

  private teardown(): void {
    this.osmd?.destroy();
    this.osmd = null;
    this.score = null;
    this.osmdNotes.clear();
    this.visuals.clear();
    this.container.innerHTML = '';
  }

  /** Bigger notation on bigger screens: readable from the piano bench on an iPad. */
  private applyZoom(): void {
    if (!this.osmd) return;
    const width = this.container.clientWidth || 1000;
    this.osmd.Zoom = Math.min(1.6, Math.max(0.8, width / 850));
  }

  /** Colour one notehead. setColor() on a GraphicalNote would tint the whole chord. */
  private paint(id: string, visual: NoteVisual): void {
    const note = this.osmdNotes.get(id);
    if (!note || !this.osmd) return;
    // Resolve at paint time: graphical notes are recreated by every render().
    const g = this.osmd.EngravingRules.GNote(note) as unknown as NoteheadNote | undefined;
    const head = g?.getNoteheadSVGs()[g.vfnoteIndex];
    head?.setAttribute('fill', COLORS[visual]);
  }

  private scrollToCursor(): void {
    const el = this.osmd?.cursor?.cursorElement;
    if (!el) return;
    const top = el.offsetTop;
    if (top === this.lastCursorTop) return;
    this.lastCursorTop = top;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}
