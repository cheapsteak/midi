import { describe, expect, it } from 'vitest';
import { createClockMapper } from './clock';
import { noteName } from './noteName';
import { parseMidiMessage } from './parse';

describe('parseMidiMessage', () => {
  const parse = (bytes: number[]) => parseMidiMessage(bytes, 1000, 'src');

  it('parses note on with channel', () => {
    expect(parse([0x93, 60, 100])).toEqual({
      type: 'noteOn',
      note: 60,
      velocity: 100,
      time: 1000,
      channel: 3,
      sourceId: 'src',
    });
  });

  it('treats note on with velocity 0 as note off', () => {
    expect(parse([0x90, 60, 0])).toMatchObject({ type: 'noteOff', note: 60, velocity: 0 });
  });

  it('parses note off', () => {
    expect(parse([0x80, 64, 40])).toMatchObject({ type: 'noteOff', note: 64, velocity: 40 });
  });

  it('parses the sustain pedal (CC64)', () => {
    expect(parse([0xb0, 64, 127])).toMatchObject({ type: 'sustain', down: true, value: 127 });
    expect(parse([0xb0, 64, 63])).toMatchObject({ type: 'sustain', down: false, value: 63 });
  });

  it('ignores other controllers, system messages and short input', () => {
    expect(parse([0xb0, 7, 100])).toBeNull(); // volume
    expect(parse([0xf8, 0, 0])).toBeNull(); // clock
    expect(parse([0xfe])).toBeNull(); // active sensing
    expect(parse([0xf0, 0x7e, 0xf7])).toBeNull(); // SysEx
    expect(parse([0x90, 60])).toBeNull();
    expect(parse([60, 100, 0])).toBeNull(); // data byte without status
    expect(parse([0xc0, 5, 0])).toBeNull(); // program change
  });

  it('masks data bytes to 7 bits', () => {
    expect(parse([0x90, 0xbc, 0xe4])).toMatchObject({ note: 60, velocity: 100 });
  });

  it('accepts typed arrays', () => {
    expect(parseMidiMessage(new Uint8Array([0x90, 61, 1]), 0, '')).toMatchObject({
      type: 'noteOn',
      note: 61,
    });
  });
});

describe('createClockMapper', () => {
  it('keeps the smallest arrival − native offset', () => {
    const clock = createClockMapper();
    expect(clock.toPerf(100, 1105)).toBe(1105); // offset 1005
    expect(clock.toPerf(200, 1203)).toBe(1203); // offset 1003 (faster), adopted
    expect(clock.toPerf(300, 1320)).toBe(1303); // slow arrival: jitter removed
  });

  it('forgets the offset on reset', () => {
    const clock = createClockMapper();
    clock.toPerf(100, 1100);
    clock.reset();
    expect(clock.toPerf(100, 5100)).toBe(5100);
  });
});

describe('noteName', () => {
  it('names notes with scientific pitch', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(36)).toBe('C2');
    expect(noteName(61)).toBe('C♯4');
    expect(noteName(96)).toBe('C7');
  });
});
