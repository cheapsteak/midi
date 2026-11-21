import type { MidiInputEvent, Ms } from './types';

/**
 * The one MIDI 1.0 byte parser, shared by Web MIDI and the native iOS bridge.
 * Expects exactly one channel message. Returns null for anything we don't use
 * (clock, active sensing, SysEx, other controllers, short or garbled input).
 */
export function parseMidiMessage(
  bytes: ArrayLike<number>,
  time: Ms,
  sourceId: string,
): MidiInputEvent | null {
  if (bytes.length < 3) return null;
  const status = bytes[0] ?? 0;
  if (status < 0x80 || status >= 0xf0) return null;

  const kind = status & 0xf0;
  const channel = status & 0x0f;
  const data1 = (bytes[1] ?? 0) & 0x7f;
  const data2 = (bytes[2] ?? 0) & 0x7f;

  switch (kind) {
    case 0x90:
      return data2 > 0
        ? { type: 'noteOn', note: data1, velocity: data2, time, channel, sourceId }
        : { type: 'noteOff', note: data1, velocity: 0, time, channel, sourceId };
    case 0x80:
      return { type: 'noteOff', note: data1, velocity: data2, time, channel, sourceId };
    case 0xb0:
      if (data1 !== 64) return null;
      return { type: 'sustain', down: data2 >= 64, value: data2, time, channel, sourceId };
    default:
      return null;
  }
}
