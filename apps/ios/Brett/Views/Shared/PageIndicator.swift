import SwiftUI

struct PageIndicator: View {
    let pages: [String]
    let currentIndex: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(pages.enumerated()), id: \.offset) { index, name in
                Circle()
                    .fill(index == currentIndex ? BrettColors.gold : Color.white.opacity(0.25))
                    .frame(width: index == currentIndex ? 7 : 5, height: index == currentIndex ? 7 : 5)
                    .animation(.spring(response: 0.3, dampingFraction: 0.7), value: currentIndex)
            }
        }
    }
}
