import Foundation

/// Typed `APIClient` extensions for the `/things/:id` detail endpoint and
/// the item-link routes (`/things/:id/links`).
///
/// The detail endpoint is the canonical source of truth for an item's
/// attachments + links + brett messages — the sync engine does not hydrate
/// those today, so the task-detail view hits this endpoint on appear to
/// get fresh lists. The payload also embeds fresh presigned URLs for every
/// attachment so the client can open files without asking for a per-id
/// presigned URL (that endpoint doesn't exist yet).
@MainActor
extension APIClient {
    // MARK: - Detail response

    struct ThingDetailResponse: Decodable {
        let id: String
        let title: String
        let attachments: [AttachmentDetail]?
        let links: [LinkDetail]?
    }

    struct AttachmentDetail: Decodable {
        let id: String
        let filename: String
        let mimeType: String
        let sizeBytes: Int
        let url: String?      // fresh presigned URL, may be nil
        let createdAt: String?
    }

    struct LinkDetail: Decodable {
        let id: String
        let toItemId: String
        let toItemType: String
        let toItemTitle: String?
        let source: String?
        let createdAt: String?
    }

    func fetchThingDetail(id: String) async throws -> ThingDetailResponse {
        try await request(
            ThingDetailResponse.self,
            path: "/things/\(id)",
            method: "GET"
        )
    }

    // MARK: - Links

    struct CreateLinkResponse: Decodable {
        let id: String
        let toItemId: String
        let toItemType: String
        let createdAt: String?
    }

    struct CreateLinkBody: Encodable {
        let toItemId: String
        let toItemType: String
        let source: String
    }

    func createLink(fromItemId: String, toItemId: String, toItemType: String) async throws -> CreateLinkResponse {
        let body = CreateLinkBody(toItemId: toItemId, toItemType: toItemType, source: "manual")
        return try await request(
            CreateLinkResponse.self,
            path: "/things/\(fromItemId)/links",
            method: "POST",
            body: body
        )
    }

    func deleteLink(fromItemId: String, linkId: String) async throws {
        _ = try await rawRequest(
            path: "/things/\(fromItemId)/links/\(linkId)",
            method: "DELETE"
        )
    }
}
