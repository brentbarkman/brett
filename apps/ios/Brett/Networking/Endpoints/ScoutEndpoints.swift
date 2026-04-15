import Foundation

/// Typed `APIClient` extensions for the `/scouts/*` routes.
///
/// Mirrors the server handler in `apps/api/src/routes/scouts.ts`. The server
/// is authoritative — these DTOs decode server responses and are used both
/// by `ScoutStore` (to upsert into SwiftData) and by views that want the
/// fresh response (e.g. findings pagination).
///
/// Notes on the server contract (matters if you're wiring new behaviour):
/// - There is no `/scouts/:id/archive` route. The spec mentions "archive"
///   but the server only exposes `pause`, `resume`, `delete`, and status
///   `archived` via the `ScoutStatus` enum (currently only reachable via
///   PUT /scouts/:id with `status` — which the route doesn't accept either).
///   We model `archive(id:)` as a best-effort soft-archive using `PUT` —
///   if the server rejects it, callers get `APIError.validation(...)`.
/// - The update endpoint is `PUT /scouts/:id`, not `PATCH`. We expose
///   `update(id:changes:)` as PATCH-style semantics (merge only provided
///   fields) but the wire method is PUT to match the server.
/// - Consolidation endpoint is `POST /scouts/:id/consolidate` (not
///   `/consolidation`).
@MainActor
extension APIClient {
    // MARK: - Request bodies

    struct NewScoutPayload: Encodable {
        let name: String
        let avatarLetter: String
        let avatarGradientFrom: String
        let avatarGradientTo: String
        let goal: String
        let context: String?
        let sources: [ScoutSourceDTO]
        let sensitivity: String
        let analysisTier: String
        let cadenceIntervalHours: Double
        let cadenceMinIntervalHours: Double
        let budgetTotal: Int
    }

    struct ScoutSourceDTO: Codable {
        let name: String
        let url: String?
    }

    struct ScoutUpdatePayload: Encodable {
        var name: String?
        var goal: String?
        var context: String?
        var sources: [ScoutSourceDTO]?
        var sensitivity: String?
        var analysisTier: String?
        var cadenceIntervalHours: Double?
        var cadenceMinIntervalHours: Double?
        var budgetTotal: Int?
        var endDate: String?
    }

    struct FindingFeedbackPayload: Encodable {
        let useful: Bool?
    }

    // MARK: - Response DTOs

    struct ScoutDTO: Decodable {
        let id: String
        let name: String
        let avatarLetter: String
        let avatarGradient: [String]
        let goal: String
        let context: String?
        let sources: [ScoutSourceDTO]
        let sensitivity: String
        let analysisTier: String?
        let cadenceIntervalHours: Double
        let cadenceMinIntervalHours: Double
        let cadenceCurrentIntervalHours: Double
        let cadenceReason: String?
        let budgetUsed: Int
        let budgetTotal: Int
        let status: String
        let statusLine: String?
        let bootstrapped: Bool?
        let endDate: Date?
        let nextRunAt: Date?
        let lastRun: Date?
        let findingsCount: Int?
        let createdAt: Date
    }

    struct FindingDTO: Decodable {
        let id: String
        let scoutId: String
        let scoutRunId: String?
        let type: String
        let title: String
        let description: String
        let sourceUrl: String?
        let sourceName: String
        let relevanceScore: Double?
        let reasoning: String
        let itemId: String?
        let feedbackUseful: Bool?
        let feedbackAt: Date?
        let itemCompleted: Bool?
        let createdAt: Date
    }

    struct FindingsPage: Decodable {
        let findings: [FindingDTO]
        let total: Int?
        let cursor: String?
    }

    /// The server merges `ScoutRun` and `ScoutActivity` rows into a single
    /// `entries` array where each item is tagged by `entryType`. We decode
    /// both shapes into one struct so the UI can iterate a homogeneous list.
    struct ActivityEntryDTO: Decodable {
        let entryType: String       // "run" | "activity"
        let id: String
        let createdAt: Date

        // Run-only fields
        let mode: String?
        let status: String?
        let resultCount: Int?
        let findingsCount: Int?
        let dismissedCount: Int?
        let reasoning: String?
        let durationMs: Int?
        let tokensUsed: Int?
        let error: String?

        // Activity-only fields
        let type: String?
        let description: String?
    }

    struct ActivityPage: Decodable {
        let entries: [ActivityEntryDTO]
        let cursor: String?
    }

    struct MemoryDTO: Decodable {
        let id: String
        let scoutId: String
        let type: String
        let content: String
        let confidence: Double
        let sourceRunIds: [String]?
        let status: String
        let createdAt: Date
        let updatedAt: Date
    }

