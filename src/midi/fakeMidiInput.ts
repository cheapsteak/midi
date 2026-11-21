import { BaseMidiInput } from './baseInput';
import { parseMidiMessage } from './parse';
import type { MidiNote } from './types';

const SOURCE_ID = 'fake';

/**
 * Test-only input, enabled with `?fakeMidi=1` and exposed as `window.__fakeMidi`.
 * The Playwright smoke test drives the app through it.
 */
export class FakeMidiInput extends BaseMidiInput {
  async start(): Promise<void> {
    this.setDevices([{ id: SOURCE_ID, name: 'Fake MIDI (test)', transport: 'virtual' }]);
    this.setStatus({ state: 'ready' });
  }

  async stop(): Promise<void> {
    this.setDevices([]);
    this.setStatus({ state: 'idle' });
  }

  /** Send raw MIDI bytes, e.g. [0x90, 60, 100]. Goes through the real parser. */
  sendBytes(bytes: readonly number[]): void {
    const event = parseMidiMessage(bytes, performance.now(), SOURCE_ID);
    if (event) this.emitEvent(event);
  }

  noteOn(note: MidiNote, velocity = 100): void {
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
    this.emitEvent({
      type: 'noteOff',
      note,
      velocity: 0,
      time: performance.now(),
      channel: 0,
      sourceId: SOURCE_ID,
    });
  }

  /** Strike all notes together, then release them. */
  chord(notes: readonly MidiNote[]): void {
    for (const n of notes) this.noteOn(n);
    for (const n of notes) this.noteOff(n);
  }
}

declare global {
  interface Window {
    __fakeMidi?: FakeMidiInput;
  }
}
