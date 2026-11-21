import { Emitter } from './emitter';
import type { MidiDevice, MidiInput, MidiInputEvent, MidiStatus, Unsubscribe } from './types';

/** Shared plumbing for MidiInput implementations: emitters, status and device bookkeeping. */
export abstract class BaseMidiInput implements MidiInput {
  protected status: MidiStatus = { state: 'idle' };
  protected devices: readonly MidiDevice[] = [];
  private readonly events = new Emitter<MidiInputEvent>();
  private readonly devicesChanged = new Emitter<readonly MidiDevice[]>();
  private readonly statusChanged = new Emitter<MidiStatus>();

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;

  getStatus(): MidiStatus {
    return this.status;
  }

  getDevices(): readonly MidiDevice[] {
    return this.devices;
  }

  onEvent(cb: (e: MidiInputEvent) => void): Unsubscribe {
    return this.events.on(cb);
  }

  onDevicesChanged(cb: (devices: readonly MidiDevice[]) => void): Unsubscribe {
    return this.devicesChanged.on(cb);
  }

  onStatusChanged(cb: (status: MidiStatus) => void): Unsubscribe {
    return this.statusChanged.on(cb);
  }

  protected emitEvent(e: MidiInputEvent): void {
    this.events.emit(e);
  }

  protected setStatus(status: MidiStatus): void {
    this.status = status;
    this.statusChanged.emit(status);
  }

  protected setDevices(devices: readonly MidiDevice[]): void {
    const same =
      devices.length === this.devices.length &&
      devices.every((d, i) => d.id === this.devices[i]?.id && d.name === this.devices[i]?.name);
    if (same) return;
    this.devices = devices;
    this.devicesChanged.emit(devices);
  }
}
