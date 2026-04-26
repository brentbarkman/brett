import Foundation
import Observation

// MARK: - Entity types

/// Mirrors the server's search `entityType` discriminator.
///
/// These strings are stable API contract values — do not rename without a
/// coordinated server change. The `label` is used in filter chips and the
/// `icon` maps to an SF Symbol for the row icon.
enum SearchEntityType: String, Codable, CaseIterable, Sendable, Hashable {
    case item = "item"
    case calendarEvent = "calendar_event"
    case meetingNote = "meeting_note"
    case scoutFinding = "scout_finding"

    /// Human label for filter chips ("All" is handled at the UI layer).
    var label: String {
        switch self {
        case .item: return "Tasks"
        case .calendarEvent: return "Events"
        case .meetingNote: return "Notes"
        case .scoutFinding: return "Findings"
        }
    }

    /// SF Symbol shown on the left of each result row.
    var iconName: String {
        switch self {
        case .item: return "checklist"
        case .calendarEvent: return "calendar"
        case .meetingNote: return "note.text"
        case .scoutFinding: return "antenna.radiowaves.left.and.right"
        }
    }
}

// MARK: - Match type

/// How a result surfaced — colour-coded as a tiny dot next to the match score.
/// "hybrid" means both keyword and semantic rankers hit.
enum SearchMatchType: String, Codable, Sendable, Hashable {
    case keyword
    case semantic
    case hybrid
    case unknown

    init(raw: String?) {
        guard let raw else {
            self = .unknown
            return
        }
        self = SearchMatchType(rawValue: raw) ?? .unknown
    }
}

// MARK: - Result model

/// A single search hit, mirroring the API response shape one-to-one.
///
/// The API uses `entityType` + `entityId` as a composite key (two different
/// entity types can collide on id), so `id` is a synthesised compound. That
/// also keeps SwiftUI's `Identifiable`/diffable lists stable when the user
/// flips between filter sets.
struct SearchResult: Identifiable, Hashable, Sendable, Decodable {
    let entityType: SearchEntityType
    let entityId: String
    let title: String
    let snippet: String?
    let score: Double
    let matchType: SearchMatchType
    let metadata: Metadata?

    var id: String { "\(entityType.rawValue):\(entityId)" }

    struct Metadata: Hashable, Sendable, Decodable {
        let status: String?
        let type: String?
        let contentType: String?
        let dueDate: String?       // ISO date string (intentionally raw — row only displays)
        let listName: String?
    }

    // MARK: - Codable

    private enum CodingKeys: String, CodingKey {
        case entityType
        case entityId
        case title
        case snippet
        case score
        case matchType
        case metadata
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let entityTypeRaw = try c.decode(String.self, forKey: .entityType)
        guard let t = SearchEntityType(rawValue: entityTypeRaw) else {
            throw DecodingError.dataCorruptedError(
                forKey: .entityType,
                in: c,
                debugDescription: "Unknown entityType: \(entityTypeRaw)"
            )
        }
        self.entityType = t
        self.entityId = try c.decode(String.self, forKey: .entityId)
        self.title = try c.decode(String.self, forKey: .title)
        self.snippet = try c.decodeIfPresent(String.self, forKey: .snippet)
        self.score = (try? c.decode(Double.self, forKey: .score)) ?? 0
        self.matchType = SearchMatchType(raw: try c.decodeIfPresent(String.self, forKey: .matchType))
        self.metadata = try c.decodeIfPresent(Metadata.self, forKey: .metadata)
    }

    /// Convenience init for tests + previews.
    init(
        entityType: SearchEntityType,
        entityId: String,
        title: String,
        snippet: String? = nil,
        score: Double = 1.0,
        matchType: SearchMatchType = .hybrid,
        metadata: Metadata? = nil
    ) {
        self.entityType = entityType
        self.entityId = entityId
        self.title = title
        self.snippet = snippet
        self.score = score
        self.matchType = matchType
        self.metadata = metadata
    }
}

// MARK: - Store

/// Debounced search store. UI binds `query` through a `TextField`, store
/// schedules a search 300ms after the last edit, returns results on the
/// main actor.
///
/// Cancellation contract: every new edit cancels the in-flight Task. That
/// means stale results can never clobber fresh ones, and a mid-typing API
/// round trip is guaranteed to stop early.
///
/// Persistence: recent queries are written to UserDefaults under a single
/// key. We don't persist the full result set — it's cheap to re-run the
/// query, and the data may be stale by the time the user comes back.
@MainActor
@Observable
final class SearchStore: Clearable {
    // MARK: - Observable state

    var query: String = ""
    var results: [SearchResult] = []
    var isSearching: Bool = false
    var error: String?
    var recentQueries: [String] = []

    /// Active entity-type filter. Empty set = "All types".
    var activeTypes: Set<SearchEntityType> = []

    // MARK: - Dependencies

    private let apiClient: APIClient
    private let userDefaults: UserDefaults
    private let debounce: Duration
    private let clock: any Clock<Duration>

    private var currentTask: Task<Void, Never>?

    // MARK: - Constants

    /// Persisted recent-queries key. Bumping this invalidates the cache.
    static let recentQueriesDefaultsKey = "brett.search.recentQueries.v1"
    static let maxRecentQueries = 10
    static let minQueryLength = 2

    // MARK: - Init

