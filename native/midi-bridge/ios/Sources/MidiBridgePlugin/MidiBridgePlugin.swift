import Capacitor
import Foundation
import SwiftMIDIIO // re-exports SwiftMIDICore (MIDIEvent)
import UIKit

/// Core MIDI → JavaScript bridge for the iPad build.
///
/// JS side: src/native/midiBridge.ts (registerPlugin('MidiBridge')) and
/// src/midi/nativeMidiInput.ts. Bytes are parsed only in TypeScript (src/midi/parse.ts).
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
                // Delivered on the main queue, after the manager's endpoint cache is updated.
                midiManager.notificationHandler = { [weak self] notification in
                    switch notification {
                    case .added, .removed, .setupChanged: self?.emitDevices()
                    default: break
                    }
                }
                // MIDI 1.0 protocol: keyboard bytes pass through unchanged, so "note on,
                // velocity 0" stays a note-off instead of being up-converted to MIDI 2.0.
                midiManager.preferredAPI = .newCoreMIDI(.midi1_0)
                try midiManager.start()
                // Managed connection to every source: re-connects automatically on hot-plug.
                try midiManager.addInputConnection(
                    to: .allOutputs,
                    tag: "all-inputs",
                    receiver: .events(options: [.filterActiveSensingAndClock]) { [weak self] events, timeStamp, source in
                        self?.forward(events, timeStamp, source) // runs on a background serial queue
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

    @objc func getDevices(_ call: CAPPluginCall) {
        call.resolve(deviceList())
    }

    @objc func send(_ call: CAPPluginCall) {
        // M6 (key lights): addOutputConnection(to: .allInputs, tag:) and
        // managedOutputConnections[tag]?.send(events: MIDI1Parser().parsedEvents(in: bytes)).
        call.unimplemented("MIDI out arrives in M6")
    }

    @objc func setKeepAwake(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? true
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = enabled
            call.resolve()
        }
    }

    /// One JS event per Core MIDI packet, carrying all of its messages, so a chord
    /// crosses the bridge once.
    private func forward(_ events: [MIDIEvent], _ timeStamp: CoreMIDITimeStamp, _ source: MIDIOutputEndpoint?) {
        var messages: [[Int]] = []
        for event in events {
            // The library receives Universal MIDI Packets on iOS 14+; convert back to MIDI 1.0.
            let bytes = event.midi1RawBytes() // [] for MIDI-2-only events
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

    private func emitDevices() {
        notifyListeners("devicesChanged", data: deviceList())
    }

    private func deviceList() -> [String: Any] {
        // Core MIDI "outputs" (sources) are the app's inputs, and vice versa.
        let endpoints = midiManager.endpoints
        return [
            "inputs": endpoints.outputsUnowned.map { ["id": String($0.uniqueID), "name": $0.displayName] },
            "outputs": endpoints.inputsUnowned.map { ["id": String($0.uniqueID), "name": $0.displayName] }
        ]
    }
}
