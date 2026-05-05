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
    @State private var showNoAIAlert = false
    @State private var pendingAction: PendingAction?
    @State private var selection = NavStore.shared
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
            // Wash backdrop — Scouts is a drill-in destination but
            // wears the same solid wash as every non-Today surface so
            // the visual family stays consistent across the app per
            // the calm-hero design.
            WashBackground()

            ScrollView {
                // Pinned-section layout (calm-hero spec): the page
                // title scrolls away normally, the status filter
                // pins to the top of the viewport, and scout cards
                // scroll under it. Same Apple Weather-style sticky
                // pattern that Today's task sections use, just
                // expressed via SwiftUI's native LazyVStack pinning
                // rather than the custom `StickyCardSection` (which
                // is tuned for cards with their own glass plate;
                // here the picker has its own segmented chrome).
                LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                    header
                        .padding(.bottom, 16)

                    Section {
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
                    } header: {
                        statusPicker
                            // Opaque wash backdrop on the pinned
                            // header so scout cards scrolling
                            // underneath don't show through the
                            // segmented control.
                            .padding(.vertical, 8)
                            .background {
                                BackgroundService.shared.currentWashColor
                                    .ignoresSafeArea(edges: .horizontal)
                            }
                    }
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

    /// Editorial 38pt serif header per the calm-hero design — parity
    /// with every other top-level page so swipes and pushes don't
    /// shift the header silhouette.
    @ViewBuilder
    private var header: some View {
        EditorialPageHeader(
            title: "Scouts",
            subtitle: subtitle
        )
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

    /// Editorial empty state per the calm-hero design — no glass card,
    /// no icon, just typography on the wash. Mirrors the Today / Inbox
    /// / Lists empty-state voice. The "create" affordance is the FAB
    /// (kept for v1; once omnibar AI routing ships in a follow-up we
    /// can move the entry point into the omnibar's contextual prompt).
    @ViewBuilder
    private var emptyState: some View {
        VStack(spacing: 8) {
            Text("No scouts yet.")
                .font(BrettTypography.emptyHeading)
                .foregroundStyle(Color.white.opacity(0.90))
                .multilineTextAlignment(.center)

            Text("Scouts monitor the internet for things you care about. Use the + below to brief one.")
                .font(BrettTypography.emptyCopy)
                .foregroundStyle(Color.white.opacity(0.40))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 32)
        .padding(.top, 60)
    }

    /// Gate for every "create scout" entry point. A scout without an AI
    /// provider can't actually run, so we intercept and route the user
    /// to Settings instead of letting them fill in a form they can't use.
    private func presentNewScout() {
        if aiStore.hasActiveProvider == false {
            showNoAIAlert = true
        } else {
            // Wave D: route the new-scout sheet through the unified
            // `MainContainer` sheet presenter rather than a local
            // `@State` boolean. The sheet contents (with their own
            // `ScoutStore` for the create call) live in
            // `MainContainer`'s `NewScoutSheetContainer`.
            selection.currentDestination = .newScout
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
