import SwiftUI

/// Drag-to-reorder logic — pure, separable from SwiftUI.
///
/// Exposed at module scope so tests can exercise the reorder math without
/// building a SwiftUI view hierarchy.
enum DragReorderLogic {
    /// Reorder `ids` by pulling the element at `fromIndex` out and inserting
    /// it at `toIndex`. `toIndex` is the destination in the pre-move array
    /// (so moving [A,B,C,D] A to index 2 yields [B,C,A,D]).
    ///
    /// Invalid inputs return `ids` unchanged — safer than crashing a gesture
    /// mid-flight.
    static func reorderIDs(ids: [String], fromIndex: Int, toIndex: Int) -> [String] {
        guard ids.indices.contains(fromIndex) else { return ids }
        guard toIndex >= 0, toIndex < ids.count else { return ids }
        if fromIndex == toIndex { return ids }
        var mutable = ids
        let moved = mutable.remove(at: fromIndex)
        // After removal, `toIndex` is still the correct insertion point when
        // moving forward (indices shift down by one) — but we preserve the
        // "destination in pre-move array" semantic by clamping.
        let insertAt = min(toIndex, mutable.count)
        mutable.insert(moved, at: insertAt)
        return mutable
    }
}

/// Long-press + drag to reorder a single row in a non-`List` container.
///
/// Why not `List` / `.onMove`? Our sticky-card sections aren't `List`-backed
/// (they're `VStack` inside `StickyCardSection`), and moving them into a
/// plain `List` would lose the sticky-section aesthetic. This ViewModifier
/// opts in per-row: a 0.6 s press activates drag, a `DragGesture` tracks the
/// pointer, and a parent `@Binding var ids` is rewritten on drop.
///
/// Drag semantics:
///   - Requires 15 pt travel before the row is considered "picked up" —
///     stops accidental nudges from hijacking vertical scroll.
///   - Long-press during an active scroll will NOT activate: SwiftUI defers
///     simultaneous gestures, and we require the press to complete before
///     any drag movement.
///   - On lift: `.rigid` haptic, 1.02 scale, soft shadow.
///   - On release: `onReorder` called with the final id list, `.success`
///     haptic, row animates back to its row height.
struct DragReorderModifier: ViewModifier {
    let id: String
    let ids: [String]
    let rowHeight: CGFloat
    let onReorder: (_ newOrder: [String]) -> Void

    @State private var isPressed = false
    @State private var isDragging = false
    @State private var dragOffset: CGSize = .zero

    /// Travel (pt) before we consider finger movement "a drag" rather than
    /// an accidental wiggle. Matches the spec's 15 pt threshold.
    private let dragThreshold: CGFloat = 15

    func body(content: Content) -> some View {
        content
            .scaleEffect(isDragging ? 1.02 : 1.0)
            .shadow(
                color: isDragging ? Color.black.opacity(0.25) : .clear,
                radius: isDragging ? 12 : 0,
                x: 0,
                y: isDragging ? 6 : 0
            )
            .offset(y: dragOffset.height)
            .zIndex(isDragging ? 1 : 0)
            .gesture(
                LongPressGesture(minimumDuration: 0.6)
                    .onEnded { _ in
                        // Long-press completed → arm the drag.
                        HapticManager.rigid()
                        withAnimation(.spring(response: 0.25, dampingFraction: 0.7)) {
                            isPressed = true
                            isDragging = true
                        }
                    }
                    .sequenced(before: DragGesture(minimumDistance: 0, coordinateSpace: .local))
                    .onChanged { value in
                        switch value {
                        case .second(true, let drag?):
                            // Only start tracking once the user crosses the
                            // 15 pt threshold — otherwise micro-tremors after
                            // lift visibly jitter the row.
                            if abs(drag.translation.height) >= dragThreshold || isDragging {
                                dragOffset = drag.translation
                                maybeSwap(with: drag.translation.height)
                            }
                        default:
                            break
                        }
                    }
                    .onEnded { _ in
                        // Drop.
                        HapticManager.success()
                        withAnimation(.spring(response: 0.30, dampingFraction: 0.75)) {
                            dragOffset = .zero
                            isDragging = false
                            isPressed = false
                        }
                    }
            )
    }

    /// While dragging, translate vertical offset into a target index and
    /// swap with the current neighbour if we've crossed a row boundary.
    /// The @Binding-free API forces us to fully re-emit the id list on each
    /// boundary crossing — simpler than tracking partial state.
    private func maybeSwap(with verticalOffset: CGFloat) {
        guard let fromIndex = ids.firstIndex(of: id) else { return }
        let rowsMoved = Int((verticalOffset / rowHeight).rounded())
        let targetIndex = max(0, min(ids.count - 1, fromIndex + rowsMoved))
        guard targetIndex != fromIndex else { return }
        let newOrder = DragReorderLogic.reorderIDs(
            ids: ids,
            fromIndex: fromIndex,
            toIndex: targetIndex
        )
        onReorder(newOrder)
        HapticManager.selectionChanged()
    }
}

extension View {
    /// Wire a row up for drag-to-reorder inside a non-`List` container.
    /// `ids` is the authoritative source of truth — when a swap happens,
    /// `onReorder` is called with the new list and the caller must commit it.
    func reorderable(
        id: String,
        ids: [String],
        rowHeight: CGFloat = 52,
        onReorder: @escaping (_ newOrder: [String]) -> Void
    ) -> some View {
        modifier(
            DragReorderModifier(
                id: id,
                ids: ids,
                rowHeight: rowHeight,
                onReorder: onReorder
            )
        )
    }
}
