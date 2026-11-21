# midi — Architecture for the M0 scaffold

Piano-learning app (wait mode first) for a Casio LK-S245 over USB-MIDI. iPad is the primary target (Capacitor 8 + native Core MIDI plugin); Android and laptops use the same web app with Web MIDI. License MIT; no GPL code.

**Verification legend.** ✔ = verified on 2026-11-21 by reading the tagged upstream source or by running it in this Linux workspace (Node 22.23, headless Chrome). ✘ = could not be verified here; treat as a spike item.

## 1. Decisions

| Area            | Decision                                                                                                          | Rationale                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| UI framework    | **React 19 + Vite 8**                                                                                             | React draws only the toolbar, keyboard and panels; the hot path (MIDI → engine → notation) bypasses it, so familiarity and ecosystem decide. |
| State           | **Zustand 5 vanilla store** + pure reducer                                                                        | One ~1 kB dep; readable from non-React code (`getState/subscribe`), selectors for components.                                                |
| Language        | TypeScript 7, `strict`, `noUncheckedIndexedAccess`, `moduleResolution: bundler`                                   | `tsc --noEmit` only. TS 7 ships no classic compiler API ✔, so no tool may depend on it (fallback: `typescript@5.9`).                         |
| Package manager | **npm**, single package                                                                                           | The local plugin is a `file:` dependency; that exact setup was run through `cap sync` here ✔. No workspaces.                                 |
| Lint/format     | **Biome 2**                                                                                                       | One binary, no TS-compiler-API dependency.                                                                                                   |
| Tests           | **Vitest 5** (node + jsdom), one **Playwright** smoke spec                                                        | See §7.                                                                                                                                      |
| Notation        | **opensheetmusicdisplay `3.0.0` (exact pin)**, SVG backend                                                        | Published today; every API below was checked against this version. OSMD is also the only MusicXML parser.                                    |
| Web MIDI        | Raw `navigator.requestMIDIAccess`                                                                                 | ~40 lines; WEBMIDI.js adds nothing we need.                                                                                                  |
| iOS shell       | Capacitor **8.6.2**, SPM, `capacitor.config.json` (not `.ts`)                                                     | JSON avoids the TS-7 config-loader path in the CLI ✔.                                                                                        |
| iOS MIDI        | In-repo Capacitor plugin **package** `native/midi-bridge` using **`swift-midi-io` 1.1.0** (product `SwiftMIDIIO`) | See §7. Not the `swift-midi` umbrella: it pins six sub-packages, four of which (UI, sync, file, control surfaces) we do not use ✔.           |

**Deviation from the earlier research note** (ViewController subclass + `registerPluginInstance`): rejected. In the 8.6.2 SPM template the root controller is created in `SceneDelegate.swift` _and_ named in `Main.storyboard` ✔; adding Swift files and an SPM dependency to the App target means hand-editing `project.pbxproj` (objectVersion 60, no synchronized folders ✔), which cannot be checked without Xcode. Capacitor 9 (`9.0.0-rc.0` on `main`) swaps the storyboard for a SwiftUI `App` ✔ and would break that approach again. A plugin package needs zero edits inside `ios/`: `npx cap add ios` and `npx cap sync ios` both ran on Linux here and produced the SPM wiring and `packageClassList` ✔.

## 2. Repository layout

```
package.json  vite.config.ts  tsconfig.json  biome.json  capacitor.config.json  index.html
public/songs/ode-to-joy.musicxml        # bundled CC0 piece (2 staves, chords)
src/
  midi/      types.ts parse.ts clock.ts hub.ts webMidiInput.ts nativeMidiInput.ts
             virtualMidiInput.ts fakeMidiInput.ts createMidiInput.ts
  native/    midiBridge.ts              # registerPlugin + payload types
  score/     types.ts
  engine/    expectedSteps.ts waitMode.ts
  notation/  scoreView.ts  osmd/{loadOsmd,extractScore,osmdScoreView}.ts
  session/   practiceSession.ts store.ts
  ui/        App.tsx ScorePane.tsx Keyboard.tsx Toolbar.tsx MidiMonitor.tsx
  test/      fixtures/*.musicxml canvasStub.ts
e2e/smoke.spec.ts
native/midi-bridge/   package.json  Package.swift
                      ios/Sources/MidiBridgePlugin/MidiBridgePlugin.swift
ios/                  # generated by `npx cap add ios`, committed, never hand-edited
.github/workflows/    ci.yml  ios-build.yml
```

