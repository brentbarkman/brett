import Foundation
import SwiftData

/// Owns the single `ModelContainer` for the app.
///
/// Responsible for:
///  1. Registering every `@Model` type (domain + sync infra).
///  2. Gracefully handling schema migrations — in development we log the
///     failure and reset the store rather than crashing the process. Once
///     there are users on production data we will swap this for a proper
///     `SchemaMigrationPlan`.
@MainActor
final class PersistenceController {
    #if DEBUG
    /// Backing storage for `shared`. Tests can swap this out by calling
    /// `PersistenceController.configureForTesting(inMemory:)` before any
    /// view code reads `.shared`. Ordinary app startup just reads the
    /// lazily-initialised on-disk container.
    nonisolated(unsafe) private static var _shared: PersistenceController?
    static var shared: PersistenceController {
        if let existing = _shared { return existing }
        let fresh = PersistenceController()
        _shared = fresh
        return fresh
    }

    /// Swap the shared controller to an in-memory instance. Only called from
    /// `BrettApp` during UI-test launches. No-op once any view has read the
    /// current shared instance.
    static func configureForTesting(inMemory: Bool) {
        guard inMemory else { return }
        _shared = PersistenceController(inMemoryOnly: true)
    }
    #else
    static let shared = PersistenceController()
    #endif

    let container: ModelContainer

    /// Expose a shared main-context for quick reads (stores keep their own).
    var mainContext: ModelContext { container.mainContext }

    private init(inMemoryOnly: Bool = false) {
        let schema = Schema(Self.modelTypes)
        let configuration = ModelConfiguration(
            schema: schema,
            isStoredInMemoryOnly: inMemoryOnly
        )

        // First attempt — respect the existing on-disk store.
        if let container = try? ModelContainer(for: schema, configurations: [configuration]) {
            self.container = container
            return
        }

        // Schema mismatch (most often after a model change between builds).
        // We wipe the on-disk store and retry so the next app launch starts
        // clean. This blocks the main thread — the call runs inside the
        // synchronous @main initializer before the first frame renders, so
        // a slow wipe flashes a black launch screen a bit longer. Kept
        // synchronous intentionally: proper async recovery needs a
        // loading-splash UI that we haven't wired yet.
        //
        // Migrations on real user data will need this replaced with a
        // proper SchemaMigrationPlan before v1 ships broadly — dropping
        // the user's local mirror isn't OK when they have queued
        // mutations that haven't pushed yet. For now the engineering
        // cost/reward ratio argues for the log-loud-wipe approach since
        // the fallback only fires on developer-machine schema drift.
        BrettLog.app.error("PersistenceController schema load failed — wiping on-disk store and retrying")

        Self.wipeOnDiskStore()

        do {
            self.container = try ModelContainer(for: schema, configurations: [configuration])
        } catch {
            // Hard fatal: the container is required for any SwiftUI view
            // to bind to @Query, so there's no sensible recovery if the
            // second attempt also fails. At least surface the underlying
            // error in the crash log instead of silently swallowing it.
            BrettLog.app.error("PersistenceController post-wipe retry failed: \(String(describing: error), privacy: .public)")
            fatalError("PersistenceController unable to create ModelContainer after reset: \(error)")
        }
    }

    /// In-memory container — used by previews and tests.
    static func makePreview() -> PersistenceController {
        PersistenceController(inMemoryOnly: true)
    }

    // MARK: - Registered types

    /// Every `@Model` class the app uses. Keep in sync with `BrettApp`'s container.
    /// When adding a new @Model here, also add it to `wipeAllData()` so sign-out
    /// clears it on account switch.
    static let modelTypes: [any PersistentModel.Type] = [
        // Domain
        Item.self,
        ItemList.self,
        CalendarEvent.self,
        CalendarEventNote.self,
        Scout.self,
        ScoutFinding.self,
        BrettMessage.self,
        Attachment.self,
        UserProfile.self,

        // Sync infrastructure
        MutationQueueEntry.self,
        SyncCursor.self,
        ConflictLogEntry.self,
        SyncHealth.self,
        AttachmentUpload.self,
    ]

    // MARK: - Sign-out wipe

    /// Deletes every row from the shared model context and commits. Called
    /// from `AuthManager.signOut` so a subsequent sign-in on the same
    /// device starts with an empty local database — without this, views
    /// that read live `@Query` results would briefly render the prior
    /// user's rows before the sync engine overwrites them, and sync
    /// cursors would falsely report "I already have everything up to X".
    func wipeAllData() {
        Self.wipeAllData(in: mainContext)
    }

    /// Static form exposed for tests — callers in production should use
    /// the instance method against the shared `mainContext`.
    static func wipeAllData(in context: ModelContext) {
        deleteAll(Item.self, in: context)
        deleteAll(ItemList.self, in: context)
        deleteAll(CalendarEvent.self, in: context)
        deleteAll(CalendarEventNote.self, in: context)
        deleteAll(Scout.self, in: context)
        deleteAll(ScoutFinding.self, in: context)
        deleteAll(BrettMessage.self, in: context)
        deleteAll(Attachment.self, in: context)
        deleteAll(UserProfile.self, in: context)
        deleteAll(MutationQueueEntry.self, in: context)
        deleteAll(SyncCursor.self, in: context)
        deleteAll(ConflictLogEntry.self, in: context)
        deleteAll(SyncHealth.self, in: context)
        deleteAll(AttachmentUpload.self, in: context)
        do {
            try context.save()
        } catch {
            // wipeAllData runs as part of sign-out. A silent failure here
            // used to mean the next user's SwiftData still contained the
            // previous user's rows — exactly the multi-user data-leak
            // scenario CLAUDE.md forbids. Surface the error so it shows up
            // in sysdiagnose and any future observability hook picks it up.
            BrettLog.store.error("PersistenceController wipeAllData save failed: \(String(describing: error), privacy: .public)")
        }
    }

    private static func deleteAll<T: PersistentModel>(_ type: T.Type, in context: ModelContext) {
        let rows = (try? context.fetch(FetchDescriptor<T>())) ?? []
        for row in rows {
            context.delete(row)
        }
    }

    // MARK: - Reset helper

    private static func wipeOnDiskStore() {
        let fm = FileManager.default
        guard let appSupport = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return }
        let possibleFilenames = ["default.store", "default.store-shm", "default.store-wal"]
        for filename in possibleFilenames {
            let url = appSupport.appendingPathComponent(filename)
            if fm.fileExists(atPath: url.path) {
                try? fm.removeItem(at: url)
            }
        }
    }
}
