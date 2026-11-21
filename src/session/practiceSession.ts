import { buildExpectedSteps, type ExpectedStep } from '../engine/expectedSteps';
import {
  DEFAULT_WAIT_MODE_CONFIG,
  initialState,
  reduce,
  type WaitModeConfig,
  type WaitModeEffect,
  type WaitModeInput,
  type WaitModeState,
} from '../engine/waitMode';
import type { MidiInputs } from '../midi/createMidiInput';
import { noteName } from '../midi/noteName';
import type { MidiDevice, MidiInputEvent } from '../midi/types';
import type { ScoreView } from '../notation/scoreView';
import type { HandSelection, Score, ScoreNote } from '../score/types';
import { type AppStore, MONITOR_SIZE, type MonitorEntry } from './store';

/**
 * Glue between MIDI input, the pure wait-mode engine, the notation view and the store.
 * Everything runs synchronously inside the MIDI callback; React re-renders afterwards.
 */
export class PracticeSession {
  private score: Score | null = null;
  private steps: ExpectedStep[] = [];
  private state: WaitModeState = initialState();
  private config: WaitModeConfig = DEFAULT_WAIT_MODE_CONFIG;
  private view: ScoreView | null = null;
  private knownDeviceIds = new Set<string>();
  private monitorSeq = 0;
  private wrongSeq = 0;

