# capacitor-midi-bridge (local plugin)

Core MIDI input for the iPad build, built on [swift-midi-io](https://github.com/orchetect/swift-midi-io) (MIT).

- **Swift:** `ios/Sources/MidiBridgePlugin/MidiBridgePlugin.swift`
- **JS interface:** `src/native/midiBridge.ts`; consumed by `src/midi/nativeMidiInput.ts`
- **Wiring:** the root `package.json` depends on this folder (`file:native/midi-bridge`), so
  `npx cap sync ios` adds it to `ios/App/CapApp-SPM/Package.swift`. Nothing inside `ios/` is edited by hand.

Events sent to JS:

| Event            | Payload                                                                            |
| ---------------- | ---------------------------------------------------------------------------------- |
| `midiMessage`    | `{ t: ms (host clock), sourceId, messages: number[][] }`, one per Core MIDI packet |
| `devicesChanged` | `{ inputs: {id,name}[], outputs: {id,name}[] }`                                    |

Not yet compiled in CI; the first build happens in Xcode (see the root README).
