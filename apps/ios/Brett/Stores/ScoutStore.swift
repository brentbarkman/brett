import Foundation
import Observation
import SwiftData

/// Facade over the `/scouts/*` API. Scouts + findings live server-side and
/// reach the iOS client via REST (this store) and SSE (live status updates,
/// handled elsewhere). SwiftData is the canonical local cache so the roster
/// can render instantly on cold launch while a network refresh happens in
/// the background.
///
/// Responsibility split:
/// - Reads write through to SwiftData via `upsertLocal`. Views read the
///   resulting rows reactively via `@Query<Scout>` — the store no longer
///   holds an in-memory `[ScoutDTO]` cache.
/// - Mutations call the API, then write the returned DTO into SwiftData.
///   `@Query` consumers automatically re-render.
///
/// We inject `APIClient` so tests can swap in a stubbed URLSession.
@MainActor
@Observable
final class ScoutStore: Clearable {
    // MARK: - Public state

    private(set) var isLoading: Bool = false
    var errorMessage: String?

    private let client: APIClient
    private let context: ModelContext?

    init(client: APIClient = .shared, context: ModelContext? = nil) {
        self.client = client
        self.context = context
        ClearableStoreRegistry.register(self)
    }

    convenience init() {
        self.init(
            client: .shared,
            context: PersistenceController.shared.mainContext
        )
    }

    // MARK: - Clearable

    func clearForSignOut() {
        // SwiftData rows are wiped by `PersistenceController.wipeAllData()`
        // on sign-out separately; here we just reset the @Observable
        // surface state so the next sign-in starts clean.
        isLoading = false
        errorMessage = nil
    }

    // MARK: - Legacy SwiftData readers (kept so existing callers compile)

