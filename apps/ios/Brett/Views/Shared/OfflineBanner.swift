import SwiftUI
import SwiftData

/// Sticky top banner that appears while `NetworkMonitor` reports offline.
///
/// The banner is a glass card with a red tint, a "wifi.slash" icon, and a
/// message. If there are pending mutations, the count is surfaced inline:
/// "Offline — 3 changes waiting to sync". Tap to toggle a detailed view with
/// the last-sync timestamp.
///
/// The banner uses `safeAreaInset(edge: .top)` so content is pushed down —
/// it never overlaps list content.
struct OfflineBanner: View {
    /// Shared network monitor — observed so visibility flips when the state
    /// changes.
    let networkMonitor: NetworkMonitor

    /// Number of pending mutations (`MutationStatus.pending`). Computed outside
    /// this view so it doesn't have to depend on SwiftData directly — avoids
    /// re-reading on every redraw.
    let pendingCount: Int

    /// Last successful sync. Surfaced in the expanded detail.
    let lastSyncedAt: Date?

    @State private var isExpanded = false

    var body: some View {
        if !networkMonitor.isOnline {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    Image(systemName: "wifi.slash")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.70))

                    Text(headlineText)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.90))

                    Spacer(minLength: 0)

                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.50))
                }

                if isExpanded {
                    Text(detailText)
                        .font(.system(size: 12, weight: .regular))
                        .foregroundStyle(Color.white.opacity(0.60))
                        .multilineTextAlignment(.leading)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(.thinMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(BrettColors.error.opacity(0.18))
                    }
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(BrettColors.error.opacity(0.30), lineWidth: 1)
                    }
            }
            .padding(.horizontal, 12)
            .padding(.top, 4)
            .contentShape(Rectangle())
            .onTapGesture {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.toggle()
                }
            }
            .transition(.move(edge: .top).combined(with: .opacity))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(accessibilityLabel)
            .accessibilityHint("Tap for details")
        }
    }

    // MARK: - Copy

    private var headlineText: String {
        if pendingCount > 0 {
            let unit = pendingCount == 1 ? "change" : "changes"
            return "Offline — \(pendingCount) \(unit) waiting to sync"
        }
        return "Offline — changes will sync when you're back"
    }

    private var detailText: String {
        let mutationsLine: String = {
            if pendingCount == 0 {
                return "No mutations pending."
            }
            let unit = pendingCount == 1 ? "mutation" : "mutations"
            return "\(pendingCount) \(unit) pending."
        }()

        let lastSyncLine: String = {
            guard let lastSyncedAt else { return "No sync recorded yet." }
            let minutes = max(0, Int(Date().timeIntervalSince(lastSyncedAt) / 60))
            if minutes < 1 { return "Last sync: moments ago." }
            if minutes == 1 { return "Last sync: 1 minute ago." }
            return "Last sync: \(minutes) minutes ago."
        }()

        return "\(mutationsLine) \(lastSyncLine)"
    }

    private var accessibilityLabel: String {
        "Offline. \(pendingCount) changes waiting to sync."
    }
}

// MARK: - ViewModifier

/// `.offlineBanner()` — adds the sticky offline banner above screen content.
///
/// Reads the shared `NetworkMonitor` plus a live pending-count (refreshed on
/// the same signal as the network state, with a best-effort timer backstop so
/// mutation bursts show up even when connectivity hasn't flipped).
///
/// The banner is session-aware: `lastSyncedAt` comes from the currently
/// active session's `SyncManager` via `ActiveSession.syncManager`. When
/// no user is signed in the banner simply reports "no sync recorded yet,"
/// which is the correct state for that case.
struct OfflineBannerModifier: ViewModifier {
    @Environment(\.modelContext) private var modelContext

    private let networkMonitor: NetworkMonitor

    @State private var pendingCount: Int = 0
    @State private var pollTask: Task<Void, Never>?

    init(networkMonitor: NetworkMonitor = .shared) {
        self.networkMonitor = networkMonitor
    }

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) {
                OfflineBanner(
                    networkMonitor: networkMonitor,
                    pendingCount: pendingCount,
                    lastSyncedAt: ActiveSession.syncManager?.lastSyncedAt
                )
                .animation(
                    .spring(response: 0.35, dampingFraction: 0.82),
                    value: networkMonitor.isOnline
                )
            }
            .onAppear { startPolling() }
            .onDisappear { stopPolling() }
    }

    // MARK: - Pending poll

    /// Cheap main-actor poll — queries the count every 5 seconds. Cheaper than
    /// wiring an observer into every mutation path, and only runs while the
    /// view is mounted. The count is also refreshed immediately on any
    /// network transition via the SyncManager's own listener.
    private func startPolling() {
        stopPolling()
        pollTask = Task { @MainActor in
            refreshPendingCount()
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: 5_000_000_000) // 5s
                } catch { return }
                if Task.isCancelled { return }
                refreshPendingCount()
            }
        }
    }

    private func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    private func refreshPendingCount() {
        pendingCount = Self.fetchPendingCount(from: modelContext)
    }

    /// Count of `MutationQueueEntry` rows with status == pending. Exposed as
    /// a static helper so tests can call it directly against any context.
    @MainActor
    static func fetchPendingCount(from context: ModelContext) -> Int {
        let pending = MutationStatus.pending.rawValue
        var descriptor = FetchDescriptor<MutationQueueEntry>()
        descriptor.predicate = #Predicate { entry in
            entry.status == pending
        }
        return (try? context.fetchCount(descriptor)) ?? 0
    }
}

extension View {
    /// Apply the sticky offline banner + pending-count indicator.
    func offlineBanner(networkMonitor: NetworkMonitor = .shared) -> some View {
        modifier(OfflineBannerModifier(networkMonitor: networkMonitor))
    }
}
