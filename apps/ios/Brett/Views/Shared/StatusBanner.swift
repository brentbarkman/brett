import SwiftUI
import SwiftData

/// Sticky top banner that surfaces three states of the sync engine:
///
///  1. `.offline` — `NetworkMonitor` reports the device is offline. Red
///     glass card, "wifi.slash" icon, pending-mutation count inline.
///  2. `.apiUnreachable` — device is online but sync has been failing
///     (consecutiveFailures >= 1). Neutral glass card, calmer treatment.
///     The cause is usually a Railway / API outage; we don't try to
///     diagnose, we just tell the user their data is cached and offer
///     a Retry button.
///  3. `.retrying` — transient, while a user-initiated retry is in
///     flight. Same chrome as `.apiUnreachable` with a spinner replacing
///     the icon. Auto-restores to whichever real state applies once the
///     retry resolves.
///
/// Copy is intentionally human — no "mutations / queue / 502". Users
/// reading the banner are not engineers. Expanded detail (tap to
/// reveal) is only meaningful in `.offline` where we have pending
/// changes to report; the other states keep a single line.
///
/// The banner is applied via `.statusBanner()` and uses
/// `safeAreaInset(edge: .top)` so it never overlaps list content.
struct StatusBanner: View {
    /// What the banner currently reflects. `nil` is "render nothing"
    /// and is handled by the modifier — the view itself only renders
    /// when a kind is set.
    enum Kind: Equatable {
        case offline
        case apiUnreachable
        case retrying
    }

    let kind: Kind

    /// Pending-mutation count. Surfaced only in `.offline` where it
    /// communicates "your writes are saved locally." During an API
    /// outage the same count would be true but the messaging emphasis
    /// is on "showing cached data" instead.
    let pendingCount: Int

    /// Last successful sync. Surfaced in the expanded `.offline` detail.
    let lastSyncedAt: Date?

    /// True when the Retry action is in cooldown (post-press). The
    /// button stays disabled for 10s after each press so a user can't
    /// hammer the API during an outage.
    let isRetryCoolingDown: Bool

    /// Tapped on Retry. Only fires in `.apiUnreachable`. The modifier
    /// owns the cooldown timer and the underlying SyncManager call.
    let onRetry: () -> Void

    @State private var isExpanded = false

    var body: some View {
        bannerBody
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(.thinMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(tintFill)
                    }
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(tintStroke, lineWidth: 1)
                    }
            }
            .padding(.horizontal, 12)
            .padding(.top, 4)
            .contentShape(Rectangle())
            .onTapGesture {
                guard kind == .offline else { return }
                withAnimation(.easeInOut(duration: 0.2)) { isExpanded.toggle() }
            }
            .transition(.move(edge: .top).combined(with: .opacity))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(accessibilityLabel)
            .accessibilityHint(kind == .offline ? "Tap for details" : "")
    }

    @ViewBuilder
    private var bannerBody: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                leadingIcon

                Text(headlineText)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.90))

                Spacer(minLength: 0)

                trailingControl
            }

            if kind == .offline && isExpanded {
                Text(detailText)
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(Color.white.opacity(0.60))
                    .multilineTextAlignment(.leading)
            }
        }
    }

    // MARK: - Leading icon

    @ViewBuilder
    private var leadingIcon: some View {
        switch kind {
        case .offline:
            Image(systemName: "wifi.slash")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.70))
        case .apiUnreachable:
            Image(systemName: "exclamationmark.icloud")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.70))
        case .retrying:
            ProgressView()
                .controlSize(.mini)
                .tint(Color.white.opacity(0.70))
                .frame(width: 14, height: 14)
        }
    }

    // MARK: - Trailing control

    @ViewBuilder
    private var trailingControl: some View {
        switch kind {
        case .offline:
            Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.50))
        case .apiUnreachable:
            Button {
                guard !isRetryCoolingDown else { return }
                onRetry()
            } label: {
                Text("Retry")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(isRetryCoolingDown ? 0.40 : 0.85))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(
                        RoundedRectangle(cornerRadius: 999, style: .continuous)
                            .fill(Color.white.opacity(isRetryCoolingDown ? 0.04 : 0.10))
                    )
                    // 44pt minimum hit target per iOS HIG. The
                    // visible pill is smaller — the contentShape
                    // extends the tap region without changing
                    // the visual size, so the button is forgiving
                    // to tap without dominating the banner row.
                    .frame(minWidth: 44, minHeight: 44, alignment: .center)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isRetryCoolingDown)
            .accessibilityLabel("Retry connection")
        case .retrying:
            Text("Retrying…")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.60))
        }
    }

    // MARK: - Tint (background + border)

    private var tintFill: Color {
        switch kind {
        case .offline:
            return BrettColors.error.opacity(0.18)
        case .apiUnreachable, .retrying:
            // Neutral glass — calm-hero language. Loud red is wrong
            // when the user can keep working with cached data.
            return Color.white.opacity(0.06)
        }
    }

    private var tintStroke: Color {
        switch kind {
        case .offline:
            return BrettColors.error.opacity(0.30)
        case .apiUnreachable, .retrying:
            return Color.white.opacity(0.14)
        }
    }

    // MARK: - Copy

    private var headlineText: String {
        Self.headline(kind: kind, pendingCount: pendingCount)
    }

    private var detailText: String {
        Self.detail(pendingCount: pendingCount, lastSyncedAt: lastSyncedAt)
    }

    private var accessibilityLabel: String {
        Self.accessibility(kind: kind, pendingCount: pendingCount)
    }

    // MARK: - Pure copy helpers (testable)

    /// Headline text. Each `Kind` has its own copy register.
    static func headline(kind: Kind, pendingCount: Int) -> String {
        switch kind {
        case .offline:
            if pendingCount <= 0 {
                return "You're offline"
            }
            let unit = pendingCount == 1 ? "change" : "changes"
            return "You're offline — \(pendingCount) \(unit) saved"
        case .apiUnreachable:
            return "Can't reach Brett — showing cached data"
        case .retrying:
            return "Reconnecting to Brett"
        }
    }

    /// Detail line shown when the offline banner is expanded. Only
    /// used in `.offline` — the API states keep to a single line.
    static func detail(pendingCount: Int, lastSyncedAt: Date?, now: Date = Date()) -> String {
        let savedLine: String = {
            if pendingCount <= 0 {
                return "We'll sync when you're back online."
            }
            let unit = pendingCount == 1 ? "change" : "changes"
            return "\(pendingCount) \(unit) saved on this device. We'll sync when you're back online."
        }()

        let lastUpdateLine: String = {
            guard let lastSyncedAt else { return "No previous update yet." }
            let minutes = max(0, Int(now.timeIntervalSince(lastSyncedAt) / 60))
            if minutes < 1 { return "Last update: moments ago." }
            if minutes == 1 { return "Last update: 1 minute ago." }
            return "Last update: \(minutes) minutes ago."
        }()

        return "\(savedLine) \(lastUpdateLine)"
    }

    static func accessibility(kind: Kind, pendingCount: Int) -> String {
        switch kind {
        case .offline:
            if pendingCount <= 0 {
                return "You're offline."
            }
            let unit = pendingCount == 1 ? "change" : "changes"
            return "You're offline. \(pendingCount) \(unit) saved on this device."
        case .apiUnreachable:
            return "Can't reach Brett. Showing cached data. Retry button available."
        case .retrying:
            return "Reconnecting to Brett."
        }
    }
}

