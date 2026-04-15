import SwiftUI

/// Push-navigation detail view for a single `CalendarEvent`.
///
/// Sections (top → bottom):
/// 1. Title + time/location/meeting-link header.
/// 2. RSVP pills (Yes/Maybe/No) with optional comment.
/// 3. Attendees with response badges.
/// 4. Meeting notes (editable, auto-save on blur via `CalendarStore.upsertNote`).
/// 5. Related items (from `/api/events/:id/related-items`).
/// 6. Meeting history ("You've met N times…").
/// 7. Brett's Take (cerulean glass card) when `event.brettObservation` is present.
struct EventDetailView: View {
    let eventId: String

    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var authManager

    @State private var calendarStore = CalendarStore()
    @State private var event: CalendarEvent?

    @State private var rsvpDraft: CalendarRsvpStatus = .needsAction
    @State private var rsvpComment = ""
    @State private var isShowingRsvpComment = false
    @State private var isSubmittingRsvp = false
    @State private var rsvpError: String?

    @State private var notesDraft = ""
    @FocusState private var isNotesFocused: Bool

    @State private var relatedItems: [APIClient.RelatedItem] = []
    @State private var meetingHistory: APIClient.MeetingHistoryResponse?
    @State private var isLoadingAsides = false

    private var api: APIClient { APIClient.shared }

    var body: some View {
        ScrollView {
            if let event {
                VStack(alignment: .leading, spacing: 18) {
                    header(event)
                    rsvpSection(event)
                    attendeesSection(event)
                    notesSection(event)
                    relatedItemsSection
                    meetingHistorySection
                    brettTakeSection(event)
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 120)
            } else {
                loadingPlaceholder
            }
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Calendar")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            loadEvent()
            await loadAsides()
        }
    }

    private var loadingPlaceholder: some View {
        VStack(spacing: 12) {
            ProgressView().tint(.white)
            Text("Loading event…")
                .font(BrettTypography.taskMeta)
                .foregroundStyle(Color.white.opacity(0.40))
        }
        .frame(maxWidth: .infinity, minHeight: 300)
    }

    @ViewBuilder
    private func header(_ event: CalendarEvent) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("EVENT")
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(Color.white.opacity(0.40))

