import CoreMotion
import SwiftUI
import UIKit

/// Detect a device shake and broadcast it via NotificationCenter so any
/// SwiftUI view can react. Mirrors the desktop's Cmd+Shift+. shortcut for
/// "report a bug" — on a phone the natural gesture is a shake.
///
/// **Why CoreMotion instead of UIResponder.motionEnded?** SwiftUI's
/// shake detection via UIResponder requires a UIViewController in the
/// hierarchy to be the first responder. That breaks the moment any
/// TextField gets focus (which steals first-responder status), and the
/// hidden bridge controller approach is fragile: zero-size frames,
/// responder-chain timing, etc.
///
/// CoreMotion polls the accelerometer directly (5Hz with two-peak
/// temporal persistence — see `sampleInterval` + `persistenceWindow`)
/// and detects shakes purely from acceleration magnitude. No responder
/// chain, no view layout, just physics. Works regardless of focus,
/// sheet state, or what view is on top.
extension Notification.Name {
    static let deviceDidShake = Notification.Name("brett.device.shake")
}

/// Singleton accelerometer monitor that posts `.deviceDidShake` when a
/// shake is detected. Started by `BrettApp` on launch and paused when
/// the app backgrounds (saves battery).
@MainActor
final class ShakeMonitor {
    static let shared = ShakeMonitor()

    private let motionManager = CMMotionManager()

    /// Acceleration magnitude (in g) above which we count a sample as
    /// part of a shake. ~1.0g = neutral standing still. 2.0+ = typical
    /// shake / jolt. Tuned to fire on a deliberate shake but not on
    /// pocket bumps or fast walking.
    private let shakeThreshold: Double = 2.2

    /// Sampling cadence. Previously 10Hz (every 100ms); moved to 5Hz to
    /// roughly halve the battery cost while keeping the "two peaks in
    /// 400ms" temporal-persistence check below comfortably resolvable.
    /// A shake event is ~3 full direction reversals over ~500ms, so the
    /// lower rate still catches it with multiple positive samples.
    private let sampleInterval: TimeInterval = 0.2

    /// Minimum gap between successive shake notifications. A real shake
    /// produces a burst of high-magnitude samples; without this we'd
    /// fire the notification dozens of times per shake.
    private let debounceInterval: TimeInterval = 1.5

    /// Temporal-persistence window. A single high-magnitude sample is
    /// often just a jolt (dropping the phone on a table, quickly
    /// handing it off). A real shake produces multiple peaks within a
    /// short window — require two before firing to cut false positives
    /// on trains, elevators, etc.
    private let persistenceWindow: TimeInterval = 0.4

    private var lastShakeAt: Date = .distantPast
    private var lastPeakAt: Date = .distantPast
    private var isRunning = false

    private init() {}

    /// Begin polling the accelerometer. Safe to call multiple times —
    /// no-ops if already running.
    func start() {
        guard !isRunning, motionManager.isAccelerometerAvailable else { return }
        isRunning = true

        motionManager.accelerometerUpdateInterval = sampleInterval
        motionManager.startAccelerometerUpdates(to: .main) { [weak self] data, _ in
            guard let self, let data = data else { return }
            let a = data.acceleration
            let magnitude = sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
            guard magnitude >= self.shakeThreshold else { return }

            let now = Date()
            // Debounce — a real shake spans ~500ms, so multiple sample
            // peaks will cluster. Fire at most once per `debounceInterval`.
            guard now.timeIntervalSince(self.lastShakeAt) >= self.debounceInterval else {
                // Still record this peak for the persistence window.
                self.lastPeakAt = now
                return
            }

            // Temporal persistence: require at least two peaks within
            // `persistenceWindow` before firing. First peak just arms
            // the detector; the second peak within the window fires it.
            if now.timeIntervalSince(self.lastPeakAt) <= self.persistenceWindow {
                self.lastShakeAt = now
                self.lastPeakAt = .distantPast
                NotificationCenter.default.post(name: .deviceDidShake, object: nil)
            } else {
                self.lastPeakAt = now
            }
        }
    }

    /// Stop polling. Called on app background to conserve battery.
    func stop() {
        guard isRunning else { return }
        motionManager.stopAccelerometerUpdates()
        isRunning = false
    }
}

/// Compatibility shim — old code referenced `ShakeDetector()` as a
/// SwiftUI view in the hierarchy. The CoreMotion approach doesn't need
/// any view, so this just renders an empty layout while keeping the
/// MainContainer call site working.
struct ShakeDetector: View {
    var body: some View { EmptyView() }
}

/// View modifier — observe `deviceDidShake` and run a closure.
private struct OnShakeModifier: ViewModifier {
    let action: () -> Void

    func body(content: Content) -> some View {
        content.onReceive(NotificationCenter.default.publisher(for: .deviceDidShake)) { _ in
            action()
        }
    }
}

extension View {
    /// Run `action` when the user shakes the device. The detector
    /// itself runs from `ShakeMonitor.shared` (started in BrettApp);
    /// this modifier just subscribes to the resulting notification.
    func onShake(perform action: @escaping () -> Void) -> some View {
        modifier(OnShakeModifier(action: action))
    }
}