// MARK: - ViewModifier

/// `.statusBanner()` — adds the sticky status banner above screen
/// content. Decides which `StatusBanner.Kind` to show based on:
///
///  - `NetworkMonitor.isOnline` (device-level reachability)
///  - `SyncHealth.consecutiveFailures` (API-level reachability —
///    PullEngine increments this on every failed `/sync/pull`, and
///    resets to 0 on success, so it's the right "is the API reachable
///    right now" signal)
///  - A transient `.retrying` flag held in local state while a
///    user-initiated retry is in flight.
///
/// The pending-count and last-synced-at are surfaced only in the
/// `.offline` state where they represent "your writes are saved."
/// In the API-unreachable case the same counts are still true, but
/// the messaging emphasis is "showing cached data" — the count would
/// be a distraction.
///
/// The retry button has a 10-second cooldown after each press so a
/// frustrated user can't hammer the API. The cooldown lives here
/// (not in the SyncManager) because it's a UI affordance — the
/// engine itself has exponential backoff for the same reason at a
/// different layer.
struct StatusBannerModifier: ViewModifier {
    @Environment(\.modelContext) private var modelContext

    private let networkMonitor: NetworkMonitor

    /// SwiftData @Query against the singleton `_sync_health` row.
    /// PullEngine writes `consecutiveFailures` here on every failed
    /// pull (reset to 0 on success). One row exists per signed-in
    /// session — the predicate isn't user-scoped because the table
    /// itself is recreated on sign-in.
    @Query private var syncHealthRows: [SyncHealth]

    @State private var pendingCount: Int = 0
    @State private var pollTask: Task<Void, Never>?

    /// True while a user-initiated retry is in flight. Drives the
    /// `.retrying` banner display; flips back to false the moment
    /// `pullToRefresh()` resolves.
    @State private var isRetrying = false

    /// Explicit cooldown flag (NOT a computed `Date > Date()` check)
    /// because @State changes are what trigger re-renders. If we
    /// derived `isInCooldown` from `Date()` at render time, the
    /// button would stay disabled past the cooldown window because
    /// nothing would re-render between "now" and "cooldown ended."
    /// A dedicated Task sleeps for the cooldown window and flips
    /// this back to false — which IS a state change SwiftUI will
    /// observe.
    @State private var isRetryCoolingDown = false

    /// The cooldown timer task. Kept so a second tap doesn't start
    /// a parallel cooldown (idempotent — second tap is gated on
    /// isInCooldown before reaching this point, but defensive).
    @State private var cooldownTask: Task<Void, Never>?

