import Foundation

/// Typed mirror of `ContentMetadata` from `packages/types/src/index.ts`.
///
/// `Item.contentMetadata` is stored as a JSON string (server union type
/// discriminated by `type`). Reading it as a raw `[String: Any]` dictionary
/// in every preview is how we ended up with `metadata["username"]` against
/// an API that writes `author` — silent drift, no compile-time check.
///
/// This enum is the single decode point. Add a new variant here and Swift's
/// exhaustiveness check forces every consumer to handle it.
enum ContentMetadata: Decodable, Equatable {
    case tweet(TweetMeta)
    case video(VideoMeta)
    case podcast(PodcastMeta)
    case article(ArticleMeta)
    case newsletter(NewsletterMeta)
    case pdf
    case webPage
    /// Server sent a `type` we don't know yet — older clients on a newer
    /// server. Treated as "no usable metadata" by callers.
    case unknown(String)

    struct TweetMeta: Decodable, Equatable {
        let author: String?
        let tweetText: String?
        let embedHtml: String?
    }

    struct VideoMeta: Decodable, Equatable {
        let embedUrl: String?
        let channel: String?
    }

    struct PodcastMeta: Decodable, Equatable {
        let embedUrl: String?
        let provider: String?       // "spotify" | "apple"
        let episodeName: String?
        let showName: String?
    }

    struct ArticleMeta: Decodable, Equatable {
        let wordCount: Int?
    }

    struct NewsletterMeta: Decodable, Equatable {
        let senderName: String?
        let receivedAt: String?
    }

    private enum DiscriminatorKey: String, CodingKey { case type }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DiscriminatorKey.self)
        let type = try container.decode(String.self, forKey: .type)
        let single = try decoder.singleValueContainer()
        switch type {
        case "tweet":      self = .tweet(try single.decode(TweetMeta.self))
        case "video":      self = .video(try single.decode(VideoMeta.self))
        case "podcast":    self = .podcast(try single.decode(PodcastMeta.self))
        case "article":    self = .article(try single.decode(ArticleMeta.self))
        case "newsletter": self = .newsletter(try single.decode(NewsletterMeta.self))
        case "pdf":        self = .pdf
        case "web_page":   self = .webPage
        default:           self = .unknown(type)
        }
    }
}

extension Item {
    /// Decoded view of `contentMetadata`. Returns `nil` when the field is
    /// empty, malformed, or missing the `type` discriminator. Cheap enough
    /// to call per-render — JSON is small.
    var contentMetadataTyped: ContentMetadata? {
        guard let json = contentMetadata?.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(ContentMetadata.self, from: json)
    }

    /// Convenience: tweet variant fields, or `nil` if not a tweet.
    var tweetMetadata: ContentMetadata.TweetMeta? {
        if case .tweet(let m) = contentMetadataTyped { return m }
        return nil
    }
}
