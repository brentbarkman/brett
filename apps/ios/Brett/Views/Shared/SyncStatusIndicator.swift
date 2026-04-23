import SwiftUI

/// Tiny inline indicator that reflects `ActiveSession.syncManager.state`.
///
/// States:
/// - `idle` / no session → invisible 8x8 dot (kept in layout so other
///   icons don't shift when state flips).
/// - `pushing`           → gold dot with a subtle pulse (local → server).
/// - `pulling`           → cerulean dot with a subtle pulse (server → local).
/// - `error`             → red dot, tappable; opens a sheet with the message.
///
/// Mount inside the top bar next to the settings / scouts / search icons.
struct SyncStatusIndicator: View {
    /// Bind to the active session's manager by default; tests inject a
    /// concrete instance. Optional because no session exists pre-auth.
    private let syncManager: SyncManager?

    /// Toggled when a tappable error is showing and the user taps it.
    @State private var showErrorDetails = false

    /// Drives the pulse animation for pushing/pulling states.
    @State private var isPulsing = false

    init(syncManager: SyncManager? = ActiveSession.syncManager) {
        self.syncManager = syncManager
    }

    private var state: SyncState {
        syncManager?.state ?? .idle
    }

    var body: some View {
        Group {
            switch state {
            case .idle:
                dot(color: .clear, isInteractive: false, pulse: false)

            case .pushing:
                dot(color: BrettColors.gold.opacity(0.85), isInteractive: false, pulse: true)

            case .pulling:
                dot(color: BrettColors.cerulean.opacity(0.85), isInteractive: false, pulse: true)

            case .error:
                dot(color: BrettColors.error, isInteractive: true, pulse: false)
                    .onTapGesture { showErrorDetails = true }
            }
        }
        .frame(width: 12, height: 12, alignment: .center) // 12pt hit target, 8pt dot
        .animation(.easeInOut(duration: 0.2), value: state)
        .onChange(of: state) { _, newValue in
            switch newValue {
            case .pushing, .pulling:
                isPulsing = true
            default:
                isPulsing = false
            }
        }
        .alert("Sync error", isPresented: $showErrorDetails) {
            Button("OK", role: .cancel) {}
        } message: {
            if case .error(let message) = state {
                Text(message)
            }
        }
    }

    // MARK: - Dot

    @ViewBuilder
    private func dot(color: Color, isInteractive: Bool, pulse: Bool) -> some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .scaleEffect(pulse && isPulsing ? 1.15 : 1.0)
            .opacity(pulse && isPulsing ? 0.75 : 1.0)
            .animation(
                pulse
                    ? .easeInOut(duration: 0.9).repeatForever(autoreverses: true)
                    : .default,
                value: isPulsing
            )
            .contentShape(Rectangle())
            .frame(width: 12, height: 12, alignment: .center)
            .allowsHitTesting(isInteractive)
            .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        switch state {
        case .idle: return ""
        case .pushing: return "Sync: sending changes"
        case .pulling: return "Sync: receiving changes"
        case .error(let message): return "Sync error: \(message)"
        }
    }
}

#Preview {
    VStack(spacing: 16) {
        SyncStatusIndicator()
        Text("Idle")
    }
    .padding()
    .background(.black)
}
