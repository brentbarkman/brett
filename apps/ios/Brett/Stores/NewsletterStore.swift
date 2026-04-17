import Foundation
import Observation

/// In-memory store for newsletter settings. Not persisted through the sync
/// engine — settings flow through their own REST endpoints, same pattern as
/// `UserProfileStore`.
///
/// Endpoints (under `/newsletters` on the API):
/// - GET  /newsletters/ingest-address — auto-generates a per-user token
/// - GET  /newsletters — list of approved senders
/// - PATCH /newsletters/:id — toggle active/rename
/// - DELETE /newsletters/:id — remove
/// - GET  /newsletters/pending — unconfirmed senders
/// - POST /newsletters/:pendingId/approve — promote to active sender
/// - POST /newsletters/:pendingId/block — blocklist
@MainActor
@Observable
final class NewsletterStore {
    // Public state
    private(set) var ingestAddress: String? = nil
    private(set) var senders: [NewsletterSender] = []
    private(set) var pending: [PendingNewsletterSender] = []
    private(set) var isLoading: Bool = false
    var errorMessage: String? = nil

    private let client: APIClient

    init(client: APIClient = .shared) {
        self.client = client
    }

    // MARK: - Fetch

    func fetch() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        // Fire all three in parallel — they're independent.
        async let addressTask: IngestAddressResponse = client.request(
            path: "/newsletters/ingest-address",
            method: "GET"
        )
        async let sendersTask: [NewsletterSender] = client.request(
            path: "/newsletters",
            method: "GET"
        )
        async let pendingTask: [PendingNewsletterSender] = client.request(
            path: "/newsletters/pending",
            method: "GET"
        )

        do {
            let (addr, senders, pending) = try await (addressTask, sendersTask, pendingTask)
            self.ingestAddress = addr.ingestEmail
            self.senders = senders
            self.pending = pending
        } catch let apiError as APIError {
            errorMessage = apiError.userFacingMessage
        } catch {
            errorMessage = "Couldn't load newsletters."
        }
    }

    // MARK: - Mutations

    func updateSender(id: String, active: Bool) async {
        // Optimistic toggle — revert on failure.
        if let idx = senders.firstIndex(where: { $0.id == id }) {
            senders[idx].active = active
        }

        struct Payload: Encodable { let active: Bool }
        do {
            let _: NewsletterSender = try await client.request(
                path: "/newsletters/\(id)",
                method: "PATCH",
                body: Payload(active: active)
            )
        } catch {
            await fetch()
        }
    }

    func deleteSender(id: String) async {
        let backup = senders
        senders.removeAll { $0.id == id }

        do {
            let _: [String: Bool] = try await client.request(
                path: "/newsletters/\(id)",
                method: "DELETE"
            )
        } catch {
            senders = backup
        }
    }

    func approvePending(id: String) async {
        let backup = pending
        pending.removeAll { $0.id == id }

        struct ApproveResponse: Decodable {
            // Shape is {sender, item} — we only need to refresh senders afterward.
        }
        do {
            let _: ApproveResponse = try await client.request(
                path: "/newsletters/\(id)/approve",
                method: "POST"
            )
            // Refresh to pick up the new sender + any new items.
            await fetch()
        } catch {
            pending = backup
        }
    }

    func blockPending(id: String) async {
        let backup = pending
        pending.removeAll { $0.id == id }

        do {
            let _: [String: Bool] = try await client.request(
                path: "/newsletters/\(id)/block",
                method: "POST"
            )
        } catch {
            pending = backup
        }
    }
}

// MARK: - Models

struct NewsletterSender: Decodable, Identifiable {
    let id: String
    let name: String
    let email: String
    var active: Bool
}

struct PendingNewsletterSender: Decodable, Identifiable {
    let id: String
    let senderName: String
    let senderEmail: String
    let subject: String
    let receivedAt: Date

    enum CodingKeys: String, CodingKey {
        case id, senderName, senderEmail, subject, receivedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        senderName = try container.decode(String.self, forKey: .senderName)
        senderEmail = try container.decode(String.self, forKey: .senderEmail)
        subject = try container.decode(String.self, forKey: .subject)

        // `receivedAt` comes back as ISO 8601 — the shared APIClient decoder
        // already uses `.iso8601`, but we implement manually here to tolerate
        // older responses without fractional seconds.
        if let date = try? container.decode(Date.self, forKey: .receivedAt) {
            receivedAt = date
        } else {
            let raw = try container.decode(String.self, forKey: .receivedAt)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            receivedAt = formatter.date(from: raw)
                ?? ISO8601DateFormatter().date(from: raw)
                ?? Date()
        }
    }
}

struct IngestAddressResponse: Decodable {
    let ingestEmail: String?
}
