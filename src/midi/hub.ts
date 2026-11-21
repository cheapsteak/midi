import { Emitter } from './emitter';
import type { MidiDevice, MidiInput, MidiInputEvent, MidiStatus, Unsubscribe } from './types';

/**
 * Merges several inputs into one. The optional `hardware` input (Web MIDI or the
 * native bridge) decides the reported status; the others (virtual, fake) are extras.
 */
export class MidiHub implements MidiInput {
  private readonly inputs: readonly MidiInput[];
  private readonly devicesChanged = new Emitter<readonly MidiDevice[]>();

  constructor(
    private readonly hardware: MidiInput | null,
    extras: readonly MidiInput[],
  ) {
    this.inputs = hardware ? [hardware, ...extras] : [...extras];
    for (const input of this.inputs) {
      input.onDevicesChanged(() => this.devicesChanged.emit(this.getDevices()));
    }
  }

  hasHardware(): boolean {
    return this.hardware !== null;
  }

  async start(): Promise<void> {
    await Promise.allSettled(this.inputs.map((i) => i.start()));
  }

  async stop(): Promise<void> {
    await Promise.allSettled(this.inputs.map((i) => i.stop()));
  }

  getStatus(): MidiStatus {
    return (
      this.hardware?.getStatus() ?? {
        state: 'unsupported',
        reason: 'No MIDI support here. Use Chrome or Edge, or the iPad app.',
      }
    );
  }

  getDevices(): readonly MidiDevice[] {
    return this.inputs.flatMap((i) => i.getDevices());
  }

  onEvent(cb: (e: MidiInputEvent) => void): Unsubscribe {
    const offs = this.inputs.map((i) => i.onEvent(cb));
    return () => {
      for (const off of offs) off();
    };
  }

  onDevicesChanged(cb: (devices: readonly MidiDevice[]) => void): Unsubscribe {
    return this.devicesChanged.on(cb);
  }

  onStatusChanged(cb: (status: MidiStatus) => void): Unsubscribe {
    return this.hardware?.onStatusChanged(cb) ?? (() => {});
  }
}
