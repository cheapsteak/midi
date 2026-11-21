import { useAppState, useServices } from './context';

const SPEEDS = [
  { value: 0.5, label: '50%' },
  { value: 0.75, label: '75%' },
  { value: 1, label: '100%' },
];

export function ListenControls() {
  const { session } = useServices();
  const listening = useAppState((s) => s.listening);
  const pending = useAppState((s) => s.listenPending);
  const speed = useAppState((s) => s.speed);
  const keySound = useAppState((s) => s.keySound);
  const sound = useAppState((s) => s.sound);
  const loading = useAppState((s) => s.loading);

  const label = pending
    ? sound.state === 'loading'
      ? 'Loading piano…'
      : 'Starting…'
    : listening
      ? '■ Stop'
      : '▶ Listen';

  return (
    <div className="listen-controls">
      <button
        type="button"
        className={listening ? 'primary' : ''}
        disabled={loading}
        onClick={() => session.toggleListen()}
        data-testid="listen"
        title="Play the song from the cursor, with the cursor following"
      >
        {label}
      </button>
      <select
        aria-label="Speed"
        value={speed}
        onChange={(e) => session.setSpeed(Number(e.target.value))}
        data-testid="speed"
      >
        {SPEEDS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="ghost"
        aria-pressed={keySound}
        onClick={() => session.setKeySound(!keySound)}
        title="Piano sound for the on-screen and computer keyboard (a real piano makes its own)"
      >
        {keySound ? '🔊 Keys' : '🔈 Keys'}
      </button>
    </div>
  );
}
