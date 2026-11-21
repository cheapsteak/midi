import { type PluginListenerHandle, registerPlugin } from '@capacitor/core';

/** One Core MIDI packet: every MIDI 1.0 message in it, plus a native monotonic timestamp. */
export interface NativeMidiMessages {
  /** Milliseconds from mach_absolute_time (host clock), not performance.now(). */
  t: number;
  sourceId: string;
  messages: number[][];
}

export interface NativeMidiDevices {
  inputs: { id: string; name: string }[];
  outputs: { id: string; name: string }[];
}

/** JS face of native/midi-bridge (MidiBridgePlugin.swift). iOS only. */
export interface MidiBridgePlugin {
  start(): Promise<NativeMidiDevices>;
  getDevices(): Promise<NativeMidiDevices>;
  /** MIDI out for key lights; not implemented natively until M6. */
  send(options: { data: number[]; deviceId?: string }): Promise<void>;
  setKeepAwake(options: { enabled: boolean }): Promise<void>;
  /** Audio session category .playback, so sound ignores the silent switch. */
  setAudioPlayback(): Promise<void>;
  addListener(
    event: 'midiMessage',
    cb: (e: NativeMidiMessages) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'devicesChanged',
    cb: (e: NativeMidiDevices) => void,
  ): Promise<PluginListenerHandle>;
}

export const MidiBridge = registerPlugin<MidiBridgePlugin>('MidiBridge');
