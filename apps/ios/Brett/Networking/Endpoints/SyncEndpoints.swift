import Foundation

/// Typed wrappers for the two `/sync` endpoints on the API.
///
/// The push/pull protocol is defined in `packages/types/src/sync.ts` and
/// mirrored server-side in `apps/api/src/routes/sync.ts`. We keep the Swift
/// decoders defensive: unknown tables are skipped, unknown statuses fall
/// back to `.error`, and missing keys are treated as empty.
///
/// The response decoders deliberately parse `record`, `upserted`, and
/// `deleted` as loose JSON (`[String: Any]`), rather than generic types.
/// Each synced entity has different shapes (Item vs CalendarEvent vs Scout),
/// and strongly-typed decoding here would force either per-table endpoints
/// or a massive sum type. Loose parsing + per-entity `SyncEntityMapper`
/// conversion keeps complexity contained to one place.

// MARK: - Protocol constants

enum SyncProtocol {
    /// Bumped server-side whenever the wire format changes. Keep in sync
    /// with `CURRENT_PROTOCOL_VERSION` in `apps/api/src/routes/sync.ts`.
    static let version: Int = 1

    /// Optional client-side override for the per-table page size. Nil
    /// means "let the server pick per-table defaults" — that's the right
    /// answer post the server's keyset-merge fix, where defaults are
    /// items=50 (large rows) and others=200 (metadata). Setting this
    /// non-nil applies one value to ALL tables (legacy single-knob
    /// behavior; needed only for tests that want a deterministic page
    /// boundary).
    static let defaultPullLimit: Int? = nil

    /// The canonical list of tables the pull engine tracks. Order matches
    /// the server's `SYNC_TABLES` constant.
    static let tables: [String] = [
        "lists",
        "items",
        "calendar_events",
        "calendar_event_notes",
        "scouts",
        "scout_findings",
        "brett_messages",
        "attachments",
    ]
}

// MARK: - Response models

/// Per-mutation outcome from `/sync/push`.
///
/// `record` is a loosely-typed dict because the server returns the entire
/// affected Prisma record (whose shape varies per table). Consumers route
/// through `SyncEntityMapper` to convert it into the right `@Model` type.
struct SyncPushResult {
    enum Status: String {
        case applied
        case merged
        case conflict
        case error
        case notFound = "not_found"
    }

    let idempotencyKey: String
    let status: Status
    let record: [String: Any]?
    let conflictedFields: [String]
    let error: String?

    /// Loose parser — matches the defensive posture of the rest of the
    /// sync layer. Unknown statuses fall through as `.error` so the push
    /// engine can still make forward progress.
    static func parse(_ dict: [String: Any]) -> SyncPushResult? {
        guard let key = dict["idempotencyKey"] as? String,
              let statusRaw = dict["status"] as? String else {
            return nil
        }
        let status = Status(rawValue: statusRaw) ?? .error
        return SyncPushResult(
            idempotencyKey: key,
            status: status,
            record: dict["record"] as? [String: Any],
            conflictedFields: dict["conflictedFields"] as? [String] ?? [],
            error: dict["error"] as? String
        )
    }
}

/// Decoded `/sync/push` response.
struct SyncPushResponse {
    let results: [SyncPushResult]
    let serverTime: String

    static func parse(_ data: Data) throws -> SyncPushResponse {
        let dict = try parseObject(data)
        let rawResults = dict["results"] as? [[String: Any]] ?? []
        let results = rawResults.compactMap(SyncPushResult.parse)
        let serverTime = dict["serverTime"] as? String ?? ""
        return SyncPushResponse(results: results, serverTime: serverTime)
    }
}

/// Per-table slice of a `/sync/pull` response.
struct SyncPullTableChanges {
    let upserted: [[String: Any]]
    let deleted: [String]
    let hasMore: Bool

    static func parse(_ dict: [String: Any]) -> SyncPullTableChanges {
        SyncPullTableChanges(
            upserted: dict["upserted"] as? [[String: Any]] ?? [],
            deleted: dict["deleted"] as? [String] ?? [],
            hasMore: dict["hasMore"] as? Bool ?? false
        )
    }
}

/// Decoded `/sync/pull` response.
struct SyncPullResponse {
    /// Per-table upserts / tombstones, keyed by canonical table name.
    let changes: [String: SyncPullTableChanges]
    /// New server cursor per table. Only tables with activity since the last
    /// sync appear here — absent tables keep their previous cursor.
    let cursors: [String: String]
    let serverTime: String
    /// When true, the client should wipe local cursors and full-resync.
    /// Server sets this on stale cursor detection (>30 days).
    let fullSyncRequired: Bool

