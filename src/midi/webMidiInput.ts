import { BaseMidiInput } from './baseInput';
import { parseMidiMessage } from './parse';
import type { MidiDevice } from './types';

/** Web MIDI (Chrome, Edge, Firefox, Android Chrome). Requires a secure context. */
export class WebMidiInput extends BaseMidiInput {
  private access: MIDIAccess | null = null;

  async start(): Promise<void> {
    if (this.access || this.status.state === 'starting') return;
    if (typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) {
      this.setStatus({ state: 'unsupported', reason: 'This browser has no Web MIDI.' });
      return;
    }
    this.setStatus({ state: 'starting' });
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      const reason = err instanceof Error ? err.message : String(err);
      this.setStatus(
        name === 'SecurityError' || name === 'NotAllowedError'
          ? { state: 'denied', reason: 'MIDI permission was denied.' }
          : { state: 'error', reason },
      );
      return;
    }
    this.access.onstatechange = () => this.refresh();
    this.refresh();
    this.setStatus({ state: 'ready' });
  }

  async stop(): Promise<void> {
    if (this.access) {
      this.access.onstatechange = null;
      for (const input of this.access.inputs.values()) input.onmidimessage = null;
    }
    this.access = null;
    this.setDevices([]);
    this.setStatus({ state: 'idle' });
  }

  private refresh(): void {
    if (!this.access) return;
    const devices: MidiDevice[] = [];
    for (const input of this.access.inputs.values()) {
      if (input.state === 'disconnected') continue;
      // Assigning onmidimessage implicitly opens the port.
      if (input.onmidimessage !== this.handleMessage) input.onmidimessage = this.handleMessage;
      devices.push({ id: input.id, name: input.name || 'MIDI input', transport: 'webmidi' });
    }
    this.setDevices(devices);
  }

  private readonly handleMessage = (e: MIDIMessageEvent): void => {
    if (!e.data) return;
    const sourceId = (e.target as MIDIInput | null)?.id ?? '';
    // MIDIMessageEvent.timeStamp is already in the performance.now() time base.
    const event = parseMidiMessage(e.data, e.timeStamp, sourceId);
    if (event) this.emitEvent(event);
  };
}