            Text(event.title)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.white)

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "clock")
                        .font(.system(size: 11, weight: .medium))
                    Text(Self.formatTimeBlock(event))
                        .font(BrettTypography.taskMeta)
                }
                .foregroundStyle(Color.white.opacity(0.50))

                if let location = event.location, !location.isEmpty {
                    HStack(spacing: 6) {
                        Image(systemName: "mappin.circle")
                            .font(.system(size: 11, weight: .medium))
                        Text(location)
                            .font(BrettTypography.taskMeta)
                    }
                    .foregroundStyle(Color.white.opacity(0.50))
                }

                if let link = event.meetingLink, !link.isEmpty, let url = URL(string: link) {
                    Button {
                        openURL(url)
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "video")
                                .font(.system(size: 11, weight: .medium))
                            Text("Join meeting")
                                .font(BrettTypography.taskMeta)
                            Image(systemName: "arrow.up.right.square")
                                .font(.system(size: 10, weight: .medium))
                        }
                        .foregroundStyle(BrettColors.cerulean)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func rsvpSection(_ event: CalendarEvent) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("YOUR RSVP")
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(Color.white.opacity(0.40))

            HStack(spacing: 8) {
                rsvpPill(.accepted, label: "Yes", current: event.rsvpStatus)
                rsvpPill(.tentative, label: "Maybe", current: event.rsvpStatus)
                rsvpPill(.declined, label: "No", current: event.rsvpStatus)
            }

            if isShowingRsvpComment {
                TextField("Optional note…", text: $rsvpComment, axis: .vertical)
                    .font(BrettTypography.body)
                    .tint(BrettColors.gold)
                    .foregroundStyle(.white)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))

                Button {
                    Task { await submitRsvp(rsvpDraft) }
                } label: {
                    Text(isSubmittingRsvp ? "Sending…" : "Send RSVP")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(BrettColors.gold, in: Capsule())
                }
                .disabled(isSubmittingRsvp)
                .buttonStyle(.plain)
            }

            if let rsvpError {
                Text(rsvpError)
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.error)
            }
        }
        .glassCard()
    }

    @ViewBuilder
    private func rsvpPill(_ status: CalendarRsvpStatus, label: String, current: CalendarRsvpStatus) -> some View {
        let isActive = status == current || status == rsvpDraft
        Button {
            HapticManager.light()
            rsvpDraft = status
            isShowingRsvpComment = true
        } label: {
            Text(label)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(isActive ? .black : Color.white.opacity(0.80))
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(isActive ? BrettColors.gold : Color.white.opacity(0.08), in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isSubmittingRsvp)
    }

    private func submitRsvp(_ status: CalendarRsvpStatus) async {
        isSubmittingRsvp = true
        rsvpError = nil
        defer { isSubmittingRsvp = false }
        do {
            let comment = rsvpComment.trimmingCharacters(in: .whitespacesAndNewlines)
            _ = try await api.updateEventRsvp(
                eventId: eventId,
                status: status,
                comment: comment.isEmpty ? nil : comment
            )
            if let event {
                event.myResponseStatus = status.rawValue
                try? event.modelContext?.save()
            }
            isShowingRsvpComment = false
            rsvpComment = ""
        } catch {
            rsvpError = "Couldn't update RSVP. Try again."
        }
    }

    @ViewBuilder
    private func attendeesSection(_ event: CalendarEvent) -> some View {
        let attendees = event.attendees
        if !attendees.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("ATTENDEES")
                    .font(BrettTypography.sectionLabel)
                    .tracking(2.4)
                    .foregroundStyle(Color.white.opacity(0.40))

                VStack(spacing: 8) {
                    ForEach(Array(attendees.enumerated()), id: \.offset) { _, raw in
                        attendeeRow(raw)
                    }
                }
            }
            .glassCard()
        }
    }

    @ViewBuilder
    private func attendeeRow(_ raw: [String: Any]) -> some View {
        let name = (raw["displayName"] as? String) ?? (raw["email"] as? String) ?? "Unknown"
        let status = (raw["responseStatus"] as? String) ?? "needsAction"
        HStack(spacing: 10) {
            statusBadge(status)
            Text(name)
                .font(BrettTypography.body)
                .foregroundStyle(Color.white.opacity(0.85))
                .lineLimit(1)
            if let isOrganizer = raw["organizer"] as? Bool, isOrganizer {
                Text("ORGANIZER")
                    .font(BrettTypography.sectionLabel)
                    .tracking(1.8)
                    .foregroundStyle(Color.white.opacity(0.40))
            }
            Spacer()
        }
    }

    @ViewBuilder
    private func statusBadge(_ status: String) -> some View {
        let (symbol, color): (String, Color) = {
            switch status {
            case "accepted": return ("checkmark", BrettColors.success)
            case "tentative": return ("questionmark", BrettColors.amber400)
            case "declined": return ("xmark", BrettColors.error)
            default: return ("circle", Color.white.opacity(0.30))
            }
        }()
        Image(systemName: symbol)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(color)
            .frame(width: 20, height: 20)
            .background(color.opacity(0.18), in: Circle())
    }

    @ViewBuilder
    private func notesSection(_ event: CalendarEvent) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("MEETING NOTES")
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(Color.white.opacity(0.40))

            TextEditor(text: $notesDraft)
                .font(BrettTypography.body)
                .tint(BrettColors.gold)
                .foregroundStyle(.white)
                .scrollContentBackground(.hidden)
                .focused($isNotesFocused)
                .frame(minHeight: 120)
                .padding(10)
                .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(alignment: .topLeading) {
                    if notesDraft.isEmpty && !isNotesFocused {
                        Text("Jot down thoughts, decisions, action items…")
                            .font(BrettTypography.body)
                            .foregroundStyle(Color.white.opacity(0.30))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 18)
                            .allowsHitTesting(false)
                    }
                }
                .onChange(of: isNotesFocused) { _, focused in
                    if !focused { saveNotes() }
                }
        }
        .glassCard()
    }

    private func saveNotes() {
        guard let event else { return }
        let userId = authManager.currentUser?.id ?? event.userId
        let trimmed = notesDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty && calendarStore.fetchNote(for: event.id) == nil { return }
        calendarStore.upsertNote(eventId: event.id, userId: userId, content: notesDraft)
    }

    @ViewBuilder
    private var relatedItemsSection: some View {
        if !relatedItems.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("RELATED ITEMS")
                    .font(BrettTypography.sectionLabel)
                    .tracking(2.4)
                    .foregroundStyle(Color.white.opacity(0.40))

                VStack(spacing: 6) {
                    ForEach(relatedItems) { item in
                        HStack(spacing: 8) {
                            Image(systemName: item.status == "completed" ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(item.status == "completed" ? BrettColors.success : Color.white.opacity(0.40))
                            Text(item.title)
                                .font(BrettTypography.body)
                                .foregroundStyle(Color.white.opacity(0.85))
                                .lineLimit(1)
                            Spacer()
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
            .glassCard()
        }
    }

    @ViewBuilder
    private var meetingHistorySection: some View {
        if let meetingHistory, !meetingHistory.pastOccurrences.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text(Self.formatHistory(meetingHistory))
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(Color.white.opacity(0.50))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 8)
        }
    }

    @ViewBuilder
    private func brettTakeSection(_ event: CalendarEvent) -> some View {
        if let observation = event.brettObservation, !observation.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(BrettColors.cerulean)
                    Text("BRETT'S TAKE")
                        .font(BrettTypography.sectionLabel)
                        .tracking(2.4)
                        .foregroundStyle(BrettColors.ceruleanLabel)
                }

                Text(observation)
                    .font(BrettTypography.body)
                    .foregroundStyle(Color.white.opacity(0.85))

                Text("Ask Brett about this meeting →")
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.cerulean)
                    .padding(.top, 2)
            }
            .glassCard(tint: BrettColors.cerulean)
        }
    }

    private func loadEvent() {
        let fetched = calendarStore.fetchById(eventId)
        event = fetched
        if let fetched {
            rsvpDraft = fetched.rsvpStatus
            if let note = calendarStore.fetchNote(for: fetched.id) {
                notesDraft = note.content
            }
        }
    }

    private func loadAsides() async {
        isLoadingAsides = true
        defer { isLoadingAsides = false }
        async let related = api.fetchEventRelatedItems(eventId: eventId)
        async let history = api.fetchEventMeetingHistory(eventId: eventId)

        if let relatedResp = try? await related {
            relatedItems = relatedResp.relatedItems
        }
        if let historyResp = try? await history {
            meetingHistory = historyResp
        }
    }

    static func formatTimeBlock(_ event: CalendarEvent) -> String {
        if event.isAllDay {
            return "All day · \(event.startTime.formatted(.dateTime.weekday(.abbreviated).month().day()))"
        }
        let dayFormat: Date.FormatStyle = .dateTime.weekday(.abbreviated).month().day()
        let timeFormat: Date.FormatStyle = .dateTime.hour().minute()
        return "\(event.startTime.formatted(dayFormat)) · \(event.startTime.formatted(timeFormat)) – \(event.endTime.formatted(timeFormat))"
    }

    static func formatHistory(_ history: APIClient.MeetingHistoryResponse) -> String {
        let count = history.pastOccurrences.count
        guard let last = history.pastOccurrences.first else { return "" }
        let lastFormatted = last.startTime.formatted(.dateTime.month().day().year())
        if count == 1 {
            return "You've met once before. Last met \(lastFormatted)."
        }
        return "You've met \(count) times. Last met \(lastFormatted)."
    }
}