  constructor(
    private readonly store: AppStore,
    private readonly midi: MidiInputs,
  ) {
    const { hub, virtual } = midi;
    store.setState({
      hasHardware: hub.hasHardware(),
      midiStatus: hub.getStatus(),
      octaveBase: virtual.getOctaveBase(),
    });
    hub.onEvent(this.onMidiEvent);
    hub.onDevicesChanged(this.onDevicesChanged);
    hub.onStatusChanged((midiStatus) => store.setState({ midiStatus }));
    virtual.onOctaveChanged((octaveBase) => store.setState({ octaveBase }));
    if (typeof document !== 'undefined') {
      // Note-offs may have been lost while we were in the background.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.dispatch({ type: 'allNotesOff' });
      });
    }
  }

  async connectMidi(): Promise<void> {
    await this.midi.hub.start();
  }

  attachView(view: ScoreView): void {
    this.view = view;
  }

  async loadSong(url: string): Promise<void> {
    const view = this.view;
    if (!view) throw new Error('attachView() first');
    this.store.setState({ loading: true, loadError: null });
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const score = await view.load(await response.text());
      if (view !== this.view) return; // the view was replaced while loading
      this.score = score;
      this.store.setState({
        songTitle: score.title,
        handsAvailable: score.staffCount === 2,
        hands: score.staffCount === 2 ? this.store.getState().hands : 'both',
        loading: false,
      });
      this.rebuildSteps();
      this.restart();
    } catch (err) {
      if (view !== this.view) return;
      this.store.setState({
        loading: false,
        loadError: `Could not load the song: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  restart(): void {
    if (this.steps.length === 0) return; // nothing loaded (yet), or the load failed
    this.view?.resetPaint();
    this.dispatch({ type: 'start' });
  }

  /** Switch hands and continue from the same place in the score. */
  setHands(hands: HandSelection): void {
    if (this.score && buildExpectedSteps(this.score, hands).length === 0) return; // that hand has no notes
    const here = this.steps[this.state.stepIndex]?.scoreStepIndex ?? 0;
    // Leaving the current step unfinished: un-paint its partial chord (old hands, old steps).
    if (this.state.status === 'waiting') {
      this.view?.paintNotes(
        this.stepNotes(this.state.stepIndex).map((n) => n.id),
        'default',
      );
    }
    this.store.setState({ hands });
    this.rebuildSteps();
    if (this.state.status === 'idle') return;
    if (this.state.status === 'finished') {
      this.restart();
      return;
    }
    const next = this.steps.findIndex((s) => s.scoreStepIndex >= here);
    this.dispatch({ type: 'seek', stepIndex: next === -1 ? this.steps.length : next });
  }

  private rebuildSteps(): void {
    this.steps = this.score ? buildExpectedSteps(this.score, this.store.getState().hands) : [];
    this.store.setState({ totalSteps: this.steps.length });
  }

  private readonly onMidiEvent = (e: MidiInputEvent): void => {
    this.dispatch(e);
    this.recordMonitor(e);
  };

  private readonly onDevicesChanged = (devices: readonly MidiDevice[]): void => {
    const ids = new Set(devices.map((d) => d.id));
    const removed = [...this.knownDeviceIds].some((id) => !ids.has(id));
    this.knownDeviceIds = ids;
    this.store.setState({ devices });
    if (removed) this.dispatch({ type: 'allNotesOff' });
  };

  private dispatch(input: WaitModeInput): void {
    // Leaving a step without completing it: un-paint its partial chord.
    if (input.type === 'seek' && this.state.status === 'waiting') {
      this.view?.paintNotes(
        this.stepNotes(this.state.stepIndex).map((n) => n.id),
        'default',
      );
    }
    const result = reduce(this.state, input, this.steps, this.config);
    this.state = result.state;
    for (const effect of result.effects) this.applyEffect(effect);
    if (input.type !== 'noteOff' && input.type !== 'sustain') this.paintPartialChord();

    const current = this.state.status === 'waiting' ? this.steps[this.state.stepIndex] : undefined;
    this.view?.setActiveStep(current?.scoreStepIndex ?? null);
    this.store.setState({ wait: this.state, currentRequired: current?.required ?? [] });
  }

  private applyEffect(effect: WaitModeEffect): void {
    switch (effect.type) {
      case 'stepCompleted': {
        const ids = this.stepNotes(effect.stepIndex).map((n) => n.id);
        this.view?.paintNotes(ids, effect.clean ? 'correct' : 'flawed');
        break;
      }
      case 'wrongNote':
        this.store.setState({ lastWrong: { note: effect.note, seq: ++this.wrongSeq } });
        break;
      case 'noteMatched':
      case 'finished':
        break;
    }
  }

  /**
   * Paint the current step from the engine's state, not from noteMatched effects: the engine
   * can drop a match later (released past the chord window, allNotesOff), and then the
   * notehead must go back to black.
   */
  private paintPartialChord(): void {
    if (this.state.status !== 'waiting') return;
    const matched = new Set(this.state.matched.map((m) => m.target));
    const notes = this.stepNotes(this.state.stepIndex);
    const done = notes.filter((n) => matched.has(n.midi)).map((n) => n.id);
    const pending = notes.filter((n) => !matched.has(n.midi)).map((n) => n.id);
    this.view?.paintNotes(done, 'correct');
    this.view?.paintNotes(pending, 'default');
  }

  /** The struck score notes an expected step requires (selected hands, no ties or grace). */
  private stepNotes(expectedStepIndex: number): ScoreNote[] {
    const expected = this.steps[expectedStepIndex];
    const step = expected && this.score?.steps[expected.scoreStepIndex];
    if (!expected || !step) return [];
    const { hands } = this.store.getState();
    return step.notes.filter(
      (n) =>
        (hands === 'both' || n.hand === hands) &&
        !n.tiedFromPrevious &&
        !n.grace &&
        expected.required.includes(n.midi),
    );
  }

  private recordMonitor(e: MidiInputEvent): void {
    const entry: MonitorEntry = {
      id: ++this.monitorSeq,
      label:
        e.type === 'sustain'
          ? `Pedal ${e.down ? 'down' : 'up'}`
          : `${e.type === 'noteOn' ? 'On ' : 'Off'} ${noteName(e.note)} (${e.note})`,
      detail: e.type === 'sustain' ? `value ${e.value}` : `vel ${e.velocity} · ch ${e.channel + 1}`,
      source: this.store.getState().devices.find((d) => d.id === e.sourceId)?.name ?? e.sourceId,
      latencyMs: performance.now() - e.time,
    };
    const monitor = [entry, ...this.store.getState().monitor].slice(0, MONITOR_SIZE);
    this.store.setState({ monitor });
  }
}
