import type { AudioEngine } from '../audio/audioEngine';
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
import { Player } from '../playback/player';
import { buildTimeline } from '../playback/timeline';
import type { HandSelection, Score, ScoreNote } from '../score/types';
import type { SongLibrary } from '../songs/library';
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

  private loadSeq = 0;
  private readonly player: Player;
  /** Last score step shown during Listen (to continue from it after a speed change). */
  private listenStep: number | null = null;
  private readonly keyNotes = new Map<number, () => void>();

  constructor(
    private readonly store: AppStore,
    private readonly midi: MidiInputs,
    private readonly library: SongLibrary,
    private readonly audio: AudioEngine,
  ) {
    this.player = new Player(audio);
    audio.onStatusChanged((sound) => store.setState({ sound }));
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
      document.addEventListener('visibilitychange', () => {
        // Timers and rAF are throttled in the background: stop rather than stutter.
        if (document.visibilityState === 'hidden') this.stopListening();
        // Note-offs may have been lost while we were in the background.
        if (document.visibilityState === 'visible') this.dispatch({ type: 'allNotesOff' });
      });
      // iOS suspends audio after interruptions; any tap or key press may resume it.
      const wake = () => {
        if (this.store.getState().keySound) this.audio.unlock();
      };
      window.addEventListener('pointerdown', wake, { capture: true });
      window.addEventListener('keydown', wake, { capture: true });
    }
  }

  async connectMidi(): Promise<void> {
    await this.midi.hub.start();
  }

  attachView(view: ScoreView): void {
    this.view = view;
  }

  async refreshSongs(): Promise<void> {
    this.store.setState({ songs: await this.library.list() });
  }

  /** On startup: the last song played on this device, or the default. */
  async openInitialSong(): Promise<void> {
    await this.refreshSongs();
    const songs = this.store.getState().songs;
    const last = this.library.lastSongId();
    const id = songs.some((s) => s.id === last) ? last : (songs[0]?.id ?? last);
    await this.openSong(id);
  }

  /** Open a song from the library (built-in, this device, or my songs). */
  async openSong(id: string): Promise<void> {
    const view = this.view;
    if (!view) throw new Error('attachView() first');
    this.stopListening();
    const seq = ++this.loadSeq;
    const entry = this.store.getState().songs.find((s) => s.id === id);
    this.store.setState({ loading: true, loadError: null, currentSongId: id });
    try {
      const content = await this.library.content(id);
      if (seq !== this.loadSeq) return;
      const score = await view.load(content, entry?.title);
      if (seq !== this.loadSeq || view !== this.view) return; // superseded while loading
      this.score = score;
      this.library.rememberSong(id);
      this.store.setState({
        songTitle: entry?.title ?? score.title,
        handsAvailable: score.staffCount === 2,
        hands: score.staffCount === 2 ? this.store.getState().hands : 'both',
        loading: false,
      });
      this.rebuildSteps();
      this.state = initialState();
      this.restart();
    } catch (err) {
      if (seq !== this.loadSeq || view !== this.view) return;
      this.score = null;
      this.steps = [];
      this.state = initialState();
      this.store.setState({
        loading: false,
        totalSteps: 0,
        wait: this.state,
        currentRequired: [],
        loadError: `Could not open this song: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /** Save a MusicXML/MXL file to this device's library and open it. */
  async addSong(file: File): Promise<void> {
    const entry = await this.library.add(file);
    await this.refreshSongs();
    await this.openSong(entry.id);
  }

  async removeSong(id: string): Promise<void> {
    if (!id.startsWith('user:')) return;
    await this.library.remove(id);
    await this.refreshSongs();
    if (this.store.getState().currentSongId === id) {
      await this.openSong(this.store.getState().songs[0]?.id ?? '');
    }
  }

  restart(): void {
    this.stopListening();
    if (this.steps.length === 0) return; // nothing loaded (yet), or the load failed
    this.view?.resetPaint();
    this.dispatch({ type: 'start' });
  }

  /**
   * "Listen": play the song from the current step, cursor following. Call from a tap:
   * the first call unlocks audio and loads the piano.
   */
  toggleListen(): void {
    if (this.store.getState().listening || this.store.getState().listenPending) {
      this.stopListening();
      return;
    }
    if (!this.score) return;
    this.audio.unlock();
    this.store.setState({ listenPending: true });
    void this.audio.whenReady().then(() => {
      if (!this.store.getState().listenPending || !this.score) return;
      this.startListening(this.score);
    });
  }

  setSpeed(speed: number): void {
    this.store.setState({ speed });
    if (this.store.getState().listening && this.score) {
      this.player.stop();
      this.startListening(this.score, this.listenStep ?? undefined);
    }
  }

  /** Sound for the on-screen / computer keyboard. Call from a tap. */
  setKeySound(on: boolean): void {
    if (on) this.audio.unlock();
    this.store.setState({ keySound: on });
  }

  private startListening(score: Score, from?: number): void {
    const current = this.steps[this.state.stepIndex];
    const fromStep = from ?? (this.state.status === 'waiting' ? (current?.scoreStepIndex ?? 0) : 0);
    this.listenStep = fromStep;
    const timeline = buildTimeline(score, { fromStep, speed: this.store.getState().speed });
    this.store.setState({ listenPending: false, listening: true });
    this.player.play(timeline, {
      onStep: (scoreStepIndex) => {
        this.listenStep = scoreStepIndex;
        this.view?.setActiveStep(scoreStepIndex);
        const notes = score.steps[scoreStepIndex]?.notes ?? [];
        this.store.setState({
          listenKeys: notes.filter((n) => !n.tiedFromPrevious).map((n) => n.midi),
        });
      },
      onEnd: () => this.stopListening(),
    });
  }

  stopListening(): void {
    const { listening, listenPending } = this.store.getState();
    if (!listening && !listenPending) return;
    this.player.stop();
    this.listenStep = null;
    this.store.setState({ listening: false, listenPending: false, listenKeys: [] });
    // Back to where wait mode is.
    const current = this.state.status === 'waiting' ? this.steps[this.state.stepIndex] : undefined;
    this.view?.setActiveStep(current?.scoreStepIndex ?? null);
    this.dispatch({ type: 'allNotesOff' });
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
    this.playKeySound(e);
    if (!this.store.getState().listening) this.dispatch(e);
    this.recordMonitor(e);
  };

  /** On-screen / computer keyboard only: a real piano makes its own sound. */
  private playKeySound(e: MidiInputEvent): void {
    if (!this.store.getState().keySound || e.sourceId !== 'virtual') return;
    if (e.type === 'noteOn') {
      this.keyNotes.get(e.note)?.();
      try {
        this.keyNotes.set(e.note, this.audio.instrument().play(e.note, e.velocity));
      } catch {
        // audio not unlocked yet
      }
    } else if (e.type === 'noteOff') {
      this.keyNotes.get(e.note)?.();
      this.keyNotes.delete(e.note);
    }
  }

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
    if (!this.store.getState().listening) this.view?.setActiveStep(current?.scoreStepIndex ?? null);
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
