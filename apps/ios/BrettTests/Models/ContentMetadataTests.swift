import Foundation
import Testing
@testable import Brett

/// Pins the contract between the API's `contentMetadata` JSON shape (see
/// `packages/types/src/index.ts` `ContentMetadata`) and Swift's typed
/// decoder. Field-name drift between the two sides is exactly how iOS
/// previously read `metadata["username"]` against an API that wrote
/// `author` — silent rendering bug for every tweet. These tests fail the
/// build instead of the user.
@Suite("ContentMetadata decoding", .tags(.models))
struct ContentMetadataTests {

    private func decode(_ json: String) throws -> ContentMetadata? {
        let item = TestFixtures.makeItem()
        item.contentMetadata = json
        return item.contentMetadataTyped
    }

    @Test func decodesTweetWithAuthorAndText() throws {
        let json = """
        {"type":"tweet","author":"_amankishore","tweetText":"hello world"}
        """
        let result = try decode(json)
        guard case .tweet(let m) = result else {
            Issue.record("expected .tweet, got \(String(describing: result))")
            return
        }
        #expect(m.author == "_amankishore")
        #expect(m.tweetText == "hello world")
    }

    @Test func tweetMetadataConvenienceUnwrapsAuthor() throws {
        let item = TestFixtures.makeItem()
        item.contentMetadata = #"{"type":"tweet","author":"vercel"}"#
        #expect(item.tweetMetadata?.author == "vercel")
    }

    @Test func tweetMetadataConvenienceReturnsNilForOtherTypes() throws {
        let item = TestFixtures.makeItem()
        item.contentMetadata = #"{"type":"video","embedUrl":"https://x"}"#
        #expect(item.tweetMetadata == nil)
    }

    @Test func decodesArticleWithWordCount() throws {
        let json = #"{"type":"article","wordCount":1234}"#
        let result = try decode(json)
        guard case .article(let m) = result else {
            Issue.record("expected .article")
            return
        }
        #expect(m.wordCount == 1234)
    }

    @Test func decodesNewsletter() throws {
        let json = #"{"type":"newsletter","senderName":"Stratechery","receivedAt":"2026-04-25T12:00:00Z"}"#
        let result = try decode(json)
        guard case .newsletter(let m) = result else {
            Issue.record("expected .newsletter")
            return
        }
        #expect(m.senderName == "Stratechery")
        #expect(m.receivedAt == "2026-04-25T12:00:00Z")
    }

    @Test func decodesPdfAndWebPageMarkers() throws {
        #expect({ if case .pdf = try? decode(#"{"type":"pdf"}"#) ?? .unknown("") { return true } else { return false } }())
        #expect({ if case .webPage = try? decode(#"{"type":"web_page"}"#) ?? .unknown("") { return true } else { return false } }())
    }

    @Test func unknownTypeFallsThroughToUnknown() throws {
        let json = #"{"type":"podcast_v2","embedUrl":"x"}"#
        let result = try decode(json)
        guard case .unknown(let t) = result else {
            Issue.record("expected .unknown")
            return
        }
        #expect(t == "podcast_v2")
    }

    @Test func malformedJsonReturnsNil() throws {
        let result = try decode("not json")
        #expect(result == nil)
    }

    @Test func missingTypeDiscriminatorReturnsNil() throws {
        let result = try decode(#"{"author":"x"}"#)
        #expect(result == nil)
    }
}
