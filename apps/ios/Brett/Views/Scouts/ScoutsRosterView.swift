import SwiftUI
import SwiftData

/// Full-screen roster of the user's scouts. Pushes from the masthead
/// `antenna.radiowaves.left.and.right` icon in `MainContainer`.
///
/// Outer view is a thin auth gate: the body's `@Query` predicate needs a
/// concrete `userId`, so we resolve it from `AuthManager` and remount the
/// child via `.id(userId)` whenever the active user changes. This is the
/// standard Wave-B pattern (see `InboxPage`, `TodayPage`, `ListView`).
struct ScoutsRosterView: View {
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        if let userId = authManager.currentUser?.id {
            ScoutsRosterBody(userId: userId)
                .id(userId)
        } else {
            // Signed-out fallback. Upstream auth gate normally prevents this.
            EmptyView()
        }
    }
}

/// Roster's data + UI. `userId` is guaranteed non-optional for this view's
/// lifetime because the parent only renders us inside an auth check and
/// applies `.id(userId)` so SwiftUI remounts on account switch.
private struct ScoutsRosterBody: View {
    let userId: String

    @State private var scoutStore = ScoutStore()
    @State private var aiStore = AIProviderStore.shared
    @State private var statusFilter: StatusFilter = .all
    @State private var isPresentingNewScout = false
    @State private var showNoAIAlert = false
    @State private var pendingAction: PendingAction?
    @Environment(\.dismiss) private var dismiss

    /// Live reactive read of the user's non-deleted scouts. The roster used
    /// to read `scoutStore.scouts` (an in-memory cache of `ScoutDTO`); now
    /// we read SwiftData rows directly. `ScoutStore.refreshScouts` still
    /// owns the network fetch and writes via `upsertLocal`, so refresh,
    /// SSE, and pull-to-refresh all flow through the same path — they
    /// just write into SwiftData instead of the in-memory array. `@Query`
    /// reactively re-renders when those writes land.
    @Query private var scouts: [Scout]

