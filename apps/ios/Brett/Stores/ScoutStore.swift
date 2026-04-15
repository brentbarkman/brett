import Foundation
import Observation
import SwiftData

/// Facade over the `/scouts/*` API. Scouts + findings live server-side and
/// reach the iOS client via REST (this store) and SSE (live status updates,
/// handled elsewhere). SwiftData is used as a cache so the roster can render
/// instantly on cold launch while a network refresh happens in the background.
///
/// Responsibility split:
/// - Reads return API DTOs directly (`APIClient.ScoutDTO`, etc.) — views
///   render DTOs, not SwiftData rows, because the server is authoritative
///   and the extra upsert layer adds complexity without meaningful offline
///   gains for scouts.
/// - Local `@Model` rows are kept in sync opportunistically so that tests
///   and any remaining SwiftData consumers keep working.
///
/// We inject `APIClient` so tests can swap in a stubbed URLSession.
@MainActor
@Observable
final class ScoutStore {
    // MARK: - Public state

    private(set) var scouts: [APIClient.ScoutDTO] = []
    private(set) var isLoading: Bool = false
    var errorMessage: String?

    private let client: APIClient
    private let context: ModelContext?

    init(client: APIClient = .shared, context: ModelContext? = nil) {
        self.client = client
        self.context = context
    }

    convenience init() {
        self.init(
            client: .shared,
            context: PersistenceController.shared.mainContext
        )
    }

    // MARK: - Legacy SwiftData readers (kept so existing callers compile)

    /// Legacy read-through: returns SwiftData-backed rows for any code that
    /// still reads from the local store. Prefer the API-backed methods below
    /// for new views.
    func fetchScouts(includeArchived: Bool = false) -> [Scout] {
        guard let context else { return [] }
        var descriptor = FetchDescriptor<Scout>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        descriptor.predicate = #Predicate { $0.deletedAt == nil }
        let rows = (try? context.fetch(descriptor)) ?? []
        if includeArchived { return rows }
        return rows.filter { $0.status != ScoutStatus.archived.rawValue }
    }

    func fetchScout(id: String) -> Scout? {
        guard let context else { return nil }
        var descriptor = FetchDescriptor<Scout>()
        descriptor.predicate = #Predicate { $0.id == id }
        descriptor.fetchLimit = 1
        return try? context.fetch(descriptor).first
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
        return (try? context.fetch(descriptor)) ?? []
    }

    // MARK: - API-backed reads

    /// Load the roster. Pass `status` = "active" / "paused" / "all" to filter.
    func refreshScouts(status: String? = nil) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let dtos = try await client.fetchScoutList(status: status)
            self.scouts = dtos
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
        replaceInRoster(dto)
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
        scouts.insert(dto, at: 0)
        upsertLocal([dto])
        return dto
    }

    func update(id: String, changes: APIClient.ScoutUpdatePayload) async throws -> APIClient.ScoutDTO {
        let dto = try await client.updateScout(id: id, changes: changes)
        replaceInRoster(dto)
        upsertLocal([dto])
        return dto
    }

    func pause(id: String) async throws -> APIClient.ScoutDTO {
        let dto = try await client.pauseScout(id: id)
        replaceInRoster(dto)
        upsertLocal([dto])
        return dto
    }

    func resume(id: String) async throws -> APIClient.ScoutDTO {
        let dto = try await client.resumeScout(id: id)
        replaceInRoster(dto)
        upsertLocal([dto])
        return dto
    }

    func archive(id: String) async throws -> APIClient.ScoutDTO {
        let dto = try await client.archiveScout(id: id)
        replaceInRoster(dto)
        upsertLocal([dto])
        return dto
    }

    func delete(id: String) async throws {
        try await client.deleteScout(id: id)
        scouts.removeAll { $0.id == id }
        if let context, let row = fetchScout(id: id) {
            context.delete(row)
            try? context.save()
        }
    }

    func triggerRun(id: String) async throws {
        try await client.triggerScoutRun(id: id)
    }

    func triggerConsolidation(id: String) async throws {
        try await client.triggerScoutConsolidation(id: id)
    }

    func clearHistory(id: String) async throws {
        try await client.clearScoutHistory(id: id)
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

    private func replaceInRoster(_ dto: APIClient.ScoutDTO) {
        if let idx = scouts.firstIndex(where: { $0.id == dto.id }) {
            scouts[idx] = dto
        }
    }

    /// Upsert a batch of DTOs into the SwiftData cache. Best-effort — any
    /// failure is logged in DEBUG builds and swallowed.
    private func upsertLocal(_ dtos: [APIClient.ScoutDTO]) {
        guard let context else { return }
        for dto in dtos {
            let existing = fetchScout(id: dto.id)
            let row = existing ?? Scout(
                id: dto.id,
                userId: "",
                name: dto.name,
                goal: dto.goal,
                createdAt: dto.createdAt
            )
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
            row.updatedAt = Date()

            if existing == nil {
                context.insert(row)
            }
        }
        try? context.save()
    }
}
