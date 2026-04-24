import SwiftUI
import SwiftData

/// Settings → App → Sync Health. Surfaces the observability the sync
/// engine has always recorded (pending count, last successful
/// push/pull, dead-letter queue, conflict log) but that was never
/// shown to users.
///
/// Before this screen existed, a user whose mutation landed in the DLQ
/// had no way to see why their edit didn't sync — the app just showed
/// a red dot and the `ConflictLogEntry` rows accumulated in SwiftData
/// with nothing to read them. This view:
///
///  - Renders the singleton `SyncHealth` row (pending/dead counts,
///    last successful push+pull timestamps, last error string).
///  - Lists dead-letter mutations with the server error and a
///    "Discard" action so the user can clear a permanently-stuck row.
///  - Lists the most recent conflicts with the merged fields so the
///    user sees when server-side edits clobbered their local state.
///
/// Scope is deliberately read-only-ish. "Discard" is the one write
/// action; retry is intentionally omitted because a dead mutation is
/// usually dead for a reason (4xx validation errors don't self-heal).
/// A future pass can add manual retry once we have better telemetry
/// on what server errors look like in the DLQ.
struct SyncHealthSettingsView: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(\.modelContext) private var modelContext

    // SyncHealth is a singleton row keyed on "singleton" id, so any sort
    // works. ConflictLogEntry.resolvedAt is Optional<Date> which isn't
    // Comparable in the way @Query's sort: parameter expects, so we
    // fetch unsorted and order in Swift via `conflictRowsSorted`.
    @Query private var healthRows: [SyncHealth]
    @Query(sort: \MutationQueueEntry.createdAt, order: .forward) private var queueRows: [MutationQueueEntry]
    @Query private var conflictRowsUnsorted: [ConflictLogEntry]

    private var conflictRows: [ConflictLogEntry] {
        // Newest first; rows with no resolvedAt (still pending / in-flight
        // conflicts, rare) sink to the bottom via `.distantPast`.
        conflictRowsUnsorted.sorted {
            ($0.resolvedAt ?? .distantPast) > ($1.resolvedAt ?? .distantPast)
        }
    }

    private var health: SyncHealth? { healthRows.first }
    private var deadRows: [MutationQueueEntry] {
        queueRows.filter { $0.status == MutationStatus.dead.rawValue }
    }
    private var blockedRows: [MutationQueueEntry] {
        queueRows.filter { $0.status == MutationStatus.blocked.rawValue }
    }
    private var pendingCount: Int {
        queueRows.filter { $0.status == MutationStatus.pending.rawValue }.count
    }
    private var inFlightCount: Int {
        queueRows.filter { $0.status == MutationStatus.inFlight.rawValue }.count
    }

    var body: some View {
        BrettSettingsScroll {
            statusCard
            counterCard

            if !deadRows.isEmpty || !blockedRows.isEmpty {
                deadLetterSection
            }

            if !conflictRows.isEmpty {
                conflictSection
            }

            actionsCard
        }
        .navigationTitle("Sync Health")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: - Status card

    private var statusCard: some View {
        BrettSettingsSection("Status") {
            row(
                label: "Last successful push",
                value: Self.format(health?.lastSuccessfulPushAt)
            )
            BrettSettingsDivider()
            row(
                label: "Last successful pull",
                value: Self.format(health?.lastSuccessfulPullAt)
            )
            if let error = health?.lastError, !error.isEmpty {
                BrettSettingsDivider()
                row(
                    label: "Last error",
                    value: error,
                    valueColor: BrettColors.error
                )
            }
            if let failures = health?.consecutiveFailures, failures > 0 {
                BrettSettingsDivider()
                row(
                    label: "Consecutive failures",
                    value: "\(failures)",
                    valueColor: BrettColors.error
                )
            }
        }
    }

    // MARK: - Queue counters

    private var counterCard: some View {
        BrettSettingsSection("Queue") {
            row(label: "Pending", value: "\(pendingCount)")
            BrettSettingsDivider()
            row(label: "In flight", value: "\(inFlightCount)")
            BrettSettingsDivider()
            row(
                label: "Dead",
                value: "\(deadRows.count)",
                valueColor: deadRows.isEmpty ? BrettColors.textBody : BrettColors.error
            )
            if !blockedRows.isEmpty {
                BrettSettingsDivider()
                row(label: "Blocked", value: "\(blockedRows.count)")
            }
        }
    }

    // MARK: - Dead-letter list

    private var deadLetterSection: some View {
        BrettSettingsSection("Dead-letter queue") {
            ForEach(Array((deadRows + blockedRows).enumerated()), id: \.element.id) { index, entry in
                if index > 0 {
                    BrettSettingsDivider()
                }
                deadLetterRow(entry: entry)
            }
        }
    }

    private func deadLetterRow(entry: MutationQueueEntry) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(entry.action.uppercased()) \(entry.entityType)")
                        .font(BrettTypography.taskTitle)
                        .foregroundStyle(BrettColors.textCardTitle)
                    Text("id \(BrettLog.shortId(entry.entityId))")
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.textMeta)
                }
                Spacer()
                Button("Discard") {
                    discard(entry: entry)
                }
                .font(BrettTypography.taskMeta)
                .foregroundStyle(BrettColors.error)
            }

            if let error = entry.error, !error.isEmpty {
                Text(error)
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.textMeta)
                    .lineLimit(3)
            }

            HStack(spacing: 8) {
                Text("retries: \(entry.retryCount)")
                if let code = entry.errorCode {
                    Text("code: \(code)")
                }
            }
            .font(BrettTypography.taskMeta)
            .foregroundStyle(BrettColors.textGhost)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    // MARK: - Conflict log

    private var conflictSection: some View {
        BrettSettingsSection("Recent conflicts") {
            ForEach(Array(conflictRows.prefix(20).enumerated()), id: \.element.id) { index, entry in
                if index > 0 {
                    BrettSettingsDivider()
                }
                conflictRow(entry: entry)
            }
        }
    }

    private func conflictRow(entry: ConflictLogEntry) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("\(entry.entityType) conflict")
                    .font(BrettTypography.taskTitle)
                    .foregroundStyle(BrettColors.textCardTitle)
                Spacer()
                Text(Self.format(entry.resolvedAt) ?? "")
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.textGhost)
            }

            if let fields = entry.conflictedFieldsDecoded, !fields.isEmpty {
                Text("Fields: \(fields.joined(separator: ", "))")
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.textMeta)
            }

            if let resolution = entry.resolution {
                Text("Resolution: \(resolution)")
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.textGhost)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    // MARK: - Actions

    private var actionsCard: some View {
        BrettSettingsSection("Actions") {
            Button {
                Task {
                    try? await ActiveSession.syncManager?.pullToRefresh()
                }
            } label: {
                HStack {
                    Text("Force sync now")
                        .font(BrettTypography.taskTitle)
                        .foregroundStyle(BrettColors.textCardTitle)
                    Spacer()
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(BrettColors.gold)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Helpers

    private func row(
        label: String,
        value: String?,
        valueColor: Color = BrettColors.textCardTitle
    ) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .font(BrettTypography.taskTitle)
                .foregroundStyle(BrettColors.textBody)
            Spacer()
            Text(value ?? "—")
                .font(BrettTypography.taskMeta)
                .foregroundStyle(valueColor)
                .multilineTextAlignment(.trailing)
                .lineLimit(4)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private func discard(entry: MutationQueueEntry) {
        modelContext.delete(entry)
        do {
            try modelContext.save()
        } catch {
            BrettLog.sync.error("SyncHealthSettingsView discard save failed: \(String(describing: error), privacy: .public)")
        }
    }

    private static func format(_ date: Date?) -> String? {
        guard let date else { return nil }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - ConflictLogEntry decoding helper

private extension ConflictLogEntry {
    /// Decode `conflictedFieldsJSON` into a `[String]` for display. Returns
    /// nil on malformed payloads so the UI can hide the row instead of
    /// showing raw JSON.
    var conflictedFieldsDecoded: [String]? {
        guard let data = conflictedFieldsJSON.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String]
    }
}
