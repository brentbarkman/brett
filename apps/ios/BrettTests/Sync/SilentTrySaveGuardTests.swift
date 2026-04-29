import Testing
import Foundation
@testable import Brett

/// Regression guard: every `try? context.save()` in the sync subsystem
/// hides a real failure mode. Phase 4 of Wave A converted them all to
/// logged saves. This test fails if a future change reintroduces the
/// pattern. New legitimate exceptions (deliberately-best-effort cleanup)
/// can be added to `allowlist`.
///
/// The Sync source directory is copied into the test bundle as a folder
/// reference (`Sync` resource in `project.yml`) because iOS simulator
/// sandboxing blocks reading source paths off the host filesystem at test
/// runtime. The bundled copy is regenerated every build, so it always
/// reflects HEAD.
@Suite("Silent try? save guard", .tags(.sync))
struct SilentTrySaveGuardTests {
    /// File-relative paths under `Sync/` allowed to use `try? <ctx>.save()`.
    /// Empty by default — every site must either log or be allowlisted with
    /// a one-line comment justifying the choice.
    private static let allowlist: Set<String> = []

    @Test func noTryQuestionContextSaveInSyncDirectory() throws {
        // The folder reference in `project.yml` ships the directory under
        // its on-disk name (`Sync`) inside the test bundle's resources.
        let bundle = Bundle(for: SyncBundleAnchor.self)
        guard let syncDirectory = bundle.url(forResource: "Sync", withExtension: nil) else {
            Issue.record("""
                Could not find `Sync` folder reference in BrettTests bundle.
                Verify project.yml still copies `Brett/Sync` as a folder
                resource (type: folder, buildPhase: resources) under the
                BrettTests target.
                """)
            return
        }

        let fileManager = FileManager.default
        // Use `contentsOfDirectory(atPath:)` so a missing directory throws
        // instead of silently returning an empty enumerator (which would
        // mask the test's eyes and let regressions through).
        let topLevelEntries = try fileManager.contentsOfDirectory(atPath: syncDirectory.path)
        let swiftPaths = topLevelEntries
            .filter { $0.hasSuffix(".swift") }
            .map { syncDirectory.appendingPathComponent($0) }

        var offenders: [String] = []
        for fileURL in swiftPaths {
            let contents = try String(contentsOf: fileURL, encoding: .utf8)
            // Match `try? <something>.save(` — the pattern we eliminated.
            let pattern = #"try\?\s+\w+(\.\w+)*\.save\("#
            let regex = try NSRegularExpression(pattern: pattern)
            let range = NSRange(contents.startIndex..., in: contents)
            let matches = regex.matches(in: contents, range: range)
            if !matches.isEmpty {
                let relativePath = fileURL.lastPathComponent
                if !Self.allowlist.contains(relativePath) {
                    offenders.append("\(relativePath): \(matches.count) occurrence(s)")
                }
            }
        }

        // Sanity check: if the resource bundling silently dropped the
        // sources (folder ref misconfigured, build cache stale), the guard
        // would always pass. Fail loudly instead.
        #expect(swiftPaths.count > 0, """
            Scanned 0 Swift files under \(syncDirectory.path) — the guard
            cannot detect regressions. Re-run xcodegen and check that
            `Brett/Sync` is still listed as a folder resource for
            BrettTests in project.yml.
            """)

        #expect(offenders.isEmpty, """
            Found `try? <ctx>.save(` in sync directory — these silently swallow
            errors. Replace with do/catch + BrettLog, or add the file to the
            allowlist with a comment explaining why.
            \(offenders.joined(separator: "\n"))
            """)
    }
}

/// Anchor class so `Bundle(for:)` returns the BrettTests bundle, which is
/// where the Sync folder reference lands at build time.
private final class SyncBundleAnchor {}
