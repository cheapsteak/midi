import { BaseMidiInput } from './baseInput';
import type { MidiNote } from './types';

/** Piano-style layout on the home row: A = C, W = C♯, S = D … K = the next C. */
const KEY_OFFSETS: Readonly<Record<string, number>> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
};

const MIN_BASE = 36; // C2, the LK-S245's lowest key
const MAX_BASE = 84; // C6, so K reaches C7 (the highest key)
const SOURCE_ID = 'virtual';

/**
 * Development input: the computer keyboard and the on-screen keyboard.
 * Lets the app be used and tested without a piano.
 */
export class VirtualMidiInput extends BaseMidiInput {
  private octaveBase: MidiNote = 60; // C4
  private readonly heldByCode = new Map<string, MidiNote>();
  private readonly held = new Set<MidiNote>();
  private listening = false;
  private readonly octaveListeners = new Set<(base: MidiNote) => void>();

  async start(): Promise<void> {
    if (this.listening) return;
    this.listening = true;
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
      window.addEventListener('blur', this.releaseAll);
    }
    this.setDevices([
      { id: SOURCE_ID, name: 'Computer keyboard / on-screen keys', transport: 'virtual' },
    ]);
    this.setStatus({ state: 'ready' });
  }

  async stop(): Promise<void> {
    if (!this.listening) return;
    this.listening = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('blur', this.releaseAll);
    }
    this.releaseAll();
    this.setDevices([]);
    this.setStatus({ state: 'idle' });
  }

  getOctaveBase(): MidiNote {
    return this.octaveBase;
  }

  onOctaveChanged(cb: (base: MidiNote) => void): () => void {
    this.octaveListeners.add(cb);
    return () => this.octaveListeners.delete(cb);
  }

  noteOn(note: MidiNote, velocity = 96): void {
    if (this.held.has(note)) this.noteOff(note);
    this.held.add(note);
    this.emitEvent({
      type: 'noteOn',
      note,
      velocity,
      time: performance.now(),
      channel: 0,
      sourceId: SOURCE_ID,
    });
  }

  noteOff(note: MidiNote): void {
    if (!this.held.delete(note)) return;
    this.emitEvent({
      type: 'noteOff',
      note,
      velocity: 0,
      time: performance.now(),
      channel: 0,
      sourceId: SOURCE_ID,
    });
  }

  readonly releaseAll = (): void => {
    for (const note of [...this.held]) this.noteOff(note);
    this.heldByCode.clear();
  };

  private shiftOctave(delta: number): void {
    const next = Math.min(MAX_BASE, Math.max(MIN_BASE, this.octaveBase + delta * 12));
    if (next === this.octaveBase) return;
    this.octaveBase = next;
    for (const cb of this.octaveListeners) cb(next);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTextInput(e.target)) return;
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      this.shiftOctave(e.code === 'KeyZ' ? -1 : 1);
      return;
    }
    const offset = KEY_OFFSETS[e.code];
    if (offset === undefined || this.heldByCode.has(e.code)) return;
    const note = this.octaveBase + offset;
    this.heldByCode.set(e.code, note);
    this.noteOn(note);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const note = this.heldByCode.get(e.code);
    if (note === undefined) return;
    this.heldByCode.delete(e.code);
    this.noteOff(note);
  };
}

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
