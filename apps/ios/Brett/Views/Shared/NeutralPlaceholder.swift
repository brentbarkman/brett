import SwiftUI

/// Manually-overlaid placeholder for TextField/SecureField.
///
/// SwiftUI's `TextField(text:prompt:label:)` init on iOS 18/26 silently
/// ignores `.foregroundStyle` on the `prompt:` Text and renders the hint
/// in the system accent color — which is the iOS default blue, visually
/// identical to our brand cerulean. Cerulean is reserved for Brett AI
/// surfaces (Brett's Take, chat, Scouts, semantic search badges), so
/// placeholders must never render in it. Putting the placeholder in an
/// overlay gives us full control over its color.
///
/// Usage:
/// ```swift
/// NeutralPlaceholder("Search everything", isEmpty: query.isEmpty) {
///     TextField("", text: $query)
///         .foregroundStyle(.white)
/// }
/// ```
///
/// For multi-line (vertical-axis) fields pass `.topLeading` so the hint
/// anchors to the top of the growing field.
struct NeutralPlaceholder<Content: View>: View {
    let placeholder: String
    let isEmpty: Bool
    var alignment: Alignment = .leading
    @ViewBuilder let content: () -> Content

    init(
        _ placeholder: String,
        isEmpty: Bool,
        alignment: Alignment = .leading,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.placeholder = placeholder
        self.isEmpty = isEmpty
        self.alignment = alignment
        self.content = content
    }

    var body: some View {
        ZStack(alignment: alignment) {
            if isEmpty {
                Text(placeholder)
                    .foregroundStyle(BrettColors.textPlaceholder)
                    .allowsHitTesting(false)
            }
            content()
        }
    }
}
