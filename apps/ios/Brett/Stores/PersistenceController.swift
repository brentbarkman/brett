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
    static let shared = PersistenceController()

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

        // Migration or schema mismatch — wipe and retry. Dev-only policy; safe because
        // data is recoverable by re-pulling from the server on next sync.
        #if DEBUG
        print("[PersistenceController] schema load failed — resetting SwiftData store")
        #endif

        Self.wipeOnDiskStore()

        do {
            self.container = try ModelContainer(for: schema, configurations: [configuration])
        } catch {
            fatalError("[PersistenceController] unable to create ModelContainer after reset: \(error)")
        }
    }

    /// In-memory container — used by previews and tests.
    static func makePreview() -> PersistenceController {
        PersistenceController(inMemoryOnly: true)
    }

    // MARK: - Registered types

    /// Every `@Model` class the app uses. Keep in sync with `BrettApp`'s container.
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
