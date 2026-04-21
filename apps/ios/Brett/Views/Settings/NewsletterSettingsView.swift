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
        BrettSettingsScroll {
            if let errorMessage = store.errorMessage {
                BrettSettingsSection {
                    Text(errorMessage)
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.error)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                }
            }

            ingestAddressSection
            pendingSection
            sendersSection
        }
        .refreshable { await store.fetch() }
        .navigationTitle("Newsletters")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task { await store.fetch() }
    }

    // MARK: - Sections

    @ViewBuilder
    private var ingestAddressSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            BrettSettingsSection("Forward newsletters to") {
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
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }

            Text("Forward a newsletter to this address and Brett will save it to your Inbox. New senders appear in Pending Approvals until you approve them.")
                .font(.system(size: 12))
                .foregroundStyle(BrettColors.textMeta)
                .padding(.horizontal, 4)
        }
    }

    @ViewBuilder
    private var pendingSection: some View {
        if !store.pending.isEmpty {
            BrettSettingsSection("Pending Approvals (\(store.pending.count))") {
                ForEach(Array(store.pending.enumerated()), id: \.element.id) { index, p in
                    if index > 0 {
                        BrettSettingsDivider()
                    }

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
                                Task { await store.approvePending(senderEmail: p.senderEmail) }
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
                                Task { await store.blockPending(senderEmail: p.senderEmail) }
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
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                }
            }
        }
    }

    @ViewBuilder
    private var sendersSection: some View {
        BrettSettingsSection("Subscribed Senders") {
            if store.senders.isEmpty, !store.isLoading {
                Text("No senders yet. Forward a newsletter to your address above to get started.")
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.textMeta)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
            } else {
                ForEach(Array(store.senders.enumerated()), id: \.element.id) { index, sender in
                    if index > 0 {
                        BrettSettingsDivider()
                    }

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
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                }
            }
        }
    }
}
