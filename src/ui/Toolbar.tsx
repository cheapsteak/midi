import type { HandSelection } from '../score/types';
import { useAppState, useServices } from './context';

const HANDS: { value: HandSelection; label: string }[] = [
  { value: 'both', label: 'Both' },
  { value: 'right', label: 'Right' },
  { value: 'left', label: 'Left' },
];

export function Toolbar({ onToggleMonitor }: { onToggleMonitor: () => void }) {
  const { session } = useServices();
  const title = useAppState((s) => s.songTitle);
  const total = useAppState((s) => s.totalSteps);
  const stepIndex = useAppState((s) => s.wait.stepIndex);
  const stats = useAppState((s) => s.wait.stats);
  const hands = useAppState((s) => s.hands);
  const handsAvailable = useAppState((s) => s.handsAvailable);

  return (
    <header className="toolbar">
      <div className="toolbar-title">
        <h1>{title || 'Midi'}</h1>
        <span className="step-counter" data-testid="step-counter">
          {total > 0 ? `${Math.min(stepIndex + 1, total)} / ${total}` : '–'}
        </span>
        <span className="stats" data-testid="stats">
          <span title="Steps played without a wrong note">✓ {stats.cleanSteps}</span>
          <span title="Wrong notes">✗ {stats.wrongNotes}</span>
        </span>
      </div>

      <div className="toolbar-actions">
        <fieldset className="segmented" disabled={!handsAvailable} aria-label="Hands">
          {HANDS.map((h) => (
            <button
              key={h.value}
              type="button"
              aria-pressed={hands === h.value}
              onClick={() => session.setHands(h.value)}
            >
              {h.label}
            </button>
          ))}
        </fieldset>
        <button type="button" onClick={() => session.restart()}>
          Restart
        </button>
        <MidiStatusPill />
        <button type="button" className="ghost" onClick={onToggleMonitor} aria-label="MIDI monitor">
          Monitor
        </button>
      </div>
    </header>
  );
}

function MidiStatusPill() {
  const { session } = useServices();
  const status = useAppState((s) => s.midiStatus);
  const hasHardware = useAppState((s) => s.hasHardware);
  const devices = useAppState((s) => s.devices);
  // iOS lists its built-in network-MIDI session as a source; it isn't a keyboard.
  const hardware = devices.filter(
    (d) => d.transport !== 'virtual' && !/^network session/i.test(d.name),
  );

  if (!hasHardware) {
    return (
      <span className="pill muted" title={status.state === 'unsupported' ? status.reason : ''}>
        No MIDI here · use the keys below
      </span>
    );
  }
  switch (status.state) {
    case 'ready':
      return (
        <span className={`pill ${hardware.length ? 'ok' : 'muted'}`}>
          {hardware.length ? hardware.map((d) => d.name).join(', ') : 'No keyboard connected'}
        </span>
      );
    case 'starting':
      return <span className="pill muted">Connecting…</span>;
    case 'idle':
      return (
        <button type="button" className="primary" onClick={() => void session.connectMidi()}>
          Connect keyboard
        </button>
      );
    default:
      return (
        <button
          type="button"
          className="pill error"
          title={status.reason}
          onClick={() => void session.connectMidi()}
        >
          MIDI unavailable · retry
        </button>
      );
  }
}
