import Foundation
import SwiftData

/// Marker protocol for every `@Model` that participates in the push/pull
/// sync engine. Lets generic helpers (e.g. the `fullSyncRequired` wipe
/// in `PullEngine`) read `_syncStatus` without resorting to `Mirror`
/// reflection, which is brittle against SwiftData macro output.
///
/// Every conformer already has `_syncStatus`, `_baseUpdatedAt`, and
/// `_lastError` stored properties (see `Item`, `ItemList`, etc.). The
/// protocol just exposes the sync-status field so the engine can
/// distinguish synced rows (safe to wipe on full-resync) from pending
/// rows (local mutations that must survive).
protocol SyncTrackedModel: PersistentModel {
    var _syncStatus: String { get set }
}

extension Item: SyncTrackedModel {}
extension ItemList: SyncTrackedModel {}
extension CalendarEvent: SyncTrackedModel {}
extension CalendarEventNote: SyncTrackedModel {}
extension Scout: SyncTrackedModel {}
extension ScoutFinding: SyncTrackedModel {}
extension BrettMessage: SyncTrackedModel {}
extension Attachment: SyncTrackedModel {}

extension SyncTrackedModel {
    /// Typed accessor that decodes the raw string. Keeps the protocol
    /// requirement simple (just the String) while giving call sites the
    /// enum form.
    var syncStatus: SyncStatus {
        SyncStatus(rawValue: _syncStatus) ?? .synced
    }
}