    init(
        apiClient: APIClient = APIClient.shared,
        userDefaults: UserDefaults = .standard,
        debounce: Duration = .milliseconds(300),
        clock: any Clock<Duration> = ContinuousClock()
    ) {
        self.apiClient = apiClient
        self.userDefaults = userDefaults
        self.debounce = debounce
        self.clock = clock
        self.recentQueries = Self.loadRecent(from: userDefaults)
        ClearableStoreRegistry.register(self)
    }

    // MARK: - Clearable

    /// Drop in-memory state on sign-out. Crucially, cancels any in-flight
    /// debounced search Task — without this, a network response from the
    /// previous user could land in `results` after the new user has signed
    /// in. Recent-query persistence in UserDefaults is wiped separately by
    /// `UserScopedStorage` clearing during sign-out.
    func clearForSignOut() {
        currentTask?.cancel()
        currentTask = nil
        results = []
        query = ""
        isSearching = false
        error = nil
    }

    #if DEBUG
    /// Test-only: populate in-memory state without touching the network.
    func injectForTesting(results: [SearchResult]) {
        self.results = results
    }

    /// Test-only: visibility into whether a debounced search Task is alive.
    var hasInFlightTask: Bool { currentTask != nil }
    #endif

    // Swift 6 note: deinit on a @MainActor class is nonisolated, so we
    // can't touch `currentTask` there. The view owns the store as @State
    // and calls `cancel()` on sheet dismissal via `onDisappear`, which is
    // sufficient — the Task is also anchored to a `weak self`, so a
    // released store can't complete a stale write.

    // MARK: - Public API

    /// Entry point wired from the view's `onChange(of: query)`. Re-dispatches
    /// to the internal debounced runner. Exposed as a plain async method so
    /// tests can drive it without a view.
    func search(_ query: String, types: Set<SearchEntityType>? = nil) async {
        // Cancel any in-flight task — we never want two searches racing to
        // populate `results`.
        currentTask?.cancel()

        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)

        // Empty or too-short query: clear results immediately and don't call
        // the server. The view renders "suggestions" when `query.isEmpty`.
        guard trimmed.count >= Self.minQueryLength else {
            self.results = []
            self.isSearching = false
            self.error = nil
            return
        }

        let typeFilter = types ?? (activeTypes.isEmpty ? nil : activeTypes)

        let task = Task { [weak self, debounce, clock] in
            guard let self else { return }
            // Debounce.
            try? await clock.sleep(for: debounce)
            if Task.isCancelled { return }

            await self.performSearch(query: trimmed, types: typeFilter)
        }
        currentTask = task
        await task.value
    }

    /// Immediately run a search without debouncing. Used when the user
    /// selects a recent query or taps "Search" — we want an instant result
    /// there, not another 300ms wait.
    func searchNow(_ query: String, types: Set<SearchEntityType>? = nil) async {
        currentTask?.cancel()
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= Self.minQueryLength else {
            self.results = []
            self.isSearching = false
            self.error = nil
            return
        }
        let typeFilter = types ?? (activeTypes.isEmpty ? nil : activeTypes)
        await performSearch(query: trimmed, types: typeFilter)
    }

    /// Add a query to the head of the recent-queries list and persist.
    /// Dedupes case-insensitively, trims whitespace, caps at
    /// `maxRecentQueries`. Empty / too-short queries are ignored so the
    /// list can't fill with junk from debounced updates.
    func addRecent(_ query: String) {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= Self.minQueryLength else { return }

        // Remove any case-insensitive duplicate so the freshest entry wins.
        recentQueries.removeAll { $0.caseInsensitiveCompare(trimmed) == .orderedSame }
        recentQueries.insert(trimmed, at: 0)
        if recentQueries.count > Self.maxRecentQueries {
            recentQueries = Array(recentQueries.prefix(Self.maxRecentQueries))
        }
        userDefaults.set(recentQueries, forKey: Self.recentQueriesDefaultsKey)
    }

    func clearRecent() {
        recentQueries = []
        userDefaults.removeObject(forKey: Self.recentQueriesDefaultsKey)
    }

    /// Cancel any pending search. Used when the sheet dismisses.
    func cancel() {
        currentTask?.cancel()
        currentTask = nil
        isSearching = false
    }

    // MARK: - Internals

    private func performSearch(query: String, types: Set<SearchEntityType>?) async {
        self.isSearching = true
        self.error = nil
        do {
            let found = try await apiClient.search(q: query, types: types, limit: 30)
            if Task.isCancelled { return }
            self.results = found
            self.isSearching = false
        } catch is CancellationError {
            // Swallow — caller cancelled. State unchanged.
        } catch let apiError as APIError {
            if Task.isCancelled { return }
            self.error = Self.humanMessage(for: apiError)
            self.results = []
            self.isSearching = false
        } catch {
            if Task.isCancelled { return }
            self.error = "Search failed. Try again."
            self.results = []
            self.isSearching = false
        }
    }

    private static func humanMessage(for error: APIError) -> String {
        switch error {
        case .offline: return "You appear to be offline."
        case .unauthorized: return "Session expired. Sign in again."
        case .invalidCredentials: return "Session expired. Sign in again."
        case .rateLimited: return "Too many requests. Give it a sec."
        case .validation(let m): return m
        case .serverError: return "Server error. Try again shortly."
        case .decodingFailed: return "Couldn't read the response."
        case .unknown: return "Search failed. Try again."
        }
    }

    private static func loadRecent(from defaults: UserDefaults) -> [String] {
        (defaults.stringArray(forKey: recentQueriesDefaultsKey) ?? [])
            .prefix(maxRecentQueries)
            .map { String($0) }
    }
}
