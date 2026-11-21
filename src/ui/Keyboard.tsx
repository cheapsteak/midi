import { useEffect, useMemo, useRef, useState } from 'react';
import { isBlackKey, noteName } from '../midi/noteName';
import type { MidiNote } from '../midi/types';
import { useAppState, useServices } from './context';

/** The LK-S245's 61 keys: C2–C7. */
const LOWEST = 36;
const HIGHEST = 96;
const COMPUTER_KEYS = ['A', 'W', 'S', 'E', 'D', 'F', 'T', 'G', 'Y', 'H', 'U', 'J', 'K'];

interface KeyLayout {
  note: MidiNote;
  black: boolean;
  leftPct: number;
}

function layoutKeys(): { keys: KeyLayout[]; whiteWidthPct: number } {
  const whites: MidiNote[] = [];
  for (let n = LOWEST; n <= HIGHEST; n++) if (!isBlackKey(n)) whites.push(n);
  const w = 100 / whites.length;
  const keys: KeyLayout[] = [];
  for (let n = LOWEST; n <= HIGHEST; n++) {
    if (isBlackKey(n)) {
      const leftWhite = whites.indexOf(n - 1);
      keys.push({ note: n, black: true, leftPct: (leftWhite + 1) * w - w * 0.3 });
    } else {
      keys.push({ note: n, black: false, leftPct: whites.indexOf(n) * w });
    }
  }
  return { keys, whiteWidthPct: w };
}

export function Keyboard() {
  const { midi } = useServices();
  const down = useAppState((s) => s.wait.down);
  const listening = useAppState((s) => s.listening);
  const listenKeys = useAppState((s) => s.listenKeys);
  const requiredKeys = useAppState((s) => s.currentRequired);
  const hints = listening ? listenKeys : requiredKeys;
  const lastWrong = useAppState((s) => s.lastWrong);
  const octaveBase = useAppState((s) => s.octaveBase);
  const { keys, whiteWidthPct } = useMemo(layoutKeys, []);
  const pointerNotes = useRef(new Map<number, MidiNote>());

  const [wrongNote, setWrongNote] = useState<MidiNote | null>(null);
  useEffect(() => {
    if (!lastWrong) return;
    setWrongNote(lastWrong.note);
    const t = setTimeout(() => setWrongNote(null), 350);
    return () => clearTimeout(t);
  }, [lastWrong]);

  const release = (pointerId: number) => {
    const note = pointerNotes.current.get(pointerId);
    if (note === undefined) return;
    pointerNotes.current.delete(pointerId);
    midi.virtual.noteOff(note);
  };

  return (
    <section className="keyboard" aria-label="Piano keyboard">
      {keys.map(({ note, black, leftPct }) => {
        const offset = note - octaveBase;
        const label = offset >= 0 && offset < COMPUTER_KEYS.length ? COMPUTER_KEYS[offset] : '';
        const classes = [
          'key',
          black ? 'black' : 'white',
          down.includes(note) ? 'down' : '',
          hints.includes(note) ? 'hint' : '',
          wrongNote === note ? 'wrong' : '',
        ].join(' ');
        return (
          <div
            key={note}
            className={classes}
            data-note={note}
            title={noteName(note)}
            style={{
              left: `${leftPct}%`,
              width: `${black ? whiteWidthPct * 0.6 : whiteWidthPct}%`,
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              release(e.pointerId);
              pointerNotes.current.set(e.pointerId, note);
              midi.virtual.noteOn(note);
            }}
            onPointerUp={(e) => release(e.pointerId)}
            onPointerCancel={(e) => release(e.pointerId)}
            onLostPointerCapture={(e) => release(e.pointerId)}
          >
            {label && <span className="key-label">{label}</span>}
            {note % 12 === 0 && !black && <span className="key-octave">{noteName(note)}</span>}
          </div>
        );
      })}
    </section>
  );
}
