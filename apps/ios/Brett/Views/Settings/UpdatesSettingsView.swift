import SwiftUI

/// About / version info. Desktop has a "check for updates" button but iOS
/// receives updates via TestFlight / the App Store, so we just show the
/// current build info.
struct UpdatesSettingsView: View {
    var body: some View {
        BrettSettingsScroll {
            VStack(alignment: .leading, spacing: 8) {
                BrettSettingsSection("About") {
                    infoRow("Version", value: appVersion)
                    BrettSettingsDivider()
                    infoRow("Build", value: buildNumber)
                    BrettSettingsDivider()
                    infoRow("Platform", value: "iOS")
                }

                Text("iOS updates are delivered through TestFlight or the App Store. The desktop app updates itself in place.")
                    .font(.system(size: 12))
                    .foregroundStyle(BrettColors.textMeta)
                    .padding(.horizontal, 4)
            }
        }
        .navigationTitle("About")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.hidden, for: .navigationBar)
    }

    @ViewBuilder
    private func infoRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(BrettColors.textMeta)
            Spacer()
            Text(value)
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(BrettColors.textCardTitle)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
    }

    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
    }
}
