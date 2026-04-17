import Testing
import Foundation
@testable import Brett

/// Unit tests for `SharePayload.build(url:text:)` — the pure function the
/// share extension uses to turn raw NSItemProvider content into a queue
/// payload. Covers the full decision table so behaviour changes light up
/// in review instead of landing silently.
@Suite("SharePayload.build")
struct SharePayloadTests {

    // MARK: - URL cases

    @Test func urlOnly_buildsContentItem() {
        let url = URL(string: "https://example.com/article")!
        let payload = SharePayload.build(url: url, text: nil)

        #expect(payload?.type == "content")
        #expect(payload?.sourceUrl == "https://example.com/article")
        #expect(payload?.title == "https://example.com/article")
        #expect(payload?.notes == nil)
        #expect(payload?.source == "ios_share")
    }

    @Test func urlAndText_urlWinsForType_textBecomesNotes() {
        let url = URL(string: "https://example.com/article")!
        let payload = SharePayload.build(url: url, text: "I agreed with this point.")

        #expect(payload?.type == "content")
        #expect(payload?.sourceUrl == "https://example.com/article")
        #expect(payload?.notes == "I agreed with this point.")
    }

    @Test func urlSchemeJavascript_rejectedEvenWithUrlInput() {
        let url = URL(string: "javascript:alert(1)")!
        let payload = SharePayload.build(url: url, text: nil)
        #expect(payload == nil)
    }

    @Test func urlSchemeData_rejected() {
        let url = URL(string: "data:text/html,<h1>hi</h1>")!
        let payload = SharePayload.build(url: url, text: nil)
        #expect(payload == nil)
    }

    @Test func urlSchemeFile_rejected() {
        let url = URL(string: "file:///etc/passwd")!
        let payload = SharePayload.build(url: url, text: nil)
        #expect(payload == nil)
    }

    @Test func urlSchemeMailto_rejected() {
        let url = URL(string: "mailto:foo@bar.com")!
        let payload = SharePayload.build(url: url, text: nil)
        #expect(payload == nil)
    }

    @Test func rejectedUrl_withAccompanyingText_fallsBackToTask() {
        let url = URL(string: "javascript:alert(1)")!
        let payload = SharePayload.build(url: url, text: "Call mom")

        #expect(payload?.type == "task")
        #expect(payload?.title == "Call mom")
        #expect(payload?.sourceUrl == nil)
    }

    @Test func urlLongerThanLimit_rejected() {
        // Build a URL whose absoluteString exceeds the 2KB cap.
        let longPath = String(repeating: "a", count: SharePayload.Limits.urlMaxChars)
        let url = URL(string: "https://example.com/\(longPath)")!
        let payload = SharePayload.build(url: url, text: nil)
        #expect(payload == nil)
    }

    // MARK: - Text cases

    @Test func textOnly_buildsTask() {
        let payload = SharePayload.build(url: nil, text: "Follow up with the agency")

        #expect(payload?.type == "task")
        #expect(payload?.title == "Follow up with the agency")
        #expect(payload?.sourceUrl == nil)
        #expect(payload?.notes == nil)
    }

    @Test func textWhitespaceOnly_rejected() {
        let payload = SharePayload.build(url: nil, text: "   \n\t  ")
        #expect(payload == nil)
    }

    @Test func emptyInputs_rejected() {
        let payload = SharePayload.build(url: nil, text: nil)
        #expect(payload == nil)
    }

    @Test func longTitle_truncatedWithEllipsis() {
        let longText = String(repeating: "x", count: 600)
        let payload = SharePayload.build(url: nil, text: longText)

        #expect(payload != nil)
        #expect(payload!.title.count == SharePayload.Limits.titleMaxChars)
        #expect(payload!.title.hasSuffix("…"))
    }

    @Test func longNotes_truncatedToByteBudget() {
        let url = URL(string: "https://example.com/article")!
        // 20KB of ASCII — well over the 10KB notes cap.
        let notesInput = String(repeating: "x", count: 20_000)
        let payload = SharePayload.build(url: url, text: notesInput)

        #expect(payload != nil)
        let byteCount = Data(payload!.notes!.utf8).count
        #expect(byteCount <= SharePayload.Limits.notesMaxBytes)
    }

    // MARK: - Identity & idempotency

    @Test func eachCallProducesFreshIds() {
        let url = URL(string: "https://example.com/a")!
        let a = SharePayload.build(url: url, text: nil)!
        let b = SharePayload.build(url: url, text: nil)!

        #expect(a.id != b.id, "item ids must not collide — duplicates would break client-side dedup")
        #expect(a.idempotencyKey != b.idempotencyKey, "idempotency keys must not collide")
    }

    @Test func createdAt_usesProvidedNow() {
        let pinned = Date(timeIntervalSince1970: 1_700_000_000)
        let payload = SharePayload.build(
            url: URL(string: "https://example.com"),
            text: nil,
            now: pinned
        )
        #expect(payload?.createdAt == pinned)
    }

    // MARK: - Codability

    @Test func payloadRoundTripsThroughJSON() throws {
        // Pin to whole-second precision so Codable's `.iso8601` date strategy
        // (which doesn't emit fractional seconds) round-trips exactly. The
        // production encoding path uses the same strategy — losing
        // sub-second precision is intended, matches what ShareIngestor
        // reads back, and doesn't affect any downstream consumer.
        let pinned = Date(timeIntervalSince1970: Double(Int(Date().timeIntervalSince1970)))
        let original = SharePayload.build(
            url: URL(string: "https://example.com/x"),
            text: "quote",
            now: pinned
        )!

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let encoded = try encoder.encode(original)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode(SharePayload.self, from: encoded)

        #expect(decoded == original, "round-trip encoding must preserve every field")
    }
}
