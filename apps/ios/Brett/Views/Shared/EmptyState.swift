import SwiftUI

struct EmptyState: View {
    let heading: String?
    let copy: String

    var body: some View {
        VStack(spacing: 12) {
            if let heading {
                Text(heading)
                    .font(BrettTypography.emptyHeading)
                    .foregroundStyle(.white)
            }
            Text(copy)
                .font(BrettTypography.emptyCopy)
                .foregroundStyle(Color.white.opacity(0.50))
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