Import rule: `engine/`, `score/`, `midi/parse.ts`, `midi/clock.ts` import no DOM, React, OSMD or Capacitor (enforce with a Biome `noRestrictedImports` override).

Data flow, all synchronous inside the MIDI callback:
`MidiInput → practiceSession → waitMode.reduce() → store.setState() + ScoreView commands`. React re-renders afterwards from the store.

## 3. MIDI input layer

```ts
// src/midi/types.ts
export type MidiNote = number; // 0–127, 60 = C4
export type Ms = number; // performance.now() time base
interface Base {
  time: Ms;
  channel: number;
  sourceId: string;
}
export type MidiInputEvent =
  | (Base & { type: 'noteOn'; note: MidiNote; velocity: number }) // velocity 1–127
  | (Base & { type: 'noteOff'; note: MidiNote; velocity: number })
  | (Base & { type: 'sustain'; down: boolean; value: number }); // CC64, down = value >= 64

export interface MidiDevice {
  id: string;
  name: string;
  transport: 'webmidi' | 'native' | 'virtual';
}
export type MidiStatus =
  | { state: 'idle' | 'starting' | 'ready' }
  | { state: 'denied' | 'unsupported' | 'error'; reason: string };
export type Unsubscribe = () => void;

export interface MidiInput {
  start(): Promise<void>; // idempotent; on web call from a user gesture (permission prompt)
  stop(): Promise<void>;
  getStatus(): MidiStatus;
  getDevices(): readonly MidiDevice[];
  onEvent(cb: (e: MidiInputEvent) => void): Unsubscribe;
  onDevicesChanged(cb: (d: readonly MidiDevice[]) => void): Unsubscribe; // hot-plug
  onStatusChanged(cb: (s: MidiStatus) => void): Unsubscribe;
}
export interface MidiOutput {
  // M6 (key lights); interface only in M0
  send(bytes: readonly number[], opts?: { deviceId?: string }): void;
}

// src/midi/parse.ts — the ONE parser, shared by Web MIDI and the native bridge
export function parseMidiMessage(
  bytes: ArrayLike<number>,
  time: Ms,
  sourceId: string,
): MidiInputEvent | null;
// src/midi/clock.ts — native monotonic ms -> performance.now() domain
export function createClockMapper(): {
  toPerf(nativeMs: number, arrivalPerfNow: Ms): Ms;
  reset(): void;
};
```

- `parseMidiMessage`: `0x9n` with velocity > 0 → `noteOn`; `0x9n` velocity 0 **or** `0x8n` → `noteOff`; `0xBn` controller 64 → `sustain`; everything else (clock `0xF8`, active sensing `0xFE`, SysEx, short/garbled input) → `null`. Mask data bytes with `0x7F`.
- `WebMidiInput`: `requestMIDIAccess({ sysex: false })`; attach `onmidimessage` to every input; re-scan on `onstatechange`; `event.timeStamp` is already `performance.now()`-based. Needs a secure context (https or localhost).
- `NativeMidiInput`: wraps the plugin (§6). `clock.toPerf` keeps `offset = min(offset, arrival − nativeMs)` and returns `nativeMs + offset`, removing bridge jitter; `reset()` on `visibilitychange`.
- `VirtualMidiInput`: computer keyboard (`KeyboardEvent.code`, row `A W S E D F T G Y H U J K` = C…C, `Z`/`X` octave shift, ignore `repeat`) and the on-screen `Keyboard` (pointer events, 61 keys C2–C7 like the LK-S245).
- `MidiHub` implements `MidiInput` over several inputs. `createMidiInput()`: `Capacitor.getPlatform() === 'ios'` → native + virtual; else `'requestMIDIAccess' in navigator` → web + virtual; else virtual only (status `unsupported`, e.g. Safari).
- On `visibilitychange → visible` and on device removal, dispatch `{ type: 'allNotesOff' }` to the engine (note-offs may have been lost).

## 4. Score model (no OSMD types)

```ts
// src/score/types.ts
export type Hand = 'right' | 'left';
export type HandSelection = Hand | 'both';
export interface ScoreNote {
  id: string; // `${stepIndex}:${n}`, stable for a loaded score
  midi: MidiNote;
  hand: Hand;
  staff: number; // global 0-based staff index
  duration: number; // whole notes (0.25 = quarter)
  tiedFromPrevious: boolean; // tie continuation — not re-struck
  grace: boolean;
}
export interface ScoreStep {
  index: number;
  cursorIndex: number; // how many cursor advances from the start reach this stop
  measureIndex: number;
  onset: number; // whole notes from the start, repeats unrolled
  bpm?: number; // captured for M4, unused in M0
  notes: ScoreNote[]; // every pitched note starting here, unfiltered
}
export interface Score {
  title: string;
  staffCount: number;
  steps: ScoreStep[];
}
```

