import Testing
import Foundation
@testable import Brett

/// Regression guard: every `try? context.save()` in the sync subsystem,
/// the SwiftData stores, and the views hides a real failure mode. Wave A
/// converted them all to logged saves; this test fails if a future change
/// reintroduces the pattern.
///
/// Initially scoped only to `Sync/`. Wave D's RSVP-save fix (a silent
/// `try?` in `Views/Detail/EventDetailView.swift`) demonstrated that the
/// guard's blast radius needed to widen — every place that touches a
/// `ModelContext.save()` benefits from the same discipline. The scan now
/// covers `Sync`, `Stores`, and `Views` (recursively, so subfolders like
/// `Views/Detail/` and `Stores/Chat/` are not skipped). New legitimate
/// exceptions (deliberately-best-effort cleanup, preview-only code) can
/// be added to the per-folder allowlists with a one-line justification.
///
/// The source directories are copied into the test bundle as folder
/// references (`Sync`, `Stores`, `Views` resources in `project.yml`)
/// because iOS simulator sandboxing blocks reading source paths off the
/// host filesystem at test runtime. The bundled copies are regenerated
/// every build, so they always reflect HEAD.
@Suite("Silent try? save guard", .tags(.sync))
struct SilentTrySaveGuardTests {
    /// File names under `Sync/` allowed to use `try? <ctx>.save()`.
    /// Empty by default — every site must either log or be allowlisted
    /// with a one-line comment justifying the choice.
    private static let syncAllowlist: Set<String> = []

    /// File names under `Stores/` allowed to use `try? <ctx>.save()`.
    private static let storesAllowlist: Set<String> = []

    /// File names under `Views/` allowed to use `try? <ctx>.save()`.
    /// `TodayPage.swift` contains a single `try? context.save()` inside
    /// a `#Preview` block where the seeded fixtures are throw-away — a
    /// failed save in a SwiftUI preview is acceptable (it shows up as
    /// an empty preview canvas rather than a runtime crash). Production
    /// code paths in TodayPage do NOT use silent saves.
    private static let viewsAllowlist: Set<String> = [
        "TodayPage.swift",
    ]

    @Test func noTryQuestionContextSaveInSyncDirectory() throws {
        try assertNoSilentSaves(folderResource: "Sync", allowlist: Self.syncAllowlist)
    }

    @Test func noTryQuestionContextSaveInStoresDirectory() throws {
        try assertNoSilentSaves(folderResource: "Stores", allowlist: Self.storesAllowlist)
    }

    @Test func noTryQuestionContextSaveInViewsDirectory() throws {
        try assertNoSilentSaves(folderResource: "Views", allowlist: Self.viewsAllowlist)
    }

    /// Walk a folder reference shipped inside the test bundle, scan every
    /// `.swift` file for the `try? <something>.save(` pattern, and fail
    /// the suite with a list of offenders if any are found.
    private func assertNoSilentSaves(folderResource: String, allowlist: Set<String>) throws {
        // The folder reference in `project.yml` ships the directory under
        // its on-disk name inside the test bundle's resources.
        let bundle = Bundle(for: SilentTrySaveGuardAnchor.self)
        guard let directory = bundle.url(forResource: folderResource, withExtension: nil) else {
            Issue.record("""
                Could not find `\(folderResource)` folder reference in BrettTests bundle.
                Verify project.yml still copies `Brett/\(folderResource)` as a folder
                resource (type: folder, buildPhase: resources) under the
                BrettTests target.
                """)
            return
        }

        let fileManager = FileManager.default
        // Recursive enumeration so subfolders (e.g. `Views/Detail/`,
        // `Stores/Chat/`) are not silently skipped — iOS Views are
        // hierarchical and a `try? ctx.save(` lurking three levels deep
        // would otherwise slip past the guard.
        guard let enumerator = fileManager.enumerator(
            at: directory,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else {
            Issue.record("Could not enumerate \(directory.path)")
            return
        }

        var swiftPaths: [URL] = []
        for case let fileURL as URL in enumerator where fileURL.pathExtension == "swift" {
            swiftPaths.append(fileURL)
        }

        var offenders: [String] = []
        for fileURL in swiftPaths {
            let contents = try String(contentsOf: fileURL, encoding: .utf8)
            // Match `try? <something>.save(` — the pattern we eliminated.
            let pattern = #"try\?\s+\w+(\.\w+)*\.save\("#
            let regex = try NSRegularExpression(pattern: pattern)
            let range = NSRange(contents.startIndex..., in: contents)
            let matches = regex.matches(in: contents, range: range)
            if !matches.isEmpty {
                let fileName = fileURL.lastPathComponent
                if !allowlist.contains(fileName) {
                    offenders.append("\(fileName): \(matches.count) occurrence(s)")
                }
            }
        }

        // Sanity check: if the resource bundling silently dropped the
        // sources (folder ref misconfigured, build cache stale), the guard
        // would always pass. Fail loudly instead.
        #expect(swiftPaths.count > 0, """
            Scanned 0 Swift files under \(directory.path) — the guard
            cannot detect regressions. Re-run xcodegen and check that
            `Brett/\(folderResource)` is still listed as a folder resource for
            BrettTests in project.yml.
            """)

        #expect(offenders.isEmpty, """
            Found `try? <ctx>.save(` in \(folderResource) directory — these silently
            swallow errors. Replace with do/catch + BrettLog, or add the file to
            the allowlist with a comment explaining why.
            \(offenders.joined(separator: "\n"))
            """)
    }
}

/// Anchor class so `Bundle(for:)` returns the BrettTests bundle, which is
/// where the folder references land at build time.
private final class SilentTrySaveGuardAnchor {}
