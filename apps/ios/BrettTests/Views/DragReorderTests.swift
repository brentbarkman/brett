import Foundation
import Testing
@testable import Brett

/// Covers the pure reorder math used by `DragReorderModifier`. The modifier
/// itself is a SwiftUI view — its gestures can't run headless — but all the
/// logic that matters for "where does row A land if I drop it at index N"
/// is captured in `DragReorderLogic.reorderIDs(...)` so we can unit-test
/// it directly without a UI.
@Suite("DragReorder", .tags(.views))
struct DragReorderTests {

    @Test("Moving the first item two slots later yields [B,C,A,D]")
    func moveFirstToMiddle() {
        let ids = ["A", "B", "C", "D"]
        let moved = DragReorderLogic.reorderIDs(ids: ids, fromIndex: 0, toIndex: 2)
        #expect(moved == ["B", "C", "A", "D"])
    }

    @Test("Moving the last item to the front yields [D,A,B,C]")
    func moveLastToFront() {
        let ids = ["A", "B", "C", "D"]
        let moved = DragReorderLogic.reorderIDs(ids: ids, fromIndex: 3, toIndex: 0)
        #expect(moved == ["D", "A", "B", "C"])
    }

    @Test("Same-index move is a no-op")
    func sameIndexIsNoOp() {
        let ids = ["A", "B", "C", "D"]
        let moved = DragReorderLogic.reorderIDs(ids: ids, fromIndex: 2, toIndex: 2)
        #expect(moved == ids)
    }

    @Test("Adjacent swap works in both directions")
    func adjacentSwap() {
        let ids = ["A", "B", "C", "D"]
        let forward = DragReorderLogic.reorderIDs(ids: ids, fromIndex: 1, toIndex: 2)
        #expect(forward == ["A", "C", "B", "D"])

        let backward = DragReorderLogic.reorderIDs(ids: ids, fromIndex: 2, toIndex: 1)
        #expect(backward == ["A", "C", "B", "D"])
    }

    @Test("Out-of-range fromIndex leaves the list unchanged (safety)")
    func outOfRangeFromIsSafe() {
        let ids = ["A", "B", "C"]
        let moved = DragReorderLogic.reorderIDs(ids: ids, fromIndex: 99, toIndex: 0)
        #expect(moved == ids)
    }

    @Test("Out-of-range toIndex leaves the list unchanged (safety)")
    func outOfRangeToIsSafe() {
        let ids = ["A", "B", "C"]
        let moved = DragReorderLogic.reorderIDs(ids: ids, fromIndex: 0, toIndex: -5)
        #expect(moved == ids)
    }

    @Test("Empty list produces empty result")
    func emptyListIsEmpty() {
        let moved = DragReorderLogic.reorderIDs(ids: [], fromIndex: 0, toIndex: 0)
        #expect(moved.isEmpty)
    }

    @Test("Single-item list is always unchanged")
    func singleItemIsUnchanged() {
        let ids = ["only"]
        let moved = DragReorderLogic.reorderIDs(ids: ids, fromIndex: 0, toIndex: 0)
        #expect(moved == ids)
    }

    @Test("Reorder preserves element identity — no duplicates or drops")
    func reorderPreservesSet() {
        let ids = ["A", "B", "C", "D", "E"]
        let moved = DragReorderLogic.reorderIDs(ids: ids, fromIndex: 0, toIndex: 3)
        #expect(Set(moved) == Set(ids), "reorder must not lose or duplicate elements")
        #expect(moved.count == ids.count)
    }
}
