import SwiftUI

/// Tiny inline indicator that reflects `SyncManager.shared.state`.
///
/// - `idle` → invisible (0 opacity — retained in the layout so it doesn't
///   jump when a sync starts).
/// - `pushing` / `pulling` → faint gold dot.
/// - `error` → red dot, tappable to surface the underlying message.
///
/// Not currently mounted into `MainContainer` — callers opt-in by dropping it
/// into a status-bar-adjacent position when they're ready to expose this.
struct SyncStatusIndicator: View {
    /// Bind to the shared singleton by default; tests can inject a different
    /// instance via the parameterised initialiser.
    private let syncManager: SyncManager

    /// Toggled when a tappable error is showing and the user taps it.
    @State private var showErrorDetails = false

    init(syncManager: SyncManager = .shared) {
        self.syncManager = syncManager
    }

    var body: some View {
        Group {
            switch syncManager.state {
            case .idle:
                dot(color: .clear, isInteractive: false)
            case .pushing, .pulling:
                dot(color: BrettColors.gold.opacity(0.6), isInteractive: false)
            case .error:
                dot(color: BrettColors.error, isInteractive: true)
                    .onTapGesture { showErrorDetails = true }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: syncManager.state)
        .alert("Sync error", isPresented: $showErrorDetails) {
            Button("OK", role: .cancel) {}
        } message: {
            if case .error(let message) = syncManager.state {
                Text(message)
            }
        }
    }

    // MARK: - Dot

    @ViewBuilder
    private func dot(color: Color, isInteractive: Bool) -> some View {
        Circle()
            .fill(color)
            .frame(width: 6, height: 6)
            .contentShape(Rectangle())
            .allowsHitTesting(isInteractive)
            .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        switch syncManager.state {
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
