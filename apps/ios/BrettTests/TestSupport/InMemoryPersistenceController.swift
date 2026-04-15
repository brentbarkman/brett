import Foundation
import SwiftData
@testable import Brett

/// Creates a fresh, isolated `ModelContainer` backed by an in-memory store,
/// so each test starts with zero data and leaves nothing behind on disk.
///
/// This mirrors the schema registered in `BrettApp.swift`. Keep the model
/// list in sync when new `@Model` types are added to production.
enum InMemoryPersistenceController {
    /// The full production schema, kept in one place so tests and app stay
    /// aligned. Update this alongside `BrettApp.swift`'s `modelContainer(for:)`.
    static let schema: [any PersistentModel.Type] = [
        Item.self,
        ItemList.self,
        CalendarEvent.self,
        Scout.self,
        ScoutFinding.self,
        BrettMessage.self,
        Attachment.self,
        UserProfile.self,
    ]

    /// Build a `ModelContainer` backed purely by memory. Safe to call once
    /// per test; the container lifetime bounds the data.
    static func makeContainer() throws -> ModelContainer {
        let schema = Schema(Self.schema)
        let config = ModelConfiguration(
            "BrettTests",
            schema: schema,
            isStoredInMemoryOnly: true,
            allowsSave: true
        )
        return try ModelContainer(for: schema, configurations: [config])
    }

    /// Convenience: build an in-memory container and return a fresh main-actor
    /// `ModelContext` bound to it. Grab this when a single test just needs to
    /// insert a handful of fixtures and query them.
    @MainActor
    static func makeContext() throws -> ModelContext {
        let container = try makeContainer()
        return ModelContext(container)
    }
}