    struct FindingFeedbackResponse: Decodable {
        let id: String
        let feedbackUseful: Bool?
        let feedbackAt: Date?
    }

    struct OKResponse: Decodable {
        let ok: Bool?
        let message: String?
    }

    // MARK: - Endpoints — scouts

    func fetchScoutList(status: String? = nil) async throws -> [ScoutDTO] {
        let path: String
        if let status, !status.isEmpty {
            path = "/scouts?status=\(status)"
        } else {
            path = "/scouts"
        }
        return try await request([ScoutDTO].self, path: path, method: "GET")
    }

    func fetchScoutDetail(id: String) async throws -> ScoutDTO {
        try await request(ScoutDTO.self, path: "/scouts/\(id)", method: "GET")
    }

    func createScout(_ payload: NewScoutPayload) async throws -> ScoutDTO {
        try await request(ScoutDTO.self, path: "/scouts", method: "POST", body: payload)
    }

    func updateScout(id: String, changes: ScoutUpdatePayload) async throws -> ScoutDTO {
        try await request(ScoutDTO.self, path: "/scouts/\(id)", method: "PUT", body: changes)
    }

    func deleteScout(id: String) async throws {
        _ = try await rawRequest(path: "/scouts/\(id)", method: "DELETE")
    }

    func pauseScout(id: String) async throws -> ScoutDTO {
        try await request(ScoutDTO.self, path: "/scouts/\(id)/pause", method: "POST")
    }

    func resumeScout(id: String) async throws -> ScoutDTO {
        try await request(ScoutDTO.self, path: "/scouts/\(id)/resume", method: "POST")
    }

    /// Archive is modelled as status=archived via PUT. Server may not accept
    /// this today — callers should treat errors as soft failures.
    func archiveScout(id: String) async throws -> ScoutDTO {
        struct ArchiveBody: Encodable { let status: String }
        return try await request(
            ScoutDTO.self,
            path: "/scouts/\(id)",
            method: "PUT",
            body: ArchiveBody(status: "archived")
        )
    }

    func triggerScoutRun(id: String) async throws {
        _ = try await request(
            OKResponse.self,
            path: "/scouts/\(id)/run",
            method: "POST"
        )
    }

    func triggerScoutConsolidation(id: String) async throws {
        _ = try await request(
            OKResponse.self,
            path: "/scouts/\(id)/consolidate",
            method: "POST"
        )
    }

    func clearScoutHistory(id: String) async throws {
        _ = try await rawRequest(path: "/scouts/\(id)/history", method: "DELETE")
    }

    // MARK: - Endpoints — findings

    func fetchScoutFindings(
        scoutId: String,
        type: String? = nil,
        cursor: String? = nil,
        limit: Int = 20
    ) async throws -> FindingsPage {
        var comps = URLComponents()
        comps.path = "/scouts/\(scoutId)/findings"
        var items: [URLQueryItem] = [URLQueryItem(name: "limit", value: String(limit))]
        if let type, !type.isEmpty { items.append(URLQueryItem(name: "type", value: type)) }
        if let cursor, !cursor.isEmpty { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        comps.queryItems = items
        let path = "\(comps.path)?\(comps.query ?? "")"
        return try await request(FindingsPage.self, path: path, method: "GET")
    }

    func submitFindingFeedback(
        scoutId: String,
        findingId: String,
        useful: Bool?
    ) async throws -> FindingFeedbackResponse {
        try await request(
            FindingFeedbackResponse.self,
            path: "/scouts/\(scoutId)/findings/\(findingId)/feedback",
            method: "POST",
            body: FindingFeedbackPayload(useful: useful)
        )
    }

    // MARK: - Endpoints — activity + memory

    func fetchScoutActivity(
        scoutId: String,
        cursor: String? = nil,
        limit: Int = 50
    ) async throws -> ActivityPage {
        var path = "/scouts/\(scoutId)/activity?limit=\(limit)"
        if let cursor, !cursor.isEmpty {
            // cursor is an ISO string; percent-encode to be safe
            let encoded = cursor.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? cursor
            path += "&cursor=\(encoded)"
        }
        return try await request(ActivityPage.self, path: path, method: "GET")
    }

    func fetchScoutMemories(scoutId: String, type: String? = nil) async throws -> [MemoryDTO] {
        var path = "/scouts/\(scoutId)/memories"
        if let type, !type.isEmpty {
            path += "?type=\(type)"
        }
        return try await request([MemoryDTO].self, path: path, method: "GET")
    }

    func deleteScoutMemory(scoutId: String, memoryId: String) async throws {
        _ = try await rawRequest(
            path: "/scouts/\(scoutId)/memories/\(memoryId)",
            method: "DELETE"
        )
    }
}
