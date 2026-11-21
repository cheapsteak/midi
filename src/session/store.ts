import { createStore } from 'zustand/vanilla';
import { initialState, type WaitModeState } from '../engine/waitMode';
import type { MidiDevice, MidiNote, MidiStatus } from '../midi/types';
import type { HandSelection } from '../score/types';

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

  songTitle: string;
  loading: boolean;
  loadError: string | null;
  handsAvailable: boolean;
  hands: HandSelection;
  totalSteps: number;

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
    songTitle: '',
    loading: true,
    loadError: null,
    handsAvailable: false,
    hands: 'both',
    totalSteps: 0,
    wait: initialState(),
    currentRequired: [],
    lastWrong: null,
  }));
}

export type AppStore = ReturnType<typeof createAppStore>;