    static func parse(_ data: Data) throws -> SyncPullResponse {
        let dict = try parseObject(data)
        let rawChanges = dict["changes"] as? [String: [String: Any]] ?? [:]
        let changes = rawChanges.reduce(into: [String: SyncPullTableChanges]()) { acc, pair in
            acc[pair.key] = SyncPullTableChanges.parse(pair.value)
        }
        let cursors = dict["cursors"] as? [String: String] ?? [:]
        let serverTime = dict["serverTime"] as? String ?? ""
        let fullSyncRequired = dict["fullSyncRequired"] as? Bool ?? false
        return SyncPullResponse(
            changes: changes,
            cursors: cursors,
            serverTime: serverTime,
            fullSyncRequired: fullSyncRequired
        )
    }
}

// MARK: - JSON helpers

/// Parse the top-level object from a JSON payload. Throws
/// `APIError.decodingFailed` on malformed data so callers can branch on it.
private func parseObject(_ data: Data) throws -> [String: Any] {
    do {
        guard let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw APIError.decodingFailed(SyncDecodingError.expectedObject)
        }
        return dict
    } catch let apiError as APIError {
        throw apiError
    } catch {
        throw APIError.decodingFailed(error)
    }
}

/// Narrow enum for JSON-shape errors in the sync layer.
enum SyncDecodingError: Error, CustomStringConvertible {
    case expectedObject

    var description: String {
        switch self {
        case .expectedObject: return "Expected JSON object at response root"
        }
    }
}

// MARK: - Request bodies

/// POST body for `/sync/push`. Encoded by hand because `mutations[i].payload`
/// holds arbitrary per-entity data which we already have as a dict; keeping
/// it untyped avoids double-encoding cost.
struct SyncPushRequestBody {
    /// Each element must be a JSON-serialisable dict with the keys described
    /// in the `SyncMutation` API shape (idempotencyKey, entityType, entityId,
    /// action, payload, changedFields?, previousValues?, baseUpdatedAt?).
    let mutations: [[String: Any]]

    func encode() throws -> Data {
        let dict: [String: Any] = [
            "protocolVersion": SyncProtocol.version,
            "mutations": mutations,
        ]
        return try JSONSerialization.data(withJSONObject: dict, options: [])
    }
}

/// POST body for `/sync/pull`. `null` cursors (first sync) are encoded as JSON null.
struct SyncPullRequestBody {
    let cursors: [String: String?]
    /// Optional override applied uniformly to all tables. Nil omits the
    /// `limit` field from the request entirely so the server's per-table
    /// defaults kick in (items=50 vs lists=200, etc.).
    let limit: Int?

    func encode() throws -> Data {
        // JSONSerialization requires NSNull for null values — wrap optionals.
        let encodedCursors: [String: Any] = cursors.reduce(into: [:]) { acc, pair in
            if let value = pair.value {
                acc[pair.key] = value
            } else {
                acc[pair.key] = NSNull()
            }
        }
        var dict: [String: Any] = [
            "protocolVersion": SyncProtocol.version,
            "cursors": encodedCursors,
        ]
        if let limit {
            dict["limit"] = limit
        }
        return try JSONSerialization.data(withJSONObject: dict, options: [])
    }
}

// MARK: - APIClient extension

extension APIClient {
    /// POST to `/sync/push`. Mutations must be valid JSON dicts; the sync
    /// layer pre-builds them from `MutationQueueEntry`. Returns the parsed
    /// response so callers can match results to mutations by idempotency key.
    func syncPush(mutations: [[String: Any]]) async throws -> SyncPushResponse {
        let body = try SyncPushRequestBody(mutations: mutations).encode()
        let (data, _) = try await rawRequest(
            path: "/sync/push",
            method: "POST",
            body: body
        )
        return try SyncPushResponse.parse(data)
    }

    /// POST to `/sync/pull` with per-table cursors. Pass `nil` for tables
    /// that have never been synced. `limit` defaults to nil → server
    /// applies per-table page sizes; set non-nil to force a uniform
    /// page size across every table (rarely useful outside tests).
    func syncPull(
        cursors: [String: String?],
        limit: Int? = SyncProtocol.defaultPullLimit
    ) async throws -> SyncPullResponse {
        let body = try SyncPullRequestBody(cursors: cursors, limit: limit).encode()
        let (data, _) = try await rawRequest(
            path: "/sync/pull",
            method: "POST",
            body: body
        )
        return try SyncPullResponse.parse(data)
    }
}
