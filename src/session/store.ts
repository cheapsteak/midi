import { createStore } from 'zustand/vanilla';
import type { SoundState } from '../audio/audioEngine';
import { initialState, type WaitModeState } from '../engine/waitMode';
import type { MidiDevice, MidiNote, MidiStatus } from '../midi/types';
import type { HandSelection } from '../score/types';
import type { SongEntry } from '../songs/catalog';

export interface MonitorEntry {
  id: number;
  label: string;
  detail: string;
  source: string;
  /** performance.now() at delivery − event timestamp. */
  latencyMs: number;
}

export interface AppState {
  midiStatus: MidiStatus;
  hasHardware: boolean;
  devices: readonly MidiDevice[];
  monitor: readonly MonitorEntry[];
  octaveBase: MidiNote;

  songs: readonly SongEntry[];
  currentSongId: string | null;
  songTitle: string;
  loading: boolean;
  loadError: string | null;
  handsAvailable: boolean;
  hands: HandSelection;
  totalSteps: number;

  /** "Listen": playing the song back. */
  listening: boolean;
  listenPending: boolean;
  /** Keys sounding at the cursor during Listen (shown on the keyboard). */
  listenKeys: readonly MidiNote[];
  speed: number;
  sound: SoundState;
  /** Play a piano sound for the on-screen / computer keyboard. */
  keySound: boolean;

  wait: WaitModeState;
  /** Notes the current step wants (keyboard hints). */
  currentRequired: readonly MidiNote[];
  lastWrong: { note: MidiNote; seq: number } | null;
}

export const MONITOR_SIZE = 20;

export function createAppStore() {
  return createStore<AppState>()(() => ({
    midiStatus: { state: 'idle' },
    hasHardware: false,
    devices: [],
    monitor: [],
    octaveBase: 60,
    songs: [],
    currentSongId: null,
    songTitle: '',
    loading: true,
    loadError: null,
    handsAvailable: false,
    hands: 'both',
    totalSteps: 0,
    listening: false,
    listenPending: false,
    listenKeys: [],
    speed: 1,
    sound: { state: 'off' },
    keySound: false,
    wait: initialState(),
    currentRequired: [],
    lastWrong: null,
  }));
}

export type AppStore = ReturnType<typeof createAppStore>;