    /// Legacy read-through: returns SwiftData-backed rows for any code that
    /// still reads from the local store. `userId` scopes to the active
    /// account so cached rows from a prior session don't surface after an
    /// account switch. Prefer the API-backed methods below for new views.
    func fetchScouts(userId: String? = nil, includeArchived: Bool = false) -> [Scout] {
        guard let context else { return [] }
        var descriptor = FetchDescriptor<Scout>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        if let userId {
            descriptor.predicate = #Predicate { scout in
                scout.deletedAt == nil && scout.userId == userId
            }
        } else {
            descriptor.predicate = #Predicate { $0.deletedAt == nil }
        }
        let rows = fetch(descriptor)
        if includeArchived { return rows }
        return rows.filter { $0.status != ScoutStatus.archived.rawValue }
    }

    /// User-scoped row lookup. Private — internal callers
    /// (`delete`, `upsertLocal`) supply the active user's id so a row from
    /// a different account that's still lingering in SwiftData (e.g.
    /// between sign-out and the wipe completing) can never be targeted.
    ///
    /// The previous public `fetchScout(id:)` ignored `userId` entirely,
    /// which was the multi-user invariant gap flagged in the Wave B review.
    private func findById(_ id: String, userId: String) -> Scout? {
        guard let context else { return nil }
        var descriptor = FetchDescriptor<Scout>(
            predicate: #Predicate { scout in
                scout.id == id && scout.userId == userId
            }
        )
        descriptor.fetchLimit = 1
        do {
            return try context.fetch(descriptor).first
        } catch {
            BrettLog.store.error("ScoutStore findById fetch failed: \(String(describing: error), privacy: .public)")
            return nil
        }
    }

    /// Legacy local-only findings read (pre-API). New UI should call
    /// `fetchFindingsPage(scoutId:)` instead.
    func fetchFindings(scoutId: String) -> [ScoutFinding] {
        guard let context else { return [] }
        var descriptor = FetchDescriptor<ScoutFinding>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        descriptor.predicate = #Predicate { finding in
            finding.scoutId == scoutId && finding.deletedAt == nil
        }
        return fetch(descriptor)
    }

    // MARK: - API-backed reads

    /// Load the roster. Pass `status` = "active" / "paused" / "all" to filter.
    func refreshScouts(status: String? = nil) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let dtos = try await client.fetchScoutList(status: status)
            upsertLocal(dtos)
        } catch let apiError as APIError {
            errorMessage = apiError.userFacingMessage
        } catch {
            errorMessage = "Couldn't load scouts."
        }
    }

    func fetchDetail(id: String) async throws -> APIClient.ScoutDTO {
        let dto = try await client.fetchScoutDetail(id: id)
        upsertLocal([dto])
        return dto
    }

    func fetchFindingsPage(
        scoutId: String,
        type: String? = nil,
        cursor: String? = nil,
        limit: Int = 20
    ) async throws -> APIClient.FindingsPage {
        try await client.fetchScoutFindings(
            scoutId: scoutId,
            type: type,
            cursor: cursor,
            limit: limit
        )
    }

    func fetchActivity(scoutId: String, cursor: String? = nil) async throws -> APIClient.ActivityPage {
        try await client.fetchScoutActivity(scoutId: scoutId, cursor: cursor)
    }

    func fetchMemories(scoutId: String, type: String? = nil) async throws -> [APIClient.MemoryDTO] {
        try await client.fetchScoutMemories(scoutId: scoutId, type: type)
    }

    // MARK: - Mutations

    func create(payload: APIClient.NewScoutPayload) async throws -> APIClient.ScoutDTO {
        let dto = try await client.createScout(payload)
        upsertLocal([dto])
        return dto
    }

    func update(id: String, changes: APIClient.ScoutUpdatePayload) async throws -> APIClient.ScoutDTO {
        let dto = try await client.updateScout(id: id, changes: changes)
        upsertLocal([dto])
        return dto
    }

    func pause(id: String) async throws -> APIClient.ScoutDTO {
        let dto = try await client.pauseScout(id: id)
        upsertLocal([dto])
        return dto
    }

    func resume(id: String) async throws -> APIClient.ScoutDTO {
        let dto = try await client.resumeScout(id: id)
        upsertLocal([dto])
        return dto
    }

    func archive(id: String) async throws -> APIClient.ScoutDTO {
        let dto = try await client.archiveScout(id: id)
        upsertLocal([dto])
        return dto
    }

    func delete(id: String) async throws {
        try await client.deleteScout(id: id)
        // Wave-A leftover: ScoutStore mutations still read the active
        // session for userId rather than taking it as an explicit
        // parameter (slated for cleanup in a follow-up wave).
        let uid = ActiveSession.userId ?? ""
        if let context, let row = findById(id, userId: uid) {
            context.delete(row)
            saveContext(context)
        }
    }

    func triggerRun(id: String) async throws {
        try await client.triggerScoutRun(id: id)
    }

    @discardableResult
    func submitFeedback(
        scoutId: String,
        findingId: String,
        useful: Bool?
    ) async throws -> APIClient.FindingFeedbackResponse {
        try await client.submitFindingFeedback(
            scoutId: scoutId,
            findingId: findingId,
            useful: useful
        )
    }

    func deleteMemory(scoutId: String, memoryId: String) async throws {
        try await client.deleteScoutMemory(scoutId: scoutId, memoryId: memoryId)
    }

    // MARK: - Private helpers

    /// Upsert a batch of DTOs into the SwiftData cache. Best-effort — any
    /// failure is logged and swallowed.
    ///
    /// New rows are created with the currently authenticated `userId`. The
    /// ScoutDTO wire format doesn't carry the user id (scouts are always
    /// read within the authenticated caller's scope), so we lift it from
    /// `ActiveSession.userId` at insert time. A freshly-created scout row
    /// with an empty `userId` string would be unreachable via
    /// `fetchScouts(userId:)` and accumulate as dead rows in the DB.
    private func upsertLocal(_ dtos: [APIClient.ScoutDTO]) {
        guard let context else { return }
        // Wave-A leftover: ScoutDTO doesn't carry userId on the wire, and
        // ScoutStore mutations still lift the id from ActiveSession rather
        // than taking it as an explicit parameter. Pass it through to
        // findById so the existing-row lookup is properly user-scoped.
        let uid = ActiveSession.userId ?? ""
        for dto in dtos {
            let existing = findById(dto.id, userId: uid)
            let row = existing ?? Scout(
                id: dto.id,
                userId: uid,
                name: dto.name,
                goal: dto.goal,
                createdAt: dto.createdAt
            )
            // On update: if an older row somehow landed with an empty
            // userId (shipped before this fix), backfill it so the row
            // becomes reachable again.
            if row.userId.isEmpty && !uid.isEmpty {
                row.userId = uid
            }
            row.name = dto.name
            row.avatarLetter = dto.avatarLetter
            row.avatarGradientFrom = dto.avatarGradient.first ?? ""
            row.avatarGradientTo = dto.avatarGradient.last ?? ""
            row.goal = dto.goal
            row.context = dto.context
            row.sensitivity = dto.sensitivity
            row.analysisTier = dto.analysisTier ?? AnalysisTier.standard.rawValue
            row.cadenceIntervalHours = dto.cadenceIntervalHours
            row.cadenceMinIntervalHours = dto.cadenceMinIntervalHours
            row.cadenceCurrentIntervalHours = dto.cadenceCurrentIntervalHours
            row.cadenceReason = dto.cadenceReason
            row.budgetUsed = dto.budgetUsed
            row.budgetTotal = dto.budgetTotal
            row.status = dto.status
            row.statusLine = dto.statusLine
            row.bootstrapped = dto.bootstrapped ?? false
            row.endDate = dto.endDate
            row.nextRunAt = dto.nextRunAt
            row.lastRun = dto.lastRun
            row.findingsCount = dto.findingsCount ?? 0
            row.updatedAt = Date()

            if existing == nil {
                context.insert(row)
            }
        }
        saveContext(context)
    }

    // MARK: - Internals

    private func fetch<T: PersistentModel>(_ descriptor: FetchDescriptor<T>) -> [T] {
        guard let context else { return [] }
        do {
            return try context.fetch(descriptor)
        } catch {
            BrettLog.store.error("ScoutStore fetch failed: \(String(describing: error), privacy: .public)")
            return []
        }
    }

    private func saveContext(_ context: ModelContext) {
        do {
            try context.save()
        } catch {
            BrettLog.store.error("ScoutStore save failed: \(String(describing: error), privacy: .public)")
        }
    }
}
