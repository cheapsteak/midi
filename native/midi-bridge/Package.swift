// swift-tools-version: 5.9
import PackageDescription

// Local Capacitor plugin: `npx cap sync ios` wires this package into
// ios/App/CapApp-SPM/Package.swift because the root package.json depends on it
// ("capacitor-midi-bridge": "file:native/midi-bridge").
let package = Package(
    name: "CapacitorMidiBridge",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "CapacitorMidiBridge", targets: ["MidiBridgePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/orchetect/swift-midi-io", from: "1.1.0")
    ],
    targets: [
        .target(
            name: "MidiBridgePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "SwiftMIDIIO", package: "swift-midi-io")
            ],
            path: "ios/Sources/MidiBridgePlugin"
        )
    ]
)
