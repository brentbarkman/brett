import SwiftUI

/// About / version info. Desktop has a "check for updates" button but iOS
/// receives updates via TestFlight / the App Store, so we just show the
/// current build info.
struct UpdatesSettingsView: View {
    var body: some View {
        ZStack {
            BackgroundView()

            Form {
                Section {
                    infoRow("Version", value: appVersion)
                    infoRow("Build", value: buildNumber)
                    infoRow("Platform", value: "iOS")
                } header: {
                    sectionHeader("About")
                } footer: {
                    Text("iOS updates are delivered through TestFlight or the App Store. The desktop app updates itself in place.")
                        .font(.system(size: 12))
                        .foregroundStyle(BrettColors.textMeta)
                }
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("About")
        .navigationBarTitleDisplayMode(.inline)
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
        .listRowBackground(glassRowBackground)
    }

    @ViewBuilder
    private func sectionHeader(_ title: String) -> some View {
        Text(title.uppercased())
            .font(BrettTypography.sectionLabel)
            .tracking(2.4)
            .foregroundStyle(BrettColors.sectionLabelColor)
    }

    private var glassRowBackground: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(.thinMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5)
            )
    }

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
    }

    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
    }
}
