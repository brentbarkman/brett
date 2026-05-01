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

    // MARK: - Internal lookup

    /// User-scoped row lookup. Private — internal callers
    /// (`delete`, `upsertLocal`) supply the active user's id so a row from
    /// a different account that's still lingering in SwiftData (e.g.
    /// between sign-out and the wipe completing) can never be targeted.
    ///
    /// Views read scouts via `@Query<Scout>` directly; this store only
    /// exists for mutations + API-backed reads. The previous public
    /// `fetchScouts(userId:includeArchived:)` and `fetchFindings(scoutId:)`
    /// readers were retired (Wave B follow-up) — no production callers.
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

    // MARK: - API-backed reads

    /// Load the roster. Pass `status` = "active" / "paused" / "all" to filter.
    ///
    /// Captures `ActiveSession.userId` BEFORE the network call so the
    /// response can't be mis-attributed to a different account. If the
    /// user signs out / switches mid-request, the response is dropped
    /// rather than written under whoever's currently active.
    func refreshScouts(status: String? = nil) async {
        guard let requestUserId = ActiveSession.userId else {
            BrettLog.store.error("ScoutStore.refreshScouts called without ActiveSession.userId — refusing to fetch")
            errorMessage = "Couldn't load scouts."
            return
        }

        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let dtos = try await client.fetchScoutList(status: status)
            upsertLocal(dtos, requestUserId: requestUserId)
        } catch let apiError as APIError {
            errorMessage = apiError.userFacingMessage
        } catch {
            errorMessage = "Couldn't load scouts."
        }
    }

    func fetchDetail(id: String) async throws -> APIClient.ScoutDTO {
        // Capture userId BEFORE the network call so a sign-out/switch
        // mid-request can't cross-attribute the response. If we can't
        // identify the requester, refuse — auth-gap windows are real.
        guard let requestUserId = ActiveSession.userId else {
            throw ScoutStoreError.notAuthenticated
        }
        let dto = try await client.fetchScoutDetail(id: id)
        upsertLocal([dto], requestUserId: requestUserId)
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
        guard let requestUserId = ActiveSession.userId else {
            throw ScoutStoreError.notAuthenticated
        }
        let dto = try await client.createScout(payload)
        upsertLocal([dto], requestUserId: requestUserId)
        return dto
    }

    func update(id: String, changes: APIClient.ScoutUpdatePayload) async throws -> APIClient.ScoutDTO {
        guard let requestUserId = ActiveSession.userId else {
            throw ScoutStoreError.notAuthenticated
        }
        let dto = try await client.updateScout(id: id, changes: changes)
        upsertLocal([dto], requestUserId: requestUserId)
        return dto
    }

    func pause(id: String) async throws -> APIClient.ScoutDTO {
        guard let requestUserId = ActiveSession.userId else {
            throw ScoutStoreError.notAuthenticated
        }
        let dto = try await client.pauseScout(id: id)
        upsertLocal([dto], requestUserId: requestUserId)
        return dto
    }

    func resume(id: String) async throws -> APIClient.ScoutDTO {
        guard let requestUserId = ActiveSession.userId else {
            throw ScoutStoreError.notAuthenticated
        }
        let dto = try await client.resumeScout(id: id)
        upsertLocal([dto], requestUserId: requestUserId)
        return dto
    }

    func archive(id: String) async throws -> APIClient.ScoutDTO {
        guard let requestUserId = ActiveSession.userId else {
            throw ScoutStoreError.notAuthenticated
        }
        let dto = try await client.archiveScout(id: id)
        upsertLocal([dto], requestUserId: requestUserId)
        return dto
    }

    func delete(id: String) async throws {
        try await client.deleteScout(id: id)
        // A nil `ActiveSession.userId` is treated as "do not write" rather
        // than "write unscoped" — refusing to operate without a known
        // userId prevents orphan-row drift during the brief auth-gap
        // windows (cold-launch keychain hydrate, sign-out drain).
        guard let userId = ActiveSession.userId else {
            BrettLog.store.error("ScoutStore.delete called without ActiveSession.userId — refusing to operate on unscoped row")
            return
        }
        if let context, let row = findById(id, userId: userId) {
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
    /// `requestUserId` is captured at the API request site (before the
    /// network call) and threaded through here. The ScoutDTO wire format
    /// doesn't carry a userId (scouts are always read within the
    /// authenticated caller's scope), so the requester is the only source.
    ///
    /// **TOCTOU defense:** if `ActiveSession.userId` no longer matches the
    /// `requestUserId` (sign-out, account switch, clearInvalidSession
    /// during the request), the response is dropped rather than written
    /// under whoever's currently active. Without this, the user could see
    /// account A's scouts briefly land in account B's roster between the
    /// switch and the next pull. The previous nil-only guard caught the
    /// "signed out" case but not the "switched account" case.
    private func upsertLocal(_ dtos: [APIClient.ScoutDTO], requestUserId: String) {
        guard let context else { return }
        // Re-check ActiveSession at write time. We honor the captured
        // `requestUserId` for stamping the row, so even if ActiveSession
        // somehow regresses to nil between this check and the writes
        // below, the row gets the right userId. The check is a defense
        // against attributing user A's response to whoever's now active.
        let currentUserId = ActiveSession.userId
        guard currentUserId == requestUserId else {
            BrettLog.store.info("ScoutStore.upsertLocal — user changed during fetch (request=\(requestUserId, privacy: .public), current=\(currentUserId ?? "nil", privacy: .public)); dropping response")
            return
        }
        for dto in dtos {
            let existing = findById(dto.id, userId: requestUserId)
            let row = existing ?? Scout(
                id: dto.id,
                userId: requestUserId,
                name: dto.name,
                goal: dto.goal,
                createdAt: dto.createdAt
            )
            // On update: if an older row somehow landed with an empty
            // userId (shipped before this fix), backfill it so the row
            // becomes reachable again.
            if row.userId.isEmpty {
                row.userId = requestUserId
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

    private func saveContext(_ context: ModelContext) {
        do {
            try context.save()
        } catch {
            BrettLog.store.error("ScoutStore save failed: \(String(describing: error), privacy: .public)")
        }
    }
}

/// Errors thrown by `ScoutStore` mutations when an auth-gap window
/// (cold-launch hydrate, sign-out drain, account switch in flight)
/// makes it unsafe to operate. Callers can surface a "couldn't reach
/// server" message rather than risk cross-user attribution.
enum ScoutStoreError: Error {
    /// `ActiveSession.userId` was nil at the moment a mutation was about
    /// to fire. Refusing to proceed is safer than running the request and
    /// risking a TOCTOU mis-attribution at write time.
    case notAuthenticated
}