Hand rule: with exactly two staves, staff 0 = right, staff 1 = left; otherwise every note is `right` and the hand selector is disabled. Use the _global_ staff index: piano scores exist both as one part with two staves and as two parts with one staff each ✔.

## 5. Wait-mode engine (pure)

```ts
// src/engine/expectedSteps.ts
export interface ExpectedStep {
  scoreStepIndex: number;
  required: MidiNote[]; // sorted, unique: selected hand(s), not tied-from-previous, not grace
  optional: MidiNote[]; // accepted, never required, never an error
}
export function buildExpectedSteps(score: Score, hands: HandSelection): ExpectedStep[];

// src/engine/waitMode.ts
export interface WaitModeConfig {
  chordWindowMs: number; // default 250
  octaveStrict: boolean; // default true
  clearOnWrongNote: boolean; // default false
}
export interface WaitModeState {
  status: 'idle' | 'waiting' | 'finished';
  stepIndex: number;
  matched: { target: MidiNote; key: MidiNote; at: Ms }[];
  down: MidiNote[]; // keys physically held (drives the on-screen keyboard)
  sustain: boolean; // tracked, not used for matching in v1
  wrongInStep: number;
  stats: { stepsCompleted: number; cleanSteps: number; wrongNotes: number };
}
export type WaitModeInput =
  | MidiInputEvent
  | { type: 'start' }
  | { type: 'seek'; stepIndex: number }
  | { type: 'allNotesOff' };
export type WaitModeEffect =
  | { type: 'noteMatched'; stepIndex: number; note: MidiNote }
  | { type: 'wrongNote'; stepIndex: number; note: MidiNote; time: Ms }
  | { type: 'stepCompleted'; stepIndex: number; clean: boolean; time: Ms }
  | { type: 'finished'; time: Ms };

export function initialState(): WaitModeState;
export function reduce(
  state: WaitModeState,
  input: WaitModeInput,
  steps: readonly ExpectedStep[],
  config: WaitModeConfig,
): { state: WaitModeState; effects: WaitModeEffect[] };
```

No clocks or timers inside: time comes only from events, and every decision happens on a `noteOn`.

