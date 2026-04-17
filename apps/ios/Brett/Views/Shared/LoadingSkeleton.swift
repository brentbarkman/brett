import SwiftUI

/// Shimmering placeholder rows shown while the initial sync is still
/// pulling data. Intended as a drop-in replacement for `EmptyState` while
/// `SyncHealth.lastSuccessfulPullAt == nil` — i.e. the very first pull
/// after sign-in hasn't completed yet.
///
/// Without this, views render `EmptyState` for a frame or two until
/// SwiftData receives the freshly-synced rows. That "your inbox is empty
/// … just kidding, here are 47 things" flash is what the user flagged.
///
/// A soft opacity pulse (not a moving gradient) keeps the CPU cost near
/// zero while still signalling "this is transient, not the real empty
/// state."
struct TaskListPlaceholder: View {
    /// How many skeleton rows to render. Three is enough to feel like
    /// "content is on its way" without committing to a specific count.
    var rowCount: Int = 3

    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<rowCount, id: \.self) { index in
                TaskSkeletonRow()
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)

                if index < rowCount - 1 {
                    Divider()
                        .background(BrettColors.hairline)
                        .padding(.horizontal, 16)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading")
    }
}

/// A single skeleton row. Mimics a TaskRow's layout (circle + two text
/// blocks) so the transition from placeholder to real data is visually
/// continuous rather than a pop.
struct TaskSkeletonRow: View {
    @State private var pulse = false

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(Color.white.opacity(0.08))
                .frame(width: 22, height: 22)

            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(Color.white.opacity(0.08))
                    .frame(height: 14)
                    .frame(maxWidth: .infinity)

                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(Color.white.opacity(0.05))
                    .frame(height: 11)
                    .frame(maxWidth: 120)
            }

            Spacer(minLength: 0)
        }
        .opacity(pulse ? 0.55 : 1.0)
        .animation(
            .easeInOut(duration: 1.2).repeatForever(autoreverses: true),
            value: pulse
        )
        .onAppear { pulse = true }
    }
}

#Preview("Placeholder") {
    ZStack {
        Color.black.ignoresSafeArea()
        TaskListPlaceholder()
    }
}
