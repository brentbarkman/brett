import SwiftUI
import SwiftData

/// Compact glass pill that surfaces the mutation-queue backlog.
///
/// - Hidden when the queue is empty.
/// - Shows "`N` pending" in white/60, 12pt.
/// - Tap opens a small sheet listing what's pending so the user can tell
///   whether they should try a manual retry or just leave it.
struct SyncPendingIndicator: View {
    @Environment(\.modelContext) private var modelContext

    @State private var pendingCount: Int = 0
    @State private var showDetails = false
    @State private var pollTask: Task<Void, Never>?

    /// Seconds between cheap count refreshes. Exposed for tests/previews.
    private let pollInterval: TimeInterval

    init(pollInterval: TimeInterval = 5) {
        self.pollInterval = pollInterval
    }

    var body: some View {
        // The "N pending" pill is dev-facing telemetry — it surfaces the
        // mutation queue depth so we can spot stuck pushes during
        // development. In Release builds the existing offline banner +
        // the gold/cerulean pulse on `SyncStatusIndicator` are enough
        // signal for end users; the pill just adds noise and prompts
        // questions like "what does '1 pending' mean?"
        #if DEBUG
        if pendingCount > 0 {
            Button {
                showDetails = true
            } label: {
                Text("\(pendingCount) pending")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.60))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background {
                        Capsule(style: .continuous)
                            .fill(.thinMaterial)
                            .overlay {
                                Capsule(style: .continuous)
                                    .strokeBorder(Color.white.opacity(0.10), lineWidth: 1)
                            }
                    }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(pendingCount) changes pending sync")
            .accessibilityHint("Tap to see what's waiting to sync")
            .transition(.opacity.combined(with: .scale(scale: 0.92)))
            .animation(.easeInOut(duration: 0.2), value: pendingCount)
            .onAppear { startPolling() }
            .onDisappear { stopPolling() }
            .sheet(isPresented: $showDetails) {
                PendingDetailsSheet(
                    pendingCount: pendingCount,
                    entries: fetchEntries()
                )
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
                .presentationBackground(Color.black.opacity(0.80))
                .presentationCornerRadius(20)
            }
        } else {
            Color.clear
                .frame(width: 0, height: 0)
                .onAppear { startPolling() }
                .onDisappear { stopPolling() }
        }
        #else
        Color.clear.frame(width: 0, height: 0)
        #endif
    }

    // MARK: - Poll

    private func startPolling() {
        stopPolling()
        pollTask = Task { @MainActor in
            refresh()
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: UInt64(pollInterval * 1_000_000_000))
                } catch { return }
                if Task.isCancelled { return }
                refresh()
            }
        }
    }

    private func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    private func refresh() {
        pendingCount = OfflineBannerModifier.fetchPendingCount(from: modelContext)
    }

    private func fetchEntries() -> [MutationQueueEntry] {
        let pending = MutationStatus.pending.rawValue
        var descriptor = FetchDescriptor<MutationQueueEntry>(
            sortBy: [SortDescriptor(\.createdAt, order: .forward)]
        )
        descriptor.predicate = #Predicate { entry in
            entry.status == pending
        }
        descriptor.fetchLimit = 50
        return (try? modelContext.fetch(descriptor)) ?? []
    }
}

// MARK: - Details sheet

private struct PendingDetailsSheet: View {
    let pendingCount: Int
    let entries: [MutationQueueEntry]

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Waiting to sync")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Color.white)

                Text(summaryText)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(Color.white.opacity(0.60))

                if entries.isEmpty {
                    EmptyState(
                        heading: nil,
                        body: "Nothing pending. You're caught up."
                    )
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(entries, id: \.id) { entry in
                                PendingRow(entry: entry)
                            }
                        }
                    }
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private var summaryText: String {
        if pendingCount == 1 {
            return "1 change hasn't been sent to the server yet."
        }
        return "\(pendingCount) changes haven't been sent to the server yet."
    }
}

private struct PendingRow: View {
    let entry: MutationQueueEntry

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.60))
                .frame(width: 18, alignment: .leading)

            VStack(alignment: .leading, spacing: 2) {
                Text(summary)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.90))
                Text(entry.entityType)
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(Color.white.opacity(0.40))
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(0.04))
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
                }
        }
    }

    private var icon: String {
        switch MutationAction(rawValue: entry.action) {
        case .create: return "plus.circle"
        case .update: return "pencil.circle"
        case .delete: return "trash.circle"
        case .custom: return "wand.and.stars"
        case .none: return "clock"
        }
    }

    private var summary: String {
        let action = entry.action.capitalized
        return "\(action) \(entry.entityType)"
    }
}
