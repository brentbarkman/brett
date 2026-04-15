import Testing
import Foundation
@testable import Brett

/// Guards against silent breakage of raw-value enums that are shared with
/// the API over the wire. A typo in a raw value would decode `nil` at runtime
/// and silently drop data; these tests catch that at build time.
@Suite("Enums", .tags(.models))
struct EnumsTests {
    // MARK: - ItemStatus

    @Test func itemStatusRawValuesAreStable() {
        #expect(ItemStatus.active.rawValue == "active")
        #expect(ItemStatus.snoozed.rawValue == "snoozed")
        #expect(ItemStatus.done.rawValue == "done")
        #expect(ItemStatus.archived.rawValue == "archived")
    }

    @Test func itemStatusRoundTrip() {
        for status in ItemStatus.allCases {
            let raw = status.rawValue
            #expect(ItemStatus(rawValue: raw) == status)
        }
    }

    @Test func itemStatusRawValuesAreUnique() {
        let raws = ItemStatus.allCases.map(\.rawValue)
        #expect(Set(raws).count == raws.count)
    }

    // MARK: - Urgency

    @Test func urgencyRawValuesAreStable() {
        #expect(Urgency.overdue.rawValue == "overdue")
        #expect(Urgency.today.rawValue == "today")
        #expect(Urgency.thisWeek.rawValue == "this_week")
        #expect(Urgency.nextWeek.rawValue == "next_week")
        #expect(Urgency.later.rawValue == "later")
        #expect(Urgency.done.rawValue == "done")
    }

    @Test func urgencyRoundTrip() {
        for urgency in Urgency.allCases {
            let raw = urgency.rawValue
            #expect(Urgency(rawValue: raw) == urgency)
        }
    }

    @Test func urgencyRawValuesAreUnique() {
        let raws = Urgency.allCases.map(\.rawValue)
        #expect(Set(raws).count == raws.count)
    }

    // MARK: - SyncStatus

    @Test func syncStatusRawValuesAreStable() {
        // The on-the-wire strings — do not change without a migration plan.
        #expect(SyncStatus.synced.rawValue == "synced")
        #expect(SyncStatus.pendingCreate.rawValue == "pending_create")
        #expect(SyncStatus.pendingUpdate.rawValue == "pending_update")
        #expect(SyncStatus.pendingDelete.rawValue == "pending_delete")
        #expect(SyncStatus.provisional.rawValue == "provisional")
        #expect(SyncStatus.conflict.rawValue == "conflict")
        #expect(SyncStatus.dead.rawValue == "dead")
    }

    @Test func syncStatusRoundTripForAllKnownValues() {
        // SyncStatus doesn't conform to CaseIterable — enumerate explicitly.
        let all: [SyncStatus] = [
            .synced,
            .pendingCreate,
            .pendingUpdate,
            .pendingDelete,
            .provisional,
            .conflict,
            .dead,
        ]
        for status in all {
            #expect(SyncStatus(rawValue: status.rawValue) == status)
        }
    }

    @Test func syncStatusRawValuesAreUnique() {
        let all: [SyncStatus] = [
            .synced,
            .pendingCreate,
            .pendingUpdate,
            .pendingDelete,
            .provisional,
            .conflict,
            .dead,
        ]
        let raws = all.map(\.rawValue)
        #expect(Set(raws).count == raws.count)
    }

    @Test func syncStatusUnknownRawValueDecodesToNil() {
        #expect(SyncStatus(rawValue: "this_value_should_never_exist") == nil)
    }

    @Test func syncStatusLegacyAliasesResolveToNewCases() {
        // `.pending` and `.failed` are kept as compatibility aliases. They
        // must continue to point at the canonical new cases.
        #expect(SyncStatus.pending == .pendingUpdate)
        #expect(SyncStatus.failed == .dead)
    }

    // MARK: - MutationAction (wire protocol)

    @Test func mutationActionUsesUppercaseRawValues() {
        // The API expects "CREATE" / "UPDATE" / "DELETE" — do not lowercase.
        #expect(MutationAction.create.rawValue == "CREATE")
        #expect(MutationAction.update.rawValue == "UPDATE")
        #expect(MutationAction.delete.rawValue == "DELETE")
        #expect(MutationAction.custom.rawValue == "CUSTOM")
    }

    // MARK: - ItemType

    @Test func itemTypeRoundTrip() {
        for type in ItemType.allCases {
            #expect(ItemType(rawValue: type.rawValue) == type)
        }
    }

    // MARK: - ScoutStatus

    @Test func scoutStatusRawValuesAreStable() {
        #expect(ScoutStatus.active.rawValue == "active")
        #expect(ScoutStatus.paused.rawValue == "paused")
        #expect(ScoutStatus.completed.rawValue == "completed")
        #expect(ScoutStatus.expired.rawValue == "expired")
        #expect(ScoutStatus.archived.rawValue == "archived")
    }
}