    init(userId: String) {
        self.userId = userId
        let predicate = #Predicate<Scout> { scout in
            scout.deletedAt == nil && scout.userId == userId
        }
        _scouts = Query(filter: predicate, sort: \Scout.createdAt, order: .reverse)
    }

    enum StatusFilter: String, CaseIterable, Identifiable {
        case all, active, paused, archived
        var id: String { rawValue }
        var title: String { rawValue.capitalized }

        var serverValue: String {
            switch self {
            case .all: return "all"
            case .active: return "active"
            case .paused: return "paused"
            case .archived: return "completed"   // archived maps to completed server-side
            }
        }
    }

    enum PendingAction: Identifiable {
        case delete(id: String, name: String)
        var id: String {
            switch self {
            case .delete(let id, _): return "delete-\(id)"
            }
        }
    }

    /// Client-side filter. Cheaper than refetching for every segment
    /// tap AND avoids the "empty state flashes in between filter
    /// changes" problem (audit item #18).
    private var filteredScouts: [Scout] {
        switch statusFilter {
        case .all:
            return scouts
        case .active:
            return scouts.filter { $0.status == "active" }
        case .paused:
            return scouts.filter { $0.status == "paused" }
        case .archived:
            // "archived" UI maps to server-side "completed" status.
            return scouts.filter { $0.status == "completed" || $0.status == "archived" }
        }
    }

    var body: some View {
        ZStack {
            BackgroundView()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    statusPicker

                    if scoutStore.isLoading && scouts.isEmpty {
                        loadingState
                    } else if filteredScouts.isEmpty {
                        // Only show the emptyState when the user genuinely
                        // has nothing for this filter — not while we're
                        // mid-fetch. The isLoading guard above handles
                        // the initial cold-start case.
                        emptyState
                    } else {
                        grid
                    }

                    Spacer(minLength: 80)
                }
                .padding(.top, 12)
            }
            .scrollIndicators(.hidden)

            fab
        }
        // Uses iOS's default back button for consistency with ListView and
        // the rest of the app. Previously had a custom gold "Back" button
        // which diverged from ScoutDetailView's "Scouts" label and from
        // every other pushed screen's default chrome.
        // `.navigationTitle("Scouts")` is required: without it (or some
        // other navbar registrant like a `.principal` toolbar item),
        // SwiftUI doesn't wire the interactive pop gesture, so the user
        // can't swipe-from-the-edge to go back. Slight visual
        // redundancy with the big in-page "Scouts" header is the price.
        .navigationTitle("Scouts")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            // One fetch of all scouts; the segmented picker filters them
            // client-side so switching filters is instant and never shows
            // the "no scouts yet" card while the network round-trips.
            await scoutStore.refreshScouts(status: nil)
            // Check whether the user has an AI provider configured so we
            // can gate the "+ new scout" affordance. Background task —
            // UI waits for neither.
            await aiStore.refresh()
        }
        .refreshable {
            await scoutStore.refreshScouts(status: nil)
        }
        // SSE-driven live refresh. When a scout is deleted/paused on
        // another client (web), the server fires `scout.status.changed`
        // and `SSEEventHandler` rebroadcasts it as a local notification.
        // Without this, the roster would show the deleted scout until
        // the user navigated away and back.
        .onReceive(NotificationCenter.default.publisher(for: .scoutStateChanged)) { _ in
            Task { await scoutStore.refreshScouts(status: nil) }
        }
        .alert("Configure an AI provider", isPresented: $showNoAIAlert) {
            Button("Cancel", role: .cancel) {}
            // We don't have a direct NavigationLink from here to the
            // settings sub-view, so surface the path inline. Tapping
            // "Open Settings" dismisses the alert and tells the user
            // where to go — a direct push would require threading path
            // state up to `MainContainer`.
            Button("Got it") {}
        } message: {
            Text("You'll need to add an AI provider key before scouts can run. Open Settings → AI Providers to add one.")
        }
        .sheet(isPresented: $isPresentingNewScout) {
            NewScoutSheet { payload in
                do {
                    _ = try await scoutStore.create(payload: payload)
                } catch {
                    // error already surfaced via store.errorMessage after refresh
                }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .alert(item: $pendingAction) { action in
            switch action {
            case .delete(let id, let name):
                return Alert(
                    title: Text("Delete \(name)?"),
                    message: Text("This will remove the scout and all its findings. Promoted items are preserved."),
                    primaryButton: .destructive(Text("Delete")) {
                        Task {
                            try? await scoutStore.delete(id: id)
                        }
                    },
                    secondaryButton: .cancel()
                )
            }
        }
    }

    // MARK: - Sections

    @ViewBuilder
    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Scouts")
                .font(BrettTypography.dateHeader)
                .foregroundStyle(.white)

            Text(subtitle)
                .font(BrettTypography.stats)
                .foregroundStyle(BrettColors.textInactive)
        }
        .padding(.horizontal, 20)
    }

    private var subtitle: String {
        let active = scouts.filter { $0.status == "active" }.count
        let findings = scouts.reduce(0) { $0 + $1.findingsCount }
        return "\(active) active · \(findings) finding\(findings == 1 ? "" : "s")"
    }

    @ViewBuilder
    private var statusPicker: some View {
        Picker("Status", selection: $statusFilter) {
            ForEach(StatusFilter.allCases) { filter in
                Text(filter.title).tag(filter)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    private var grid: some View {
        LazyVGrid(
            columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
            spacing: 12
        ) {
            ForEach(filteredScouts, id: \.id) { scout in
                NavigationLink(value: NavDestination.scoutDetail(id: scout.id)) {
                    ScoutCard(scout: scout)
                }
                .buttonStyle(.plain)
                .contextMenu {
                    contextActions(for: scout)
                }
            }
        }
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    private func contextActions(for scout: Scout) -> some View {
        if scout.status == "active" {
            Button {
                Task { _ = try? await scoutStore.pause(id: scout.id) }
            } label: {
                Label("Pause", systemImage: "pause.circle")
            }
        } else if scout.status == "paused" {
            Button {
                Task { _ = try? await scoutStore.resume(id: scout.id) }
            } label: {
                Label("Resume", systemImage: "play.circle")
            }
        }
        Button {
            Task { _ = try? await scoutStore.archive(id: scout.id) }
        } label: {
            Label("Archive", systemImage: "archivebox")
        }
        Button(role: .destructive) {
            pendingAction = .delete(id: scout.id, name: scout.name)
        } label: {
            Label("Delete", systemImage: "trash")
        }
    }

    @ViewBuilder
    private var loadingState: some View {
        HStack {
            Spacer()
            ProgressView()
                .tint(BrettColors.gold)
            Spacer()
        }
        .padding(.vertical, 40)
    }

    @ViewBuilder
    private var emptyState: some View {
        GlassCard {
            VStack(spacing: 12) {
                Image(systemName: "antenna.radiowaves.left.and.right")
                    .font(.system(size: 36, weight: .thin))
                    .foregroundStyle(BrettColors.textGhost)
                Text("No scouts yet")
                    .font(BrettTypography.emptyHeading)
                    .foregroundStyle(.white)
                Text("Scouts monitor the internet for things you care about.")
                    .font(BrettTypography.emptyCopy)
                    .foregroundStyle(BrettColors.textInactive)
                    .multilineTextAlignment(.center)
                Button {
                    presentNewScout()
                } label: {
                    Text("Create your first scout")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(BrettColors.gold, in: Capsule())
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
        }
        .padding(.horizontal, 16)
    }

    /// Gate for every "create scout" entry point. A scout without an AI
    /// provider can't actually run, so we intercept and route the user
    /// to Settings instead of letting them fill in a form they can't use.
    private func presentNewScout() {
        if aiStore.hasActiveProvider == false {
            showNoAIAlert = true
        } else {
            isPresentingNewScout = true
        }
    }

    @ViewBuilder
    private var fab: some View {
        VStack {
            Spacer()
            HStack {
                Spacer()
                Button {
                    presentNewScout()
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 56, height: 56)
                        .background(
                            Circle()
                                .fill(BrettColors.gold)
                                .shadow(color: BrettColors.gold.opacity(0.6), radius: 12)
                        )
                }
                .buttonStyle(.plain)
                .padding(.trailing, 20)
                .padding(.bottom, 20)
            }
        }
    }
}
