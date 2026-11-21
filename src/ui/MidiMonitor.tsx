import { useAppState } from './context';

/** Hardware test tool: what's connected and exactly what arrives, with delivery latency. */
export function MidiMonitor({ onClose }: { onClose: () => void }) {
  const status = useAppState((s) => s.midiStatus);
  const devices = useAppState((s) => s.devices);
  const monitor = useAppState((s) => s.monitor);
  const sustain = useAppState((s) => s.wait.sustain);
  const sound = useAppState((s) => s.sound);

  return (
    <aside className="monitor" aria-label="MIDI monitor">
      <div className="monitor-head">
        <h2>MIDI monitor</h2>
        <button type="button" className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="monitor-status">
        Status: <strong>{status.state}</strong>
        {'reason' in status ? ` — ${status.reason}` : ''} · Pedal: {sustain ? 'down' : 'up'}
      </p>
      <p className="monitor-status">
        Sound: <strong>{sound.state === 'ready' ? sound.instrument : sound.state}</strong>
        {sound.state === 'fallback' ? ` — ${sound.reason}` : ''}
      </p>
      <h3>Devices</h3>
      <ul className="monitor-devices">
        {devices.length === 0 && <li className="muted">None</li>}
        {devices.map((d) => (
          <li key={`${d.transport}:${d.id}`}>
            {d.name} <span className="muted">({d.transport})</span>
          </li>
        ))}
      </ul>
      <h3>Last {monitor.length} events</h3>
      <table className="monitor-events">
        <thead>
          <tr>
            <th>Event</th>
            <th>Detail</th>
            <th>Source</th>
            <th>Latency</th>
          </tr>
        </thead>
        <tbody>
          {monitor.map((m) => (
            <tr key={m.id}>
              <td>{m.label}</td>
              <td>{m.detail}</td>
              <td>{m.source}</td>
              <td>{m.latencyMs.toFixed(1)} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}
