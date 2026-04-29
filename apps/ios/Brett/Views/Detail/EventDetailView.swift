import SwiftUI
import SwiftData

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
///
/// Auth gate around `EventDetailBody`. The body is the work-doer; this
/// outer view exists only to extract `userId` from the environment and
/// hand it to a child whose `@Query` predicates capture it directly.
///
/// Why this shape: SwiftData's `#Predicate` macro can't read
/// `@Environment` values, so the established workaround is an init-based
/// subview where `userId` is a stored property and each `@Query` is
/// constructed in `init` with the captured user. This pushes the user
/// filter down into the SwiftData fetch instead of doing it in Swift
/// after the fact — cheaper, and keeps cross-user rows from ever
/// entering the working set. Critically, this fixes the prior unscoped
/// `calendarStore.fetchById(eventId)` + `calendarStore.fetchNote(for:)`
/// calls that could resolve a row belonging to a different account
/// lingering in SwiftData (e.g. between sign-out and the wipe completing) —
/// the same cross-user defense gap that Wave B closed for `TaskDetailView`.
struct EventDetailView: View {
    let eventId: String

    @Environment(AuthManager.self) private var authManager

    var body: some View {
        if let userId = authManager.currentUser?.id {
            EventDetailBody(userId: userId, eventId: eventId)
                .id("\(userId)-\(eventId)")
        } else {
            // Signed-out fallback. The auth gate upstream usually prevents
            // this branch; render an empty state defensively rather than
            // nil-fallback so the type system doesn't have to model a
            // missing user here.
            EmptyView()
        }
    }

    // MARK: - Pure formatting helpers
    //
    // These are exposed as static members on the outer view (rather than
    // the private body) so the existing `EventFormattingTests` suite
    // can reach them by their public-facing name. The body forwards to
    // these so production calls stay co-located with the section that
    // uses them.

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

// MARK: - Body (the actual content)

/// Detail data + UI. Owned by `EventDetailView`'s auth gate, so `userId`
/// is guaranteed non-optional for this view's lifetime. Re-instantiated
/// on account switch OR `eventId` change because the parent applies
/// `.id("\(userId)-\(eventId)")` — SwiftUI treats a changed `id` as a new
/// view identity and remounts this body from scratch, which gives us a
/// fresh `@Query` with the new user/event predicate (plus a clean slate
/// for `@State` stores and caches).
private struct EventDetailBody: View {
    let userId: String
    let eventId: String

    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss

    @State private var calendarStore = CalendarStore()

    /// Single-row reactive read of the event for `(userId, eventId)`.
    /// Replaces the prior unscoped `calendarStore.fetchById(eventId)`
    /// lookup — that legacy form could match a row belonging to a
    /// different account that was still lingering in SwiftData. The
    /// user-scoped predicate guarantees cross-user isolation.
    @Query private var matchedEvents: [CalendarEvent]

    /// Single-row reactive read of the event's note for the current user.
    /// Replaces the prior unscoped `calendarStore.fetchNote(for: fetched.id)`
    /// lookup. `applyServerNote` and `upsertNote` writes are still routed
    /// through `CalendarStore` (which now reads back through this same
    /// scoped predicate), so the editor refreshes automatically when the
    /// server hydrate lands.
    @Query private var matchedNotes: [CalendarEventNote]

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
    /// Guard so back-and-forward navigation through the detail stack
    /// doesn't re-hit `/events/:id/related-items` and
    /// `/events/:id/meeting-history` on every re-appear. SwiftUI's
    /// `.task` re-fires whenever the view is re-inserted; without this
    /// flag a 3-deep navigation pop-push double-hits both endpoints.
    /// Notes are cached separately by `RemoteCache`.
    @State private var asidesLoaded = false

    /// Snapshot guard so a SwiftData republish (driven by every commit)
    /// doesn't re-seed the draft fields on top of in-flight user input.
    /// We re-seed only on the first transition from "no row" to "row
    /// present" — same pattern as `TaskDetailBody.hasSeededDraft`.
    @State private var hasSeededDraft = false

    private var api: APIClient { APIClient.shared }