    /// Cooldown duration after a Retry press, regardless of how
    /// quickly the underlying sync resolves. Tuned to discourage
    /// hammering — long enough that a user notices the disabled
    /// state, short enough that someone watching the outage page
    /// can try again at a reasonable cadence.
    private static let retryCooldownSeconds: TimeInterval = 10

    init(networkMonitor: NetworkMonitor = .shared) {
        self.networkMonitor = networkMonitor
    }

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) {
                if let kind = currentKind {
                    StatusBanner(
                        kind: kind,
                        pendingCount: pendingCount,
                        lastSyncedAt: ActiveSession.syncManager?.lastSyncedAt,
                        isRetryCoolingDown: isRetryCoolingDown,
                        onRetry: handleRetryTapped
                    )
                    .animation(
                        .spring(response: 0.35, dampingFraction: 0.82),
                        value: kind
                    )
                }
            }
            .onAppear { startPolling() }
            .onDisappear {
                stopPolling()
                cooldownTask?.cancel()
                cooldownTask = nil
            }
    }

    // MARK: - Kind decision

    /// Decide what (if anything) the banner should show right now.
    /// Priority order matters:
    ///
    ///  1. `.retrying` while a user-initiated retry is in flight —
    ///     takes precedence so the button click feels responsive.
    ///  2. `.offline` over `.apiUnreachable` — if the device has no
    ///     network the API is unreachable as a *consequence*, not a
    ///     separate problem. Show the more actionable diagnosis.
    ///  3. `.apiUnreachable` when device is online but the sync
    ///     engine has failed at least once. Threshold of 1 (not 2)
    ///     prioritizes fast feedback over flicker — Railway outages
    ///     are usually minutes long, transient blips are rare, and
    ///     the banner only "flickers" if a single failed pull is
    ///     immediately followed by a successful one.
    ///  4. nil — everything is fine, render nothing.
    private var currentKind: StatusBanner.Kind? {
        if isRetrying { return .retrying }
        if !networkMonitor.isOnline { return .offline }
        let failures = syncHealthRows.first?.consecutiveFailures ?? 0
        if failures >= 1 { return .apiUnreachable }
        return nil
    }

    // MARK: - Retry

    /// Fired when the user taps Retry. Sets the retrying flag, kicks
    /// off `pullToRefresh()` via the active session, and arms the 10s
    /// cooldown via a dedicated Task. No-ops if no session exists
    /// (pre-auth) — defensive, the banner shouldn't be visible without
    /// a session anyway.
    ///
    /// Two parallel tasks fire:
    ///  1. The pullToRefresh task — flips `isRetrying` back to false
    ///     when the underlying sync resolves (fast path or error).
    ///  2. The cooldown task — flips `isRetryCoolingDown` back to
    ///     false after exactly 10 seconds. Independent of how fast
    ///     the sync resolves so a user spamming Retry can't get
    ///     multiple syncs in flight.
    ///
    /// Why two tasks instead of computing cooldown from a Date:
    /// `@State` changes are what trigger SwiftUI re-renders. A
    /// computed `Date > Date()` check at render time doesn't
    /// re-render itself when the deadline passes — the button
    /// would stay disabled until some unrelated state change
    /// happens to trigger a redraw.
    private func handleRetryTapped() {
        guard !isRetryCoolingDown else { return }
        guard let manager = ActiveSession.syncManager else { return }

        isRetrying = true
        isRetryCoolingDown = true

        // Cooldown timer — flips the disabled flag back off after
        // exactly `retryCooldownSeconds`. Replacing any prior task
        // is safe because the guard above prevents reentry.
        cooldownTask?.cancel()
        cooldownTask = Task { @MainActor in
            try? await Task.sleep(
                nanoseconds: UInt64(Self.retryCooldownSeconds * 1_000_000_000)
            )
            if !Task.isCancelled {
                isRetryCoolingDown = false
            }
        }

        Task { @MainActor in
            // Use `pullToRefresh` for user-initiated refreshes — it
            // throws on error which we deliberately swallow here
            // (the banner state already reflects the failure via
            // SyncHealth.consecutiveFailures). The thrown error
            // surfaces to the engine's own error toast / dot, which
            // is the right place for diagnostic detail.
            do {
                try await manager.pullToRefresh()
            } catch {
                // Intentionally ignored — SyncHealth is the source
                // of truth for "is the API reachable" and it already
                // reflects this failure.
            }
            isRetrying = false
        }
    }

    // MARK: - Pending poll

    /// Cheap main-actor poll — queries the pending-mutation count
    /// every 5 seconds. Same cadence the previous OfflineBanner
    /// used; the count only matters in the `.offline` state but we
    /// still want it accurate when the user transitions through
    /// offline → online without remounting.
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

    /// Count of `MutationQueueEntry` rows with status == pending.
    /// Exposed as a static helper so tests can call it directly
    /// against any context.
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
    /// Apply the sticky status banner — handles offline, API-unreachable,
    /// and retrying states. Replaces the older `.offlineBanner()` which
    /// only handled the device-offline case.
    func statusBanner(networkMonitor: NetworkMonitor = .shared) -> some View {
        modifier(StatusBannerModifier(networkMonitor: networkMonitor))
    }
}