**`buildExpectedSteps`.** For each `ScoreStep`: `required` = pitches of the selected hand(s) that are neither tie continuations nor grace notes. Steps with empty `required` are dropped (rest-only, tie-only, other-hand-only). `optional` = grace notes at that stop, plus — when one hand is selected — the other hand's pitches from the _previous_ expected step's score step through this one, both inclusive. (Attaching them to the following step matters: the selected hand's note completes a step before a slightly late other-hand note arrives. A scratch prototype of these rules confirmed this.)

**Matching rules.**

1. _Fresh strikes only._ A required pitch is matched by a `noteOn` received while its step is current. Keys already held when the step became current do not count, so repeated notes need a new strike and one strike can never satisfy two steps. (A second `noteOn` without a `noteOff` in between is a new strike.)
2. _Chord window._ A matched pitch stays matched while its key is held; after release it survives `chordWindowMs` from its `noteOn`. Prune on each `noteOn`, then test completion. Result: hold-and-search works for beginners, quick staccato chords work, but press-release-wait-press does not make a chord.
3. _Completion._ When every `required` pitch is matched, emit `stepCompleted` (`clean = wrongInStep === 0`), advance, clear `matched`; after the last step emit `finished`.
4. _Wrong notes._ A `noteOn` matching nothing in `required ∪ optional` emits `wrongNote` and increments counters. Default is lenient: progress is kept. `clearOnWrongNote` additionally empties `matched`.
5. _Neutral notes._ `optional` pitches and re-strikes of an already matched key (which refresh its `at`) produce no effect.
6. _Ties._ Continuations are never required, and we do not check that the key is still held.
7. _Octaves._ Strict by default. With `octaveStrict: false`, match by pitch class, one key per required note (multiset), for the computer keyboard and for pieces beyond the 61 keys (MIDI 36–96).
8. _Rests_ create no step. _Sustain_ never influences matching in v1. `allNotesOff` clears `down` and `matched`.

## 6. Notation: the OSMD adapter

```ts
// src/notation/scoreView.ts — a falling-notes view (M5) implements the same interface from `Score` alone
export type NoteVisual = 'default' | 'correct' | 'flawed';
export interface ScoreView {
  load(musicXml: string): Promise<Score>;
  setActiveStep(scoreStepIndex: number | null): void;
  paintNotes(noteIds: readonly string[], visual: NoteVisual): void;
  relayout(): void;
  dispose(): void;
}
```

**Loading.** The npm entry is one 1.5 MB UMD bundle; under Node ESM (Vitest) it exposes only `default` ✔. `loadOsmd()` does `const m = await import('opensheetmusicdisplay'); return m.OpenSheetMusicDisplay ? m : m.default;` (dynamic import keeps it out of the first chunk); use `import type` for types. Options: `{ backend: 'svg', autoResize: false, followCursor: false, drawPartNames: false }`.

**Extraction** — run against Ode to Joy and OSMD's own tie, grace and repeat fixtures ✔; it needs `load()` only, not `render()`:

```ts
const it = new lib.MusicPartManagerIterator(osmd.Sheet); // walks exactly like cursor.next() ✔
for (let cursorIndex = 0; !it.EndReached; cursorIndex++) {
  const notes = [];
  for (const ve of it.CurrentVisibleVoiceEntries())
    for (const n of ve.Notes) {
      if (n.isRest() || n.IsCueNote) continue;
      notes.push({
        midi: n.halfTone + 12, // OSMD halfTone 48 = C4 ✔
        staff: n.ParentStaff.idInMusicSheet,
        tiedFromPrevious: n.NoteTie !== undefined && n.NoteTie.StartNote !== n,
        grace: n.IsGraceNote, // shares the stop of its main note ✔
        duration: n.Length.RealValue,
        osmdNote: n, // kept in an adapter-private Map<noteId, Note>
      });
    }
  if (notes.length)
    steps.push({
      cursorIndex,
      measureIndex: it.CurrentMeasureIndex,
      onset: it.CurrentEnrolledTimestamp.RealValue,
      bpm: it.CurrentBpm,
      notes,
    });
  it.moveToNextVisibleVoiceEntry(false);
}
```

The iterator unrolls repeats ✔, so `steps` is linear and the cursor jumps back by itself. Title: `osmd.Sheet.TitleString` ✔. This snippet, the stub from §8 and a prototype of the §5 rules played four scores to `finished` with zero wrong notes for each hand setting ✔.

**Cursor.** `osmd.cursor` exists only after `render()` ✔. Keep `currentCursorIndex`; to reach a target, `cursor.reset()` if it lies behind, call `cursor.Iterator.moveToNextVisibleVoiceEntry(false)` for the difference, then `cursor.update()` once ✔. The cursor is an `<img>` with `z-index: -1` ✔ — the score container must have no opaque background. Scroll ourselves, only when `cursorElement.offsetTop` changes (new system): `scrollIntoView({ block: 'center', behavior: 'smooth' })`.

**Colouring.** `GraphicalNote.setColor()` tints _every_ notehead of a chord ✔, so paint one notehead directly:

```ts
const g = osmd.EngravingRules.GNote(osmdNote); // resolve at paint time, never cache
g.getNoteheadSVGs()[g.vfnoteIndex]?.setAttribute('fill', color); // index = that note's own head ✔
```

Such colours are lost on re-render ✔: the adapter stores `Map<noteId, NoteVisual>` and repaints after every `render()`. On `stepCompleted`, paint the step's `required` notes `correct` (green) or `flawed` (amber). Wrong keys flash red on the on-screen keyboard, not in the score.

**Performance (iPad).** Render once per song and per width; never during play. Cursor move and paint are attribute writes (0.2–0.6 ms in desktop Chrome; Ode to Joy loads in 34 ms, renders in 69 ms ✔). A debounced `ResizeObserver` (rotation) calls `relayout()`: render → repaint → restore cursor. Long scores: OSMD 3 has `renderNext()` / `enableIncrementalRenderingOnScroll()` ✔ — M3, not now. iPad timings are ✘.

## 7. iOS

### 7.1 Files

Hand-written: only `native/midi-bridge/**`, `src/native/midiBridge.ts`, `src/midi/nativeMidiInput.ts`, `capacitor.config.json`.

Generated, committed, untouched: `ios/App/App.xcodeproj/project.pbxproj`, `ios/App/App/{AppDelegate.swift, SceneDelegate.swift, Info.plist, Base.lproj/Main.storyboard, Base.lproj/LaunchScreen.storyboard, Assets.xcassets}`, `ios/App/CapApp-SPM/Package.swift` (rewritten by every `cap sync`), `ios/debug.xcconfig`. Git-ignored by the template: `ios/App/App/public/`, `ios/App/App/capacitor.config.json`, `ios/App/App/config.xml`. No `Info.plist` change is needed for USB MIDI.

`capacitor.config.json`: `{ "appId": "com.cheapsteak.midi", "appName": "Midi", "webDir": "dist" }`.

`native/midi-bridge/package.json` — `cap sync` turns the npm name into the Swift package name (`capacitor-midi-bridge` → `CapacitorMidiBridge`) and scans `ios/**/*.swift` for the first `@objc(Name)` per file ✔; both must match the files below:

```json
{
  "name": "capacitor-midi-bridge",
  "version": "0.0.0",
  "private": true,
  "capacitor": { "ios": { "src": "ios" } }
}
```

Root `package.json`: `"capacitor-midi-bridge": "file:native/midi-bridge"`. The app never imports from this package; it is only a manifest for `cap sync`.

```swift
// native/midi-bridge/Package.swift
// swift-tools-version: 5.9
import PackageDescription
let package = Package(
    name: "CapacitorMidiBridge",
    platforms: [.iOS(.v15)],
    products: [.library(name: "CapacitorMidiBridge", targets: ["MidiBridgePlugin"])],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/orchetect/swift-midi-io", from: "1.1.0")
    ],
    targets: [
        .target(name: "MidiBridgePlugin",
                dependencies: [
                    .product(name: "Capacitor", package: "capacitor-swift-pm"),
                    .product(name: "Cordova", package: "capacitor-swift-pm"),
                    .product(name: "SwiftMIDIIO", package: "swift-midi-io")
                ],
                path: "ios/Sources/MidiBridgePlugin")
    ]
)
```

Expected generated lines in `ios/App/CapApp-SPM/Package.swift` ✔: `.package(name: "CapacitorMidiBridge", path: "../../../native/midi-bridge")` and `.product(name: "CapacitorMidiBridge", package: "CapacitorMidiBridge")`.

### 7.2 Plugin (every API name read in the tagged sources ✔; never compiled ✘)

```swift
// native/midi-bridge/ios/Sources/MidiBridgePlugin/MidiBridgePlugin.swift
import Capacitor
import Foundation
import SwiftMIDIIO          // re-exports SwiftMIDICore (MIDIEvent)
import UIKit

@objc(MidiBridgePlugin)
public class MidiBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MidiBridgePlugin"
    public let jsName = "MidiBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDevices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKeepAwake", returnType: CAPPluginReturnPromise)
    ]

    private let midiManager = MIDIManager(clientName: "MidiBridge", model: "Midi", manufacturer: "cheapsteak")
    private var started = false
    private let timebase: mach_timebase_info_data_t = {
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        return info
    }()

    @objc func start(_ call: CAPPluginCall) {
        if !started {
            do {
                midiManager.notificationHandler = { [weak self] notification in   // delivered on main
                    switch notification {
                    case .added, .removed, .setupChanged: self?.emitDevices()
                    default: break
                    }
                }
                try midiManager.start()
                try midiManager.addInputConnection(
                    to: .allOutputs,                    // managed: re-connects on hot-plug
                    tag: "all-inputs",
                    receiver: .events(options: [.filterActiveSensingAndClock]) { [weak self] events, timeStamp, source in
                        self?.forward(events, timeStamp, source)      // background serial queue
                    }
                )
                started = true
            } catch {
                call.reject("MIDI start failed: \(error)")
                return
            }
        }
        call.resolve(deviceList())
    }

    @objc func getDevices(_ call: CAPPluginCall) { call.resolve(deviceList()) }

    @objc func send(_ call: CAPPluginCall) { call.unimplemented("MIDI out arrives in M6") }

    @objc func setKeepAwake(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? true
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = enabled
            call.resolve()
        }
    }

    private func forward(_ events: [MIDIEvent], _ timeStamp: CoreMIDITimeStamp, _ source: MIDIOutputEndpoint?) {
        var messages: [[Int]] = []
        for event in events {
            let bytes = event.midi1RawBytes()          // [] for MIDI-2-only events
            if !bytes.isEmpty { messages.append(bytes.map { Int($0) }) }
        }
        guard !messages.isEmpty else { return }
        let ticks = timeStamp == 0 ? mach_absolute_time() : timeStamp
        let ms = Double(ticks) * Double(timebase.numer) / Double(timebase.denom) / 1_000_000
        notifyListeners("midiMessage", data: [
            "t": ms,
            "sourceId": source.map { String($0.uniqueID) } ?? "",
            "messages": messages
        ])
    }

    private func emitDevices() { notifyListeners("devicesChanged", data: deviceList()) }

    private func deviceList() -> [String: Any] {
        let endpoints = midiManager.endpoints          // Core MIDI "outputs" are the app's inputs
        return [
            "inputs": endpoints.outputs.map { ["id": String($0.uniqueID), "name": $0.displayName] },
            "outputs": endpoints.inputs.map { ["id": String($0.uniqueID), "name": $0.displayName] }
        ]
    }
}
```

Design notes:

- **One event per Core MIDI packet**, carrying all its messages, so a chord crosses the bridge once. Bytes are parsed only in TypeScript.
- **Why `.events`, not `.rawData`:** on iOS 14+ the library's default API delivers Universal MIDI Packets, so `.rawData` yields UMP words, not MIDI 1.0 bytes ✔. `midi1RawBytes()` converts back (a MIDI-2 velocity that would map to 0 becomes 1 ✔).
- **Threading:** the receiver runs on the connection's serial queue; Capacitor hops to main for `evaluateJavaScript` ✔. Its listener table is unsynchronised ✔, so the wrapper adds both listeners _before_ `start()` and never removes them while running.
- **MIDI out (M6):** `send(rawMessage:)` is internal in `swift-midi-io` ✔. Use `addOutputConnection(to: .allInputs, tag:)` and `managedOutputConnections[tag]?.send(events: MIDI1Parser().parsedEvents(in: bytes))` ✔.
- **Keep-awake** is in M0: the iPad gets no touches while the user plays and would auto-lock.

### 7.3 TypeScript wrapper

```ts
// src/native/midiBridge.ts
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
export interface NativeMidiMessages {
  t: number;
  sourceId: string;
  messages: number[][];
}
export interface NativeMidiDevices {
  inputs: { id: string; name: string }[];
  outputs: { id: string; name: string }[];
}
export interface MidiBridgePlugin {
  start(): Promise<NativeMidiDevices>;
  getDevices(): Promise<NativeMidiDevices>;
  send(options: { data: number[]; deviceId?: string }): Promise<void>;
  setKeepAwake(options: { enabled: boolean }): Promise<void>;
  addListener(
    event: 'midiMessage',
    cb: (e: NativeMidiMessages) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'devicesChanged',
    cb: (e: NativeMidiDevices) => void,
  ): Promise<PluginListenerHandle>;
}
export const MidiBridge = registerPlugin<MidiBridgePlugin>('MidiBridge');
```

### 7.4 Audio session (M2 — nothing in M0)

Planned order: `if ('audioSession' in navigator) navigator.audioSession.type = 'playback'`; otherwise the silent-`<audio>`-element workaround; start the `AudioContext` from the "Start" tap. Whether WKWebView exposes `navigator.audioSession`, and whether a native `AVAudioSession` category affects WebKit's audio, are both ✘.

### 7.5 Mac workflow

`npm ci && npm run build && npx cap sync ios && npx cap open ios`, pick a signing team, run on the iPad. Needs Xcode 26+ and Node 22+ (Capacitor 8 update guide); the template targets iOS 15 ✔. Commit the `Package.resolved` Xcode creates.

## 8. Testing without hardware

1. **Vitest, node env:** `parseMidiMessage`, clock mapper, `buildExpectedSteps`, and `reduce` as table-driven event scripts: chord inside/outside the window, hold-and-search, repeated notes, ties, grace, wrong notes (both policies), octave-lenient multiset, `allNotesOff`, one-hand filtering.
2. **Vitest, jsdom env:** `extractScore` on the bundled piece plus tiny tie/grace/repeat fixtures. OSMD 3.0.0 loads and iterates under jsdom ✔, provided `HTMLCanvasElement.prototype.getContext` is stubbed with `{ font: '', measureText: t => ({ width: t.length * 10 }) }` (`src/test/canvasStub.ts`); without it, scores containing text throw ✔. `render()` cannot run in jsdom.
3. **Playwright smoke (`npm run test:e2e`, `channel: 'chrome'`):** with `?fakeMidi=1` the hub registers `FakeMidiInput` on `window.__fakeMidi`; the spec plays the first steps and asserts the cursor moved and noteheads have the `correct` fill, then that a wrong note does not advance. Headless Chrome with OSMD works on this machine ✔.
4. **`ios-build.yml` (macOS runner):** `npm ci && npm run build && npx cap sync ios && xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build` — the only Swift compile check before building on a real Mac. Runner image (needs Xcode 26) and scheme auto-creation are ✘.
5. **`MidiMonitor` panel (M0):** devices, status, last 20 parsed events with `performance.now() − event.time`. It is the hardware test tool.

## 9. Roadmap

- **M0 scaffold:** everything above. Exit: tests green; desktop Chrome plays Ode to Joy through with the keyboard fallback; iPad shows the LK-S245 in the monitor and wait mode advances.
- **M1 hardware hardening:** spike findings, iPad landscape layout, zoom, persisted settings.
- **M2 sound:** smplr `SplendidGrandPiano` with self-hosted samples, audio session, "listen" playback.
- **M3 library/import:** bundled public-domain set, MusicXML/MXL import, incremental rendering.
- **M4 play-along:** tempo clock, count-in, timing windows, scoring, tempo scaling, loops.
- **M5 falling notes** (canvas, from `Score`). **M6 MIDI out / key lights.** **M7 PWA + Android polish.**

**Do NOT do in the scaffold:** sound or smplr; `@tonejs/midi`; falling notes; song picker or import; timing, scoring, tempo, loops; MIDI-out implementation; Bluetooth MIDI; service worker or manifest; router, UI kit, Tailwind; WEBMIDI.js; workspaces; an Android project; hand edits to `project.pbxproj`, storyboards or `CapApp-SPM/Package.swift`; re-rendering OSMD during play; copying code from GPL projects (Sightread, Neothesia, PianoBooster).

## 10. Risks needing a spike on real hardware

1. The Swift plugin has never been compiled; first failure point.
2. LK-S245 traffic: note-off form (`0x80` vs `0x90` velocity 0), channel, pedal CC64, surprises. Read it off the monitor.
3. Bridge latency key → JS; timestamp-offset stability after sleep/resume.
4. Hot-plug, backgrounding, auto-lock; stuck notes after resume.
5. `.allOutputs` also subscribes to iOS's built-in network/IDAM endpoints — confirm no prompt or noise; filter by name if needed.
6. OSMD render time and scroll smoothness on the iPad with a long score.
7. Audio session behaviour in WKWebView (M2).
8. Key lights (M6): which channel lights keys, and whether received notes also sound.
9. OSMD 3.0.0 is hours old; 2.3.1 is the fallback, but the APIs above need re-checking there.
10. Web MIDI needs HTTPS: a phone cannot test against `http://<lan-ip>:5173`.

## 11. Open questions (defaults in use)

1. **Who makes the sound?** Default: the keyboard's own speakers for what you play; app audio (M2) only for playback and the fallback keyboard. If you want headphones on the iPad, M2 moves ahead of M1 and latency becomes critical.
2. **Wrong notes in wait mode:** default lenient (count and flash, keep progress). Strict is one config flag.
3. **Bundle id / name / signing:** default `com.cheapsteak.midi`, "Midi", personal team (7-day installs).
4. **iPad model and port:** default USB-C iPad on iPadOS 17+; a Lightning iPad needs the Camera Adapter.
5. **HTTPS hosting for Android/laptops:** default GitHub Pages from this repo.
6. **React:** default as above; the core is framework-free, so Svelte or Solid would only replace `src/ui`.

## 12. M0 implementation notes

What the scaffold actually built, where it differs from the plan above:

- **`ScoreView.resetPaint()`** was added so Restart can clear colours without the session tracking painted ids.
- **Inputs:** `createMidiInputs()` returns `{ hub, hardware, virtual, fake }`. `MidiHub(hardware, extras)` reports the hardware input's status; virtual/fake inputs are extras. Hardware auto-starts on iOS, and on the web only when `navigator.permissions` says MIDI was already granted; otherwise the toolbar shows **Connect keyboard**.
- **Paint while playing:** after every `noteOn`, the session repaints the current step from the engine's `matched` list (green if matched, black if not), so a chord fills in note by note and a note that falls out of the chord window turns black again. `stepCompleted` then paints the whole step green (clean) or amber (had a wrong note). `noteMatched` effects are not used for painting.
- **Review fixes:** the iOS plugin sets `preferredAPI = .newCoreMIDI(.midi1_0)` so note-on velocity 0 reaches JS unchanged; `setActiveStep` is a no-op when the step is unchanged (`relayout()` forces it); Restart is a no-op with no steps; a hand with no notes can't be selected; teardown uses `osmd.destroy()`.
- **Zoom:** `OsmdScoreView` sets `osmd.Zoom = clamp(width / 850, 0.8, 1.6)` before each render, so notation grows on an iPad.
- **Load races:** `OsmdScoreView.load()` is generation-guarded and `PracticeSession.loadSong()` ignores results for a replaced view.
- **Device names:** the toolbar hides iOS `Network Session` sources (risk 5); the monitor still lists everything.
- **Fake input:** `window.__fakeMidi` has `noteOn`, `noteOff`, `chord(notes)` and `sendBytes(bytes)` (the last goes through `parseMidiMessage`).
- **CI:** `ci.yml` (lint, typecheck, unit, Playwright), `ios-build.yml` (`macos-26`, unsigned simulator build; the first real compile of the Swift plugin), `pages.yml` (GitHub Pages deploy).

### Carried into M1 (from the M0 review)

- Monitor latency on iPad shows jitter against the fastest message, not true bridge latency. Add a wall-clock `wall` field to the native payload and show `Date.now() − wall`.
- Repeats: both passes map to the same OSMD notes, so the second pass starts already painted. Reset paint for the repeated range on a backward jump.
- If the LK-S245 sends accompaniment/rhythm notes on other channels, they count as wrong notes. Check the monitor's channel column; add a channel filter if needed.

## 13. Song library and Listen (added after M0)

**Songs.** `SongLibrary` (`src/songs/library.ts`) merges three sources, each with an id prefix:
`builtin:` (CC0 arrangements in `public/songs/`, listed in `catalog.ts`), `local:` (files in the
git-ignored `songs.local/` folder, bundled by `import.meta.glob` into local builds only) and
`user:` (files added with **Add song**, stored as ArrayBuffers in IndexedDB `midi/songs`).
Content reaches OSMD as a `Blob`, so compressed `.mxl` works. The last song is remembered in
`localStorage`. Copyrighted songs never go in the repo or the Pages build.

**Listen.** Research (two agents) found no library that does score-synced playback for our
model: OSMD's PlaybackManager is sponsor-only, osmd-audio-player is stale and takes over the
cursor, MIDI-file players lose the step mapping. So:

- `buildTimeline(score, { fromStep, speed })` (`src/playback/timeline.ts`, pure, unit-tested):
  step times from onsets and the per-step tempo; tie chains sound once; grace notes just before
  their main note; right hand slightly louder.
- `Player` schedules notes 180 ms ahead on the AudioContext clock (smplr cancels only notes it
  has been handed) and moves the cursor on rAF, compensating for `outputLatency`.
- Sound: smplr 1.2 `Sampler` with `pianoToPreset` (Splendid Grand Piano, public domain by
  AKAI). Only the MF layer is used, **self-hosted** in `public/piano/` (62 AAC files, ~6.7 MB;
  file names made URL-safe and mapped via `preset.samples.map`), its `velRange` widened to
  1–127 so every velocity plays it at a matching loudness. Self-hosting avoids the rate-limited
  default host (a 429 there makes keys silently drop out) and makes the iPad app work offline.
  AAC only (`formats: ['m4a']`): WKWebView's user agent hides "Safari", so smplr would try Ogg.
  A strict `storage` throws on non-200 so a missing sample rejects `ready` instead of playing
  silence; then (or after a 20 s timeout) the small oscillator synth plays, and the piano is
  adopted if it finishes later. `?synth=1` forces the synth (tests).
- iOS: `navigator.audioSession.type = 'playback'` where available, plus the plugin's
  `setAudioPlayback()` (AVAudioSession `.playback`), so the silent switch doesn't mute Listen.
- While listening, wait mode ignores input and doesn't move the cursor; Stop returns the cursor
  to the wait-mode step. A speed change continues from the current position. Listen stops when
  the page/app goes to the background (timers are throttled there). Starting in the middle of a
  tie sounds the rest of the tied note.
- The Add-song file input has no `accept` (iOS greys out .musicxml/.mxl otherwise); the file
  name is checked after picking.
- **🔈 Keys** plays the piano for the on-screen/computer keyboard only (a real piano makes its
  own sound).
