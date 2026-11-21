import { useState } from 'react';
import { useAppState, useServices } from './context';
import { Keyboard } from './Keyboard';
import { MidiMonitor } from './MidiMonitor';
import { ScorePane } from './ScorePane';
import { Toolbar } from './Toolbar';

export function App() {
  const [monitorOpen, setMonitorOpen] = useState(false);
  return (
    <div className="app">
      <Toolbar onToggleMonitor={() => setMonitorOpen((open) => !open)} />
      <main className="main">
        <ScorePane />
        <FinishedCard />
        {monitorOpen && <MidiMonitor onClose={() => setMonitorOpen(false)} />}
      </main>
      <Keyboard />
    </div>
  );
}

function FinishedCard() {
  const { session } = useServices();
  const status = useAppState((s) => s.wait.status);
  const stats = useAppState((s) => s.wait.stats);
  if (status !== 'finished') return null;
  return (
    <div className="finished" role="status" data-testid="finished">
      <h2>Nice playing!</h2>
      <p>
        {stats.stepsCompleted} steps · {stats.cleanSteps} clean · {stats.wrongNotes} wrong notes
      </p>
      <button type="button" className="primary" onClick={() => session.restart()}>
        Play again
      </button>
    </div>
  );
}
