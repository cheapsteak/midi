/** MIDI note number, 0–127. 60 = C4 (middle C). */
export type MidiNote = number;
/** Milliseconds in the `performance.now()` time base. */
export type Ms = number;

interface Base {
  time: Ms;
  channel: number;
  sourceId: string;
}

export type MidiInputEvent =
  | (Base & { type: 'noteOn'; note: MidiNote; velocity: number }) // velocity 1–127
  | (Base & { type: 'noteOff'; note: MidiNote; velocity: number })
  | (Base & { type: 'sustain'; down: boolean; value: number }); // CC64, down = value >= 64

export type MidiTransport = 'webmidi' | 'native' | 'virtual';

export interface MidiDevice {
  id: string;
  name: string;
  transport: MidiTransport;
}

export type MidiStatus =
  | { state: 'idle' | 'starting' | 'ready' }
  | { state: 'denied' | 'unsupported' | 'error'; reason: string };

export type Unsubscribe = () => void;

export interface MidiInput {
  /** Idempotent. On the web, call from a user gesture: it may show a permission prompt. */
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): MidiStatus;
  getDevices(): readonly MidiDevice[];
  onEvent(cb: (e: MidiInputEvent) => void): Unsubscribe;
  /** Fires on hot-plug (device added or removed). */
  onDevicesChanged(cb: (devices: readonly MidiDevice[]) => void): Unsubscribe;
  onStatusChanged(cb: (status: MidiStatus) => void): Unsubscribe;
}

/** Key lights arrive in M6; interface only for now. */
export interface MidiOutput {
  send(bytes: readonly number[], opts?: { deviceId?: string }): void;
}
