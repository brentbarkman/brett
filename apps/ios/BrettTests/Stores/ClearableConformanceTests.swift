import Testing
import Foundation
@testable import Brett

/// Regression guard: every store in the Stores/ directory must conform to
/// `Clearable`. The check is two-step:
///
///  1. Compare a curated list of expected store types against the actual
///     `.swift` files on disk under `Stores/`. If a new file appears that
///     looks like a store, the test fails — author must add it to the list.
///  2. Each entry is compile-checked at the bottom: a generic helper that
///     only accepts `Clearable` types validates conformance.
///
/// Like `SilentTrySaveGuardTests`, the Stores directory is copied into the
/// test bundle as a folder reference (see `project.yml`) because iOS
/// simulator sandboxing blocks reading host paths off the filesystem at
/// test runtime.
@Suite("Clearable conformance", .tags(.smoke))
@MainActor
struct ClearableConformanceTests {
    /// Curated list. Add entries when new stores ship. Each is also referenced
    /// in `assertConformance` below — that reference is what enforces the
    /// `Clearable` constraint at compile time.
    ///
    /// Non-store helpers under `Stores/` (e.g. `ModelContextSaving.swift`,
    /// `PersistenceController.swift`, `ClearableStoreRegistry.swift`) appear
    /// here so the on-disk-vs-curated equality check passes, but they do not
    /// need a `Clearable`-conformance entry below.
    private static let expectedStores: [String] = [
        "AIProviderStore.swift",
        "AttachmentStore.swift",
        "BriefingStore.swift",
        "CalendarAccountsStore.swift",
        "CalendarStore.swift",
        "ChatStore.swift",
        "ClearableStoreRegistry.swift",
        "ItemStore.swift",
        "ListStore.swift",
        "MessageStore.swift",
        "ModelContextSaving.swift",
        "NewsletterStore.swift",
        "PersistenceController.swift",
        "ScoutStore.swift",
        "SearchStore.swift",
        "SelectionStore.swift",
        "UserProfileStore.swift",
    ]

    @Test func curatedStoreListMatchesFilesOnDisk() throws {
        let bundle = Bundle(for: StoresBundleAnchor.self)
        guard let storesDirectory = bundle.url(forResource: "Stores", withExtension: nil) else {
            Issue.record("""
                Could not find `Stores` folder reference in BrettTests bundle.
                Verify project.yml still copies `Brett/Stores` as a folder
                resource (type: folder, buildPhase: resources) under the
                BrettTests target.
                """)
            return
        }

        let fm = FileManager.default
        let onDisk = try fm.contentsOfDirectory(atPath: storesDirectory.path)
            .filter { $0.hasSuffix(".swift") }
            .sorted()

        let expected = Self.expectedStores.sorted()
        #expect(onDisk == expected, """
            New file appeared (or one was removed) in Stores/. Update the
            `expectedStores` list AND ensure any new store conforms to
            `Clearable` + registers in init.
            On disk:  \(onDisk)
            Expected: \(expected)
            """)
    }

    /// Compile-time conformance check. The body intentionally references the
    /// types — if any of them stops conforming to `Clearable`, the build
    /// fails before the test even runs.
    @Test func storesConformToClearable() {
        assertConformance(AIProviderStore.self)
        assertConformance(AttachmentStore.self)
        assertConformance(BriefingStore.self)
        assertConformance(CalendarAccountsStore.self)
        assertConformance(CalendarStore.self)
        assertConformance(ChatStore.self)
        assertConformance(ItemStore.self)
        assertConformance(ListStore.self)
        assertConformance(MessageStore.self)
        assertConformance(NewsletterStore.self)
        assertConformance(ScoutStore.self)
        assertConformance(SearchStore.self)
        assertConformance(SelectionStore.self)
        assertConformance(UserProfileStore.self)
    }

    private func assertConformance<T: Clearable>(_ type: T.Type) {
        // No runtime assertion — the generic constraint enforces this at
        // compile time. The call exists to anchor the type into the test.
        _ = type
    }
}

/// Anchor class so `Bundle(for:)` returns the BrettTests bundle, which is
/// where the Stores folder reference lands at build time.
private final class StoresBundleAnchor {}
