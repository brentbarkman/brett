import Testing
import Foundation
@testable import Brett

@Suite("NewsletterStore clear", .tags(.smoke))
@MainActor
struct NewsletterStoreClearTests {
    @Test func clearForSignOutDropsAllSenderState() throws {
        ClearableStoreRegistry.resetForTesting()
        let store = NewsletterStore()

        let sender = NewsletterSender(
            id: "sender-1",
            name: "Stratechery",
            email: "ben@stratechery.com",
            active: true
        )
        let pending = try makePendingNewsletterSender(
            id: "pending-1",
            senderEmail: "unknown@example.com"
        )
        store.injectForTesting(
            ingestAddress: "stale@brett.app",
            senders: [sender],
            pending: [pending]
        )
        #expect(store.senders.isEmpty == false)
        #expect(store.pending.isEmpty == false)
        #expect(store.ingestAddress != nil)

        ClearableStoreRegistry.clearAll()

        #expect(store.ingestAddress == nil)
        #expect(store.senders.isEmpty)
        #expect(store.pending.isEmpty)
        #expect(store.errorMessage == nil)
    }

    /// `PendingNewsletterSender` only exposes the `Decodable` init, so we
    /// build one via JSON decoding rather than reaching for a memberwise
    /// initializer that doesn't exist.
    private func makePendingNewsletterSender(
        id: String,
        senderEmail: String
    ) throws -> PendingNewsletterSender {
        let json: [String: Any] = [
            "id": id,
            "senderName": "Unknown sender",
            "senderEmail": senderEmail,
            "subject": "Hello",
            "receivedAt": ISO8601DateFormatter().string(from: Date()),
        ]
        let data = try JSONSerialization.data(withJSONObject: json)
        return try JSONDecoder().decode(PendingNewsletterSender.self, from: data)
    }
}
