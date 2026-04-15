import Foundation
import Observation
import SwiftData

/// Read-only facade — Scouts + findings are server-owned. Mutations
/// (create/update/run) happen through API endpoints + SSE push.
@MainActor
@Observable
final class ScoutStore {
    private let context: ModelContext

    init(context: ModelContext) {
        self.context = context
    }

    convenience init() {
        self.init(context: PersistenceController.shared.mainContext)
    }

    func fetchScouts(includeArchived: Bool = false) -> [Scout] {
        var descriptor = FetchDescriptor<Scout>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        descriptor.predicate = #Predicate { scout in
            scout.deletedAt == nil
        }
        let scouts = (try? context.fetch(descriptor)) ?? []
        if includeArchived {
            return scouts
        }
        return scouts.filter { $0.status != ScoutStatus.archived.rawValue }
    }

    func fetchScout(id: String) -> Scout? {
        var descriptor = FetchDescriptor<Scout>()
        descriptor.predicate = #Predicate { $0.id == id }
        descriptor.fetchLimit = 1
        return try? context.fetch(descriptor).first
    }

    func fetchFindings(scoutId: String) -> [ScoutFinding] {
        var descriptor = FetchDescriptor<ScoutFinding>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        descriptor.predicate = #Predicate { finding in
            finding.scoutId == scoutId && finding.deletedAt == nil
        }
        return (try? context.fetch(descriptor)) ?? []
    }

    /// Activity feed for a scout. Placeholder — the activity table isn't in the
    /// mobile sync contract yet, so for now we synthesise from findings.
    func fetchActivity(scoutId: String) -> [ScoutFinding] {
        fetchFindings(scoutId: scoutId)
    }
}