    private var event: CalendarEvent? { matchedEvents.first }
    private var note: CalendarEventNote? { matchedNotes.first }

    init(userId: String, eventId: String) {
        self.userId = userId
        self.eventId = eventId

        let eventPredicate = #Predicate<CalendarEvent> { event in
            event.id == eventId && event.userId == userId
        }
        _matchedEvents = Query(filter: eventPredicate)

        let notePredicate = #Predicate<CalendarEventNote> { note in
            note.calendarEventId == eventId
                && note.userId == userId
                && note.deletedAt == nil
        }
        _matchedNotes = Query(filter: notePredicate)
    }

    var body: some View {
        DetailViewContainer(bottomPadding: 120) {
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
            } else {
                loadingPlaceholder
            }
        }
        .navigationTitle("Calendar")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            seedDraftIfNeeded()
            await loadAsides()
        }
        // Re-seed the draft when the event first lands. This handles
        // the cold-open case where `task` runs before SwiftData's
        // @Query has resolved the row — the seed inside `.task` then
        // no-ops because `event` is still nil, and this onChange picks
        // it up on first match.
        .onChange(of: event?.id) { _, _ in
            seedDraftIfNeeded()
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
                    Text(EventDetailView.formatTimeBlock(event))
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
        let trimmed = notesDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        // No-op when there's nothing to save and no row to clear: avoids
        // creating an empty note on a blank field.
        if trimmed.isEmpty && note == nil { return }
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
                Text(EventDetailView.formatHistory(meetingHistory))
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

    /// Seed the edit buffers from the matched event the first time it
    /// appears. Subsequent SwiftData republishes (driven by RSVP saves
    /// or note hydrates) leave the drafts alone so the user's in-flight
    /// edits aren't trampled.
    private func seedDraftIfNeeded() {
        guard !hasSeededDraft, let event else { return }
        rsvpDraft = event.rsvpStatus
        if let note {
            notesDraft = note.content
        }
        hasSeededDraft = true
    }

    private func loadAsides() async {
        // Notes go through RemoteCache (TTL handles freshness). Related
        // items + meeting history are fetched once per view-mount
        // because they're stable for the duration of a session — no
        // mutation path changes them — and re-fetching on every nav
        // re-appear was a double-hit per stack pop-push.
        guard !asidesLoaded else {
            // Refresh notes only — those CAN change while the view is
            // backgrounded (the user might have edited from desktop).
            if let noteResp = try? await RemoteCache.shared.eventNote(eventId: eventId),
               let id = noteResp.id,
               let content = noteResp.content,
               let updatedAt = noteResp.updatedAt {
                calendarStore.applyServerNote(
                    id: id,
                    eventId: eventId,
                    userId: userId,
                    content: content,
                    updatedAt: updatedAt
                )
                if !isNotesFocused && notesDraft.isEmpty {
                    notesDraft = content
                }
            }
            return
        }
        isLoadingAsides = true
        defer { isLoadingAsides = false }
        async let related = api.fetchEventRelatedItems(eventId: eventId)
        async let history = api.fetchEventMeetingHistory(eventId: eventId)
        async let serverNote = RemoteCache.shared.eventNote(eventId: eventId)

        if let relatedResp = try? await related {
            relatedItems = relatedResp.relatedItems
        }
        if let historyResp = try? await history {
            meetingHistory = historyResp
        }
        asidesLoaded = true
        // Notes are no longer replicated via /sync/pull. Fetch on-open and
        // mirror into local SwiftData using the server's primary id so a
        // subsequent user edit pushes as an UPDATE (not a CREATE that
        // would collide with the unique constraint).
        if let noteResp = try? await serverNote,
           let id = noteResp.id,
           let content = noteResp.content,
           let updatedAt = noteResp.updatedAt {
            calendarStore.applyServerNote(
                id: id,
                eventId: eventId,
                userId: userId,
                content: content,
                updatedAt: updatedAt
            )
            // Sync the editor draft only if the user hasn't started
            // typing — overwriting their input would feel hostile.
            if !isNotesFocused && notesDraft.isEmpty {
                notesDraft = content
            }
        }
    }
}
