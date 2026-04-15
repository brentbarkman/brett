import SwiftUI

/// Full-screen roster of the user's scouts. Pushes from the masthead
/// `antenna.radiowaves.left.and.right` icon in `MainContainer`.
///
/// The view takes `MockStore` for nav compatibility but drives its rendering
/// from `ScoutStore` + `APIClient`. MockStore is ignored here today — it can
/// be wired up later if we want to pre-seed the roster from cached mock data.
struct ScoutsRosterView: View {
    @Bindable var store: MockStore
    @State private var scoutStore = ScoutStore()
    @State private var statusFilter: StatusFilter = .all
    @State private var isPresentingNewScout = false
    @State private var pendingAction: PendingAction?
    @Environment(\.dismiss) private var dismiss

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

    var body: some View {
        ZStack {
            BackgroundView()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    statusPicker

                    if scoutStore.isLoading && scoutStore.scouts.isEmpty {
                        loadingState
                    } else if scoutStore.scouts.isEmpty {
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
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button { dismiss() } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 14, weight: .semibold))
                        Text("Back")
                            .font(.system(size: 16, weight: .medium))
                    }
                    .foregroundStyle(BrettColors.gold)
                }
            }
        }
        .task {
            await scoutStore.refreshScouts(status: statusFilter.serverValue)
        }
        .refreshable {
            await scoutStore.refreshScouts(status: statusFilter.serverValue)
        }
        .onChange(of: statusFilter) { _, newValue in
            Task { await scoutStore.refreshScouts(status: newValue.serverValue) }
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
        let active = scoutStore.scouts.filter { $0.status == "active" }.count
        let findings = scoutStore.scouts.reduce(0) { $0 + ($1.findingsCount ?? 0) }
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
            ForEach(scoutStore.scouts, id: \.id) { scout in
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
    private func contextActions(for scout: APIClient.ScoutDTO) -> some View {
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
                    isPresentingNewScout = true
                } label: {
                    Text("Create your first scout")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.black)
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

    @ViewBuilder
    private var fab: some View {
        VStack {
            Spacer()
            HStack {
                Spacer()
                Button {
                    isPresentingNewScout = true
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(.black)
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
