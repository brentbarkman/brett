import Foundation

/// Payload written by the share extension into the App Group queue directory.
/// The main app reads these files on scenePhase `.active` and reconciles them
/// into SwiftData (see `ShareIngestor`).
///
/// Shared between the extension target and the main app target via xcodegen
/// source inclusion — do not import anything here beyond Foundation so the
/// extension stays tiny.
///
/// ## Wire format
///
/// JSON file on disk, one per captured share. File naming convention:
///
/// - `{id}.pending.json` — extension hasn't confirmed a successful POST yet
/// - `{id}.posted.json` — extension's POST to `/sync/push` succeeded
///
/// The main app uses the file suffix to decide the initial `_syncStatus` of
/// the inserted Item (`.pendingCreate` vs `.synced`).
struct SharePayload: Codable, Equatable, Sendable {
    /// Becomes `Item.id` on the server. Generated client-side so the
    /// extension's POST, the queue file, and the main app's reconciliation
    /// all reference the same entity.
    let id: String

    /// Per-mutation idempotency key. Reused when the main app re-POSTs the
    /// mutation after an extension failure — the server recognizes the retry
    /// and returns the cached response instead of creating a duplicate.
    let idempotencyKey: String

    /// ID of the user who was signed in at share time. Stamped into the
    /// payload so `ShareIngestor` can refuse to import it into a different
    /// account — prevents the "user A shares → user B signs in → items
    /// flow into user B's account" class of mistake on shared devices.
    ///
    /// `nil` is accepted (means the extension couldn't resolve a user-id —
    /// likely no main-app launch since install). Ingestor treats `nil`
    /// payloads conservatively: inserts only if the current user is the
    /// only user the app has ever seen; otherwise moves to `failed/`.
    let userId: String?

    /// "content" when a URL was shared; "task" when only plain text.
    let type: String

    /// The Item's title. For URL shares this is the URL itself (gets
    /// replaced by the fetched page title once extraction runs). For text
    /// shares this is the truncated text content.
    let title: String

    /// The shared URL, when one was present. Always `http` or `https`
    /// scheme — the share extension rejects other schemes at input time.
    let sourceUrl: String?

    /// Free-form notes. Populated only when the share sheet offered BOTH a
    /// URL and selected text (e.g., sharing an article from Messages with
    /// a quoted passage). Text-only shares put the text in `title`.
    let notes: String?

    /// Always `"ios_share"` — lets triage surfaces show where the item came
    /// from and lets us filter / analyse usage later.
    let source: String

    /// Creation timestamp, captured in the extension process. The main app
    /// writes this into `Item.createdAt` so ordering is stable regardless
    /// of when reconciliation runs.
    let createdAt: Date
}

// MARK: - Builder

extension SharePayload {
    /// Size caps. The share extension truncates overly-long shared content
    /// before persisting — a rogue source app shouldn't be able to fill
    /// the App Group container with a single captured share.
    enum Limits {
        static let titleMaxChars: Int = 500
        static let notesMaxBytes: Int = 10_000      // ~10KB of UTF-8
        static let urlMaxChars: Int = 2_048         // common browser cap
    }

    /// Build a payload from the raw URL/text the share extension extracted
    /// from `NSItemProvider`s. Returns nil if there's nothing worth saving
    /// (empty input, non-http URL with no text fallback, etc).
    ///
    /// Kept as a pure function so it's easy to unit-test without touching
    /// iOS's share-extension infrastructure.
    static func build(
        url: URL?,
        text: String?,
        userId: String? = nil,
        now: Date = Date()
    ) -> SharePayload? {
        let sanitisedUrl = url.flatMap(Self.sanitise(url:))
        let sanitisedText = text.flatMap(Self.sanitise(text:))

        // URL takes precedence: even if we also have text, URL defines the
        // Item type. The text (if any) becomes the notes field.
        if let urlString = sanitisedUrl {
            return SharePayload(
                id: UUID().uuidString,
                idempotencyKey: UUID().uuidString,
                userId: userId,
                type: "content",
                title: urlString.truncated(to: Limits.titleMaxChars),
                sourceUrl: urlString,
                notes: sanitisedText.flatMap { Self.truncate(notes: $0) },
                source: "ios_share",
                createdAt: now
            )
        }

        // Text only: becomes a task.
        if let textValue = sanitisedText {
            return SharePayload(
                id: UUID().uuidString,
                idempotencyKey: UUID().uuidString,
                userId: userId,
                type: "task",
                title: textValue.truncated(to: Limits.titleMaxChars),
                sourceUrl: nil,
                notes: nil,
                source: "ios_share",
                createdAt: now
            )
        }

        // Nothing worth saving.
        return nil
    }

    // MARK: - Sanitisation

    /// Accept only `http`/`https` URLs with a non-empty host. Rejects
    /// `javascript:`, `data:`, `file:`, `about:`, `mailto:`, etc — the
    /// share sheet can technically feed us any of those, and forwarding a
    /// `javascript:` URL to the server has no business value plus widens
    /// attack surface.
    private static func sanitise(url: URL) -> String? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = components.host,
              !host.isEmpty else {
            return nil
        }

        let absolute = url.absoluteString
        guard absolute.count <= Limits.urlMaxChars else {
            return nil
        }
        return absolute
    }

    /// Trim whitespace, return nil if empty. Does NOT truncate — callers
    /// apply per-field truncation based on whether the text will end up
    /// in `title` or `notes`.
    private static func sanitise(text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// Truncate text by BYTE count (not character count) so it fits a
    /// sane serialised size. Cuts on a character boundary to avoid
    /// producing invalid UTF-8.
    private static func truncate(notes: String) -> String {
        let data = Data(notes.utf8)
        if data.count <= Limits.notesMaxBytes {
            return notes
        }
        // Find the largest prefix whose UTF-8 encoding is ≤ the byte cap.
        // `String.Index`-based prefix is O(n) but shared content is bounded.
        var cut = notes.endIndex
        while cut > notes.startIndex {
            cut = notes.index(before: cut)
            let prefix = String(notes[..<cut])
            if Data(prefix.utf8).count <= Limits.notesMaxBytes {
                return prefix
            }
        }
        return ""
    }
}

private extension String {
    func truncated(to max: Int) -> String {
        guard count > max else { return self }
        // Leave room for a terminal ellipsis for readability.
        let keep = Swift.max(0, max - 1)
        return String(prefix(keep)) + "…"
    }
}
