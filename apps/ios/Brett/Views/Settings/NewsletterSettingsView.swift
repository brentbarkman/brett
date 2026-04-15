import SwiftUI

/// Newsletter integration settings.
///
/// Three sections: a copy-able ingest address, a list of approved senders
/// with per-sender toggles, and a pending-approvals queue.
///
/// Backed by `NewsletterStore`. Mutations are optimistic; the store reverts
/// on failure and refreshes the list.
struct NewsletterSettingsView: View {
    @State private var store = NewsletterStore()
    @State private var copiedFlash = false

    var body: some View {
        ZStack {
            BackgroundView()

            Form {
                if let errorMessage = store.errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(BrettTypography.taskMeta)
                            .foregroundStyle(BrettColors.error)
                            .listRowBackground(glassRowBackground)
                    }
                }

                ingestAddressSection
                pendingSection
                sendersSection
            }
            .scrollContentBackground(.hidden)
            .refreshable { await store.fetch() }
        }
        .navigationTitle("Newsletters")
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.fetch() }
    }

    // MARK: - Sections

    @ViewBuilder
    private var ingestAddressSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                if let address = store.ingestAddress {
                    HStack {
                        Text(address)
                            .font(.system(.body, design: .monospaced))
                            .foregroundStyle(BrettColors.textCardTitle)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer()
                        Button {
                            UIPasteboard.general.string = address
                            copiedFlash = true
                            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                                copiedFlash = false
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: copiedFlash ? "checkmark" : "doc.on.doc")
                                Text(copiedFlash ? "Copied" : "Copy")
                            }
                            .font(BrettTypography.badge)
                            .foregroundStyle(BrettColors.gold)
                        }
                        .buttonStyle(.plain)
                    }
                } else {
                    Text("Address not available. Newsletters may not be configured on the server.")
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.textMeta)
                }
            }
            .listRowBackground(glassRowBackground)
        } header: {
            sectionHeader("Forward newsletters to")
        } footer: {
            Text("Forward a newsletter to this address and Brett will save it to your Inbox. New senders appear in Pending Approvals until you approve them.")
                .font(.system(size: 12))
                .foregroundStyle(BrettColors.textMeta)
        }
    }

    @ViewBuilder
    private var pendingSection: some View {
        if !store.pending.isEmpty {
            Section {
                ForEach(store.pending) { p in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(p.senderName)
                            .font(BrettTypography.taskTitle)
                            .foregroundStyle(BrettColors.textCardTitle)
                        Text(p.senderEmail)
                            .font(BrettTypography.taskMeta)
                            .foregroundStyle(BrettColors.textMeta)
                        Text(p.subject)
                            .font(BrettTypography.taskMeta)
                            .foregroundStyle(BrettColors.textSecondary)
                            .lineLimit(2)

                        HStack(spacing: 8) {
                            Button {
                                Task { await store.approvePending(id: p.id) }
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "checkmark.circle.fill")
                                    Text("Approve")
                                }
                                .font(BrettTypography.badge)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(BrettColors.success.opacity(0.15), in: Capsule())
                                .foregroundStyle(BrettColors.success)
                            }
                            .buttonStyle(.plain)

                            Button {
                                Task { await store.blockPending(id: p.id) }
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "xmark.circle.fill")
                                    Text("Block")
                                }
                                .font(BrettTypography.badge)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(BrettColors.error.opacity(0.15), in: Capsule())
                                .foregroundStyle(BrettColors.error)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.vertical, 4)
                    .listRowBackground(glassRowBackground)
                }
            } header: {
                sectionHeader("Pending Approvals (\(store.pending.count))")
            }
        }
    }

    @ViewBuilder
    private var sendersSection: some View {
        Section {
            if store.senders.isEmpty, !store.isLoading {
                Text("No senders yet. Forward a newsletter to your address above to get started.")
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.textMeta)
                    .listRowBackground(glassRowBackground)
            } else {
                ForEach(store.senders) { sender in
                    Toggle(isOn: Binding(
                        get: { sender.active },
                        set: { newValue in
                            Task { await store.updateSender(id: sender.id, active: newValue) }
                        }
                    )) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(sender.name)
                                .font(BrettTypography.taskTitle)
                                .foregroundStyle(BrettColors.textCardTitle)
                            Text(sender.email)
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textMeta)
                        }
                    }
                    .tint(BrettColors.gold)
                    .listRowBackground(glassRowBackground)
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            Task { await store.deleteSender(id: sender.id) }
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
        } header: {
            sectionHeader("Subscribed Senders")
        }
    }

    // MARK: - Helpers

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
}
