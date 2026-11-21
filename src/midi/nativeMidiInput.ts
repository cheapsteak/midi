import { MidiBridge, type NativeMidiDevices, type NativeMidiMessages } from '../native/midiBridge';
import { BaseMidiInput } from './baseInput';
import { createClockMapper } from './clock';
import { parseMidiMessage } from './parse';

/** iPad: Core MIDI through the local Capacitor plugin in native/midi-bridge. */
export class NativeMidiInput extends BaseMidiInput {
  private readonly clock = createClockMapper();
  private listenersAdded = false;
  private running = false;

  async start(): Promise<void> {
    if (this.running || this.status.state === 'starting') return;
    this.setStatus({ state: 'starting' });
    try {
      // Listeners go on once, before start(), and are never removed: Capacitor's
      // listener table is not synchronised with the MIDI thread.
      if (!this.listenersAdded) {
        await MidiBridge.addListener('midiMessage', this.onMessages);
        await MidiBridge.addListener('devicesChanged', this.onDevices);
        this.listenersAdded = true;
        document.addEventListener('visibilitychange', this.onVisibility);
      }
      this.onDevices(await MidiBridge.start());
      this.running = true;
      this.setStatus({ state: 'ready' });
      // The iPad gets no touches while you play, so keep it from auto-locking.
      MidiBridge.setKeepAwake({ enabled: true }).catch(() => {});
    } catch (err) {
      this.setStatus({ state: 'error', reason: err instanceof Error ? err.message : String(err) });
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    MidiBridge.setKeepAwake({ enabled: false }).catch(() => {});
    this.setStatus({ state: 'idle' });
  }

  private readonly onMessages = (e: NativeMidiMessages): void => {
    if (!this.running) return;
    const time = this.clock.toPerf(e.t, performance.now());
    for (const bytes of e.messages) {
      const event = parseMidiMessage(bytes, time, e.sourceId);
      if (event) this.emitEvent(event);
    }
  };

  private readonly onDevices = (d: NativeMidiDevices): void => {
    this.setDevices(d.inputs.map((i) => ({ id: i.id, name: i.name, transport: 'native' })));
  };

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'visible') this.clock.reset();
  };
}
