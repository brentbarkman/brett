import Foundation
import SwiftData
import Testing
@testable import Brett

/// Tests that the `ContentPreview` dispatch table reads `item.contentType`
/// correctly and yields the expected resolved type. We don't render the
/// SwiftUI tree here — the `resolvedType` accessor is the contract.
///
/// This is the cheapest way to guarantee that a new backend-emitted
/// `contentType` string (say, `"blog_post"`) doesn't silently fall out of
/// the switch. The `ContentType` enum's raw-value mapping is the single
/// source of truth.
@MainActor
@Suite("ContentTypeDispatch", .tags(.views))
struct ContentTypeDispatchTests {

    // MARK: - Known types round-trip to the right enum

    @Test func newsletterMapsToNewsletter() throws {
        let preview = try makePreview(contentType: "newsletter")
        #expect(preview.resolvedType == .newsletter)
    }

    @Test func articleMapsToArticle() throws {
        let preview = try makePreview(contentType: "article")
        #expect(preview.resolvedType == .article)
    }

    @Test func tweetMapsToTweet() throws {
        let preview = try makePreview(contentType: "tweet")
        #expect(preview.resolvedType == .tweet)
    }

    @Test func pdfMapsToPdf() throws {
        let preview = try makePreview(contentType: "pdf")
        #expect(preview.resolvedType == .pdf)
    }

    @Test func videoMapsToVideo() throws {
        let preview = try makePreview(contentType: "video")
        #expect(preview.resolvedType == .video)
    }

    @Test func podcastMapsToPodcast() throws {
        let preview = try makePreview(contentType: "podcast")
        #expect(preview.resolvedType == .podcast)
    }

    @Test func webPageMapsToWebPage() throws {
        // Prisma uses snake_case on the wire — make sure the Swift enum's
        // raw-value alias "web_page" still maps through.
        let preview = try makePreview(contentType: "web_page")
        #expect(preview.resolvedType == .webPage)
    }

    // MARK: - Unknown and missing types

    @Test func missingContentTypeResolvesToNil() throws {
        let preview = try makePreview(contentType: nil)
        #expect(preview.resolvedType == nil)
    }

    @Test func unknownContentTypeResolvesToNil() throws {
        // Covered by the enum's failable init — the resolver must not
        // explode on backend values it doesn't recognise.
        let preview = try makePreview(contentType: "blog_post")
        #expect(preview.resolvedType == nil)
    }

    // MARK: - Helpers

    private func makePreview(contentType: String?) throws -> ContentPreview {
        let context = try InMemoryPersistenceController.makeContext()
        let item = TestFixtures.makeItem(
            type: .content,
            title: "Sample"
        )
        item.contentType = contentType
        item.contentTitle = "Some title"
        context.insert(item)
        return ContentPreview(item: item)
    }
}
