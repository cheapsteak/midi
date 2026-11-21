import { Capacitor } from '@capacitor/core';
import { FakeMidiInput } from './fakeMidiInput';
import { MidiHub } from './hub';
import { NativeMidiInput } from './nativeMidiInput';
import type { MidiInput } from './types';
import { VirtualMidiInput } from './virtualMidiInput';
import { WebMidiInput } from './webMidiInput';

export interface MidiInputs {
  hub: MidiHub;
  hardware: MidiInput | null;
  virtual: VirtualMidiInput;
  fake: FakeMidiInput | null;
}

/**
 * iOS app → native Core MIDI bridge. Browsers with Web MIDI → Web MIDI.
 * Anything else (e.g. Safari) → virtual keyboard only.
 */
export function createMidiInputs(opts: { fake?: boolean } = {}): MidiInputs {
  let hardware: MidiInput | null = null;
  if (Capacitor.getPlatform() === 'ios') hardware = new NativeMidiInput();
  else if (typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator) {
    hardware = new WebMidiInput();
  }

  const virtual = new VirtualMidiInput();
  const fake = opts.fake ? new FakeMidiInput() : null;
  if (fake && typeof window !== 'undefined') window.__fakeMidi = fake;

  const extras: MidiInput[] = fake ? [virtual, fake] : [virtual];
  return { hub: new MidiHub(hardware, extras), hardware, virtual, fake };
}

/** Whether hardware MIDI can start without a gesture (no permission prompt would show). */
export async function canAutoStartHardware(): Promise<boolean> {
  if (Capacitor.getPlatform() === 'ios') return true;
  try {
    const result = await navigator.permissions.query({ name: 'midi' as PermissionName });
    return result.state === 'granted';
  } catch {
    return false;
  }
}
