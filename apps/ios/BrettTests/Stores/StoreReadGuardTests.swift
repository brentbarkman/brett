import Testing
import Foundation
@testable import Brett

/// Wave B removed all public read methods from `ItemStore` and
/// `ListStore`. Views must use `@Query` instead. This guard fails
/// if a future change re-exposes a read method on either type.
///
/// Only methods that look like reads are flagged: any function whose
/// name starts with `fetch`, `find`, `read`, or `query` and is not
/// marked `private` will trip the regex.
///
/// The Stores source directory is copied into the test bundle as a
/// folder reference (`StoresSourcesForGuard` resource in `project.yml`)
/// because iOS simulator sandboxing blocks reading source paths off the
/// host filesystem at test runtime. The bundled copy is regenerated
/// every build, so it always reflects HEAD.
@Suite("Store read-method guard", .tags(.smoke))
struct StoreReadGuardTests {
    @Test func itemStoreHasNoPublicFetchMethods() throws {
        try assertNoPublicReads(in: "ItemStore.swift")
    }

    @Test func listStoreHasNoPublicFetchMethods() throws {
        try assertNoPublicReads(in: "ListStore.swift")
    }

    private func assertNoPublicReads(in fileName: String) throws {
        // Resolve the bundled `Stores` folder reference from the test
        // bundle. Mirrors the pattern from SilentTrySaveGuardTests.
        guard let storesDirectory = Bundle(for: StoreReadGuardAnchor.self)
            .url(forResource: "Stores", withExtension: nil) else {
            Issue.record("""
                Could not find `Stores` folder reference in BrettTests bundle.
                Verify project.yml still copies `Brett/Stores` as a folder
                resource (type: folder, buildPhase: resources) under the
                BrettTests target.
                """)
            return
        }

        let url = storesDirectory.appendingPathComponent(fileName)
        let contents = try String(contentsOf: url, encoding: .utf8)

        // Match `func fetch...` / `func find...` / `func read...` / `func query...`
        // when not preceded by `private` on the same line. The grep guard is
        // crude but effective — it doesn't try to parse the file, just flags
        // suspicious shapes for human review.
        let pattern = #"^\s*(?:internal\s+|public\s+)?func\s+(?:fetch|find|read|query)\w*"#
        let regex = try NSRegularExpression(pattern: pattern, options: [.anchorsMatchLines])
        let range = NSRange(contents.startIndex..., in: contents)
        let allMatches = regex.matches(in: contents, range: range)

        // Map each match back to its line so we can filter out anything
        // marked `private`. NSRegularExpression's `.anchorsMatchLines` makes
        // `^` line-relative, so each match's range starts at the beginning
        // of its line; we walk the file's lines once instead of doing a
        // linear scan per match.
        let lines = contents.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)

        // Build a (start-offset → line-index) map by walking the file once.
        var lineStartOffsets: [Int] = []
        var offset = 0
        for line in lines {
            lineStartOffsets.append(offset)
            // +1 for the newline split removed.
            offset += line.utf16.count + 1
        }

        let offenders = allMatches.compactMap { match -> String? in
            let location = match.range.location
            // Find the line whose start-offset is the largest <= location.
            var lo = 0
            var hi = lineStartOffsets.count - 1
            var lineIndex = 0
            while lo <= hi {
                let mid = (lo + hi) / 2
                if lineStartOffsets[mid] <= location {
                    lineIndex = mid
                    lo = mid + 1
                } else {
                    hi = mid - 1
                }
            }
            let line = lines[lineIndex]
            return line.contains("private") ? nil : line.trimmingCharacters(in: .whitespaces)
        }

        #expect(offenders.isEmpty, """
            \(fileName) re-exposed a public/internal read method (fetch/find/read/query).
            Wave B removed these — callers must use `@Query` or a direct
            `FetchDescriptor` instead.

            Offenders:
            \(offenders.joined(separator: "\n"))
            """)
    }
}

/// Anchor class so `Bundle(for:)` returns the BrettTests bundle, which is
/// where the Stores folder reference lands at build time.
private final class StoreReadGuardAnchor {}
