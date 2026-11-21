import { createRoot } from 'react-dom/client';
import { canAutoStartHardware, createMidiInputs } from './midi/createMidiInput';
import { PracticeSession } from './session/practiceSession';
import { createAppStore } from './session/store';
import { App } from './ui/App';
import { AppContext } from './ui/context';
import './ui/styles.css';

const params = new URLSearchParams(window.location.search);
const midi = createMidiInputs({ fake: params.has('fakeMidi') });
const store = createAppStore();
const session = new PracticeSession(store, midi);

void midi.virtual.start();
void midi.fake?.start();
// iPad: no prompt, start right away. Web: only if permission was granted before;
// otherwise the "Connect keyboard" button starts it from a tap.
void canAutoStartHardware().then((ok) => {
  if (ok && midi.hardware) void session.connectMidi();
});

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
createRoot(root).render(
  <AppContext.Provider value={{ store, session, midi }}>
    <App />
  </AppContext.Provider>,
);
