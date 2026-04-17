import SwiftUI

/// Centered empty-state view used across list screens.
///
/// Three shapes are supported:
///  - `heading + body`           → prominent empty state (e.g. Inbox, Upcoming)
///  - `body only`                → quieter copy (e.g. "Nothing on the books today")
///  - `heading + body + action`  → prominent empty state with a gold CTA
///
/// Typography follows the spec:
///  - heading: 26pt bold, white
///  - body:    15pt regular, white/50
///  - 12pt line spacing between them
///
/// Fades in 200ms on appear so the state doesn't pop.
struct EmptyState: View {
    // SwiftUI's `View` protocol requires a computed `body: some View` property,
    // which conflicts with storing a `body: String`. Store under a different
    // name internally and expose the `body:` label on the initializer.
    private let heading: String?
    private let message: String
    private let action: (() -> Void)?
    private let actionLabel: String?

    // Internal fade-in state — flipped once on appear.
    @State private var hasAppeared = false

    // MARK: - Init

    /// Designated initializer matching the spec's contract.
    init(
        heading: String?,
        body: String,
        action: (() -> Void)? = nil,
        actionLabel: String? = nil
    ) {
        self.heading = heading
        self.message = body
        self.action = action
        self.actionLabel = actionLabel
    }

    /// Back-compat initializer for existing callers using `copy:` as the label
    /// for the body text. Kept so we don't have to edit other agent folders.
    init(heading: String?, copy: String) {
        self.init(heading: heading, body: copy, action: nil, actionLabel: nil)
    }

    // MARK: - Body

    var body: some View {
        VStack(spacing: 8) {
            if let heading {
                Text(heading)
                    .font(BrettTypography.emptyHeading)
                    // Electron uses text-white/90 for the heading. Pure
                    // white was too loud against the muted body copy.
                    .foregroundStyle(Color.white.opacity(0.90))
                    .multilineTextAlignment(.center)
            }
            Text(message)
                .font(BrettTypography.emptyCopy)
                // text-white/40 in Electron — slightly subtler than the
                // /0.50 we had, helps the heading land first.
                .foregroundStyle(Color.white.opacity(0.40))
                .multilineTextAlignment(.center)

            if let action, let actionLabel {
                Button(action: action) {
                    Text(actionLabel)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.black.opacity(0.85))
                        .padding(.horizontal, 18)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 999, style: .continuous)
                                .fill(BrettColors.gold)
                        )
                }
                .buttonStyle(.plain)
                .padding(.top, 4)
            }
        }
        .padding(.horizontal, 40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .opacity(hasAppeared ? 1 : 0)
        .animation(.easeInOut(duration: 0.2), value: hasAppeared)
        .onAppear { hasAppeared = true }
    }
}

#Preview("Inbox") {
    ZStack {
        Color.black.ignoresSafeArea()
        EmptyState(heading: "Your inbox", body: "Everything worth doing starts here.")
    }
}

#Preview("Body only") {
    ZStack {
        Color.black.ignoresSafeArea()
        EmptyState(heading: nil, body: "Nothing on the books today. A rare opening — use it well.")
    }
}

#Preview("With action") {
    ZStack {
        Color.black.ignoresSafeArea()
        EmptyState(
            heading: "No scouts yet",
            body: "Create one to watch the web for you.",
            action: {},
            actionLabel: "Create scout"
        )
    }
}
