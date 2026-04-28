import Foundation
import SwiftData

/// Converts between local `@Model` instances and the server's JSON shape.
///
/// Prisma returns camelCase keys, and most Swift property names already
/// match. The remapping work is confined to a few reserved-word collisions:
///
///   - `Item.itemDescription`           ↔ `description`
///   - `CalendarEvent.eventDescription` ↔ `description`
///   - `CalendarEvent.rawGoogleEventJSON` ↔ `rawGoogleEvent` (Prisma `Json`)
///   - `CalendarEvent.organizerJSON` / `attendeesJSON` / `attachmentsJSON`
///     ↔ `organizer` / `attendees` / `attachments`  (Prisma `Json`)
///   - `Scout.sourcesJSON`              ↔ `sources` (Prisma `Json`)
///   - `ScoutFinding.findingDescription` ↔ `description`
///
/// Dates arrive as ISO-8601 strings from Prisma; we parse them with
/// `ISO8601DateFormatter` (lenient about fractional seconds via a fallback).
/// Going the other way, we serialize as ISO-8601 so the server's Zod
/// parsers accept them.
enum SyncEntityMapper {
    // MARK: - Public entry points

    /// Apply a server record to an existing local model or insert a new one.
    /// Mirrors the pull-engine behaviour: never clobbers local pending writes.
    ///
    /// Caller-actor agnostic: the function only mutates the passed
    /// `ModelContext`, so it runs correctly on whatever actor owns that
    /// context. Sync moved off `@MainActor` so this had to lose its
    /// own annotation; the cross-user defense reads via `SharedConfig`,
    /// which is nonisolated UserDefaults storage rather than the
    /// main-actor `ActiveSession` registry.
    static func upsert(
        tableName: String,
        record: [String: Any],
        context: ModelContext,
        respectLocalPending: Bool = true
    ) {
        guard let id = record["id"] as? String, !id.isEmpty else { return }

        // Defense in depth: drop rows whose `userId` doesn't match the
        // active session. /sync/pull is server-side user-scoped, so under
        // correct operation every row carries the current user's id.
        // But if a stale response from a prior account were ever to land
        // (sign-out → sign-in race, mock URL replay, malicious proxy),
        // applying its rows would write a foreign userId onto local
        // models — silent cross-user data leakage. Reject defensively.
        if let activeUserId = SharedConfig.resolveCurrentUserId(),
           let recordUserId = record["userId"] as? String,
           !recordUserId.isEmpty,
           recordUserId != activeUserId {
            BrettLog.pull.error(
                "dropping incoming \(tableName, privacy: .public) row whose userId does not match active session — possible stale-response or cross-user leak"
            )
            return
        }

        switch tableName {
        case "lists":
            upsertList(id: id, dict: record, context: context, respectLocalPending: respectLocalPending)
        case "items":
            upsertItem(id: id, dict: record, context: context, respectLocalPending: respectLocalPending)
        case "calendar_events":
            upsertCalendarEvent(id: id, dict: record, context: context, respectLocalPending: respectLocalPending)
        case "calendar_event_notes":
            upsertCalendarEventNote(id: id, dict: record, context: context, respectLocalPending: respectLocalPending)
        case "scouts":
            upsertScout(id: id, dict: record, context: context, respectLocalPending: respectLocalPending)
        case "scout_findings":
            upsertScoutFinding(id: id, dict: record, context: context, respectLocalPending: respectLocalPending)
        case "brett_messages":
            upsertBrettMessage(id: id, dict: record, context: context, respectLocalPending: respectLocalPending)
        case "attachments":
            upsertAttachment(id: id, dict: record, context: context, respectLocalPending: respectLocalPending)
        default:
            // Unknown table name from server — skip silently. Logged at the
            // pull-engine level so we don't spam per-record.
            return
        }
    }

    /// Hard-delete a record by (table, id). Pulls are authoritative for
    /// deletions, so we ignore local pending state here.
    ///
    /// Caller owns the save: this function only stages the delete on the
    /// passed context. SyncDataActor batches dozens of deletes per round
    /// and saves once at the end; saving inside this helper would amplify
    /// to one save per row, defeating the batching. Standalone callers
    /// (SSE event handler, ad-hoc cleanups) save their context explicitly.
    static func hardDelete(
        tableName: String,
        id: String,
        context: ModelContext
    ) {
        switch tableName {
        case "lists":
            if let obj = fetchById(ItemList.self, id: id, in: context) { context.delete(obj) }
        case "items":
            if let obj = fetchById(Item.self, id: id, in: context) { context.delete(obj) }
        case "calendar_events":
            if let obj = fetchById(CalendarEvent.self, id: id, in: context) { context.delete(obj) }
        case "calendar_event_notes":
            if let obj = fetchById(CalendarEventNote.self, id: id, in: context) { context.delete(obj) }
        case "scouts":
            if let obj = fetchById(Scout.self, id: id, in: context) { context.delete(obj) }
        case "scout_findings":
            if let obj = fetchById(ScoutFinding.self, id: id, in: context) { context.delete(obj) }
        case "brett_messages":
            if let obj = fetchById(BrettMessage.self, id: id, in: context) { context.delete(obj) }
        case "attachments":
            if let obj = fetchById(Attachment.self, id: id, in: context) { context.delete(obj) }
        default:
            return
        }
    }

    // MARK: - Item

    /// Local Item → server payload dict. Keys match Prisma `Item`.
    static func toServerPayload(_ item: Item) -> [String: Any] {
        var dict: [String: Any] = [
            "id": item.id,
            "userId": item.userId,
            "type": item.type,
            "status": item.status,
            "title": item.title,
            "source": item.source,
        ]
        dict["description"] = item.itemDescription ?? NSNull()
        dict["notes"] = item.notes ?? NSNull()
        dict["sourceId"] = item.sourceId ?? NSNull()
        dict["sourceUrl"] = item.sourceUrl ?? NSNull()
        dict["dueDate"] = isoString(item.dueDate) ?? NSNull()
        dict["dueDatePrecision"] = item.dueDatePrecision ?? NSNull()
        dict["completedAt"] = isoString(item.completedAt) ?? NSNull()
        dict["snoozedUntil"] = isoString(item.snoozedUntil) ?? NSNull()
        dict["reminder"] = item.reminder ?? NSNull()
        dict["recurrence"] = item.recurrence ?? NSNull()
        dict["recurrenceRule"] = item.recurrenceRule ?? NSNull()
        dict["brettObservation"] = item.brettObservation ?? NSNull()
        dict["brettTakeGeneratedAt"] = isoString(item.brettTakeGeneratedAt) ?? NSNull()
        dict["contentType"] = item.contentType ?? NSNull()
        dict["contentStatus"] = item.contentStatus ?? NSNull()
        dict["contentTitle"] = item.contentTitle ?? NSNull()
        dict["contentDescription"] = item.contentDescription ?? NSNull()
        dict["contentImageUrl"] = item.contentImageUrl ?? NSNull()
        dict["contentBody"] = item.contentBody ?? NSNull()
        dict["contentFavicon"] = item.contentFavicon ?? NSNull()
        dict["contentDomain"] = item.contentDomain ?? NSNull()
        dict["contentMetadata"] = jsonDecoded(item.contentMetadata) ?? NSNull()
        dict["listId"] = item.listId ?? NSNull()
        dict["meetingNoteId"] = item.meetingNoteId ?? NSNull()
        dict["createdAt"] = isoString(item.createdAt) ?? NSNull()
        dict["updatedAt"] = isoString(item.updatedAt) ?? NSNull()
        return dict
    }

    /// Server JSON → local Item. Returns nil if required fields are missing.
    static func itemFromServerJSON(_ dict: [String: Any]) -> Item? {
        guard let id = dict["id"] as? String,
              let userId = dict["userId"] as? String,
              let title = dict["title"] as? String else {
            return nil
        }
        let item = Item(
            id: id,
            userId: userId,
            type: ItemType(rawValue: (dict["type"] as? String) ?? "") ?? .task,
            status: ItemStatus(rawValue: (dict["status"] as? String) ?? "") ?? .active,
            title: title,
            source: (dict["source"] as? String) ?? "Brett",
            dueDate: parseDate(dict["dueDate"]),
            listId: dict["listId"] as? String,
            notes: dict["notes"] as? String,
            createdAt: parseDate(dict["createdAt"]) ?? Date(),
            updatedAt: parseDate(dict["updatedAt"]) ?? Date()
        )
        // Apply fields not covered by the convenience init.
        applyItemFields(item, from: dict)
        return item
    }

    /// Copy every server-mirrored field from dict → existing model.
    static func applyItemFields(_ item: Item, from dict: [String: Any]) {
        if let v = dict["type"] as? String { item.type = v }
        if let v = dict["status"] as? String { item.status = v }
        if let v = dict["title"] as? String { item.title = v }
        item.itemDescription = dict["description"] as? String
        item.notes = dict["notes"] as? String
        if let v = dict["source"] as? String { item.source = v }
        item.sourceId = dict["sourceId"] as? String
        item.sourceUrl = dict["sourceUrl"] as? String
        item.dueDate = parseDate(dict["dueDate"])
        item.dueDatePrecision = dict["dueDatePrecision"] as? String
        item.completedAt = parseDate(dict["completedAt"])
        item.snoozedUntil = parseDate(dict["snoozedUntil"])
        item.reminder = dict["reminder"] as? String
        item.recurrence = dict["recurrence"] as? String
        item.recurrenceRule = dict["recurrenceRule"] as? String
        item.brettObservation = dict["brettObservation"] as? String
        item.brettTakeGeneratedAt = parseDate(dict["brettTakeGeneratedAt"])
        item.contentType = dict["contentType"] as? String
        item.contentStatus = dict["contentStatus"] as? String
        item.contentTitle = dict["contentTitle"] as? String
        item.contentDescription = dict["contentDescription"] as? String
        item.contentImageUrl = dict["contentImageUrl"] as? String
        item.contentBody = dict["contentBody"] as? String
        item.contentFavicon = dict["contentFavicon"] as? String
        item.contentDomain = dict["contentDomain"] as? String
        item.contentMetadata = jsonEncoded(dict["contentMetadata"])
        item.listId = dict["listId"] as? String
        item.meetingNoteId = dict["meetingNoteId"] as? String
        if let d = parseDate(dict["createdAt"]) { item.createdAt = d }
        if let d = parseDate(dict["updatedAt"]) { item.updatedAt = d }
        item.deletedAt = parseDate(dict["deletedAt"])
    }

    // MARK: - ItemList

    // ItemList is Codable-driven. The model owns its wire shape via the
    // `Codable` conformance in `Models/ItemList.swift`. The static
    // helpers below stay so existing tests and call sites keep working —
    // they're now thin shims over JSON{Encoder, Decoder} configured with
    // the project's date strategy.

    static func toServerPayload(_ list: ItemList) -> [String: Any] {
        do {
            let data = try makeEncoder().encode(list)
            guard let json = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) as? [String: Any] else {
                return [:]
            }
            return json
        } catch {
            BrettLog.push.error("Encode ItemList failed: \(String(describing: error), privacy: .public)")
            return [:]
        }
    }

    static func listFromServerJSON(_ dict: [String: Any]) -> ItemList? {
        do {
            let data = try JSONSerialization.data(withJSONObject: dict)
            return try makeDecoder().decode(ItemList.self, from: data)
        } catch {
            BrettLog.pull.error("Decode ItemList failed: \(String(describing: error), privacy: .public)")
            return nil
        }
    }

    /// Apply incoming server fields onto an existing local row. Kept as a
    /// dict-driven helper (rather than decoding into a fresh row and copying)
    /// so the partial-update semantics — only assign fields the server
    /// actually sent — match what the legacy implementation did.
    static func applyListFields(_ list: ItemList, from dict: [String: Any]) {
        if let v = dict["name"] as? String { list.name = v }
        if let v = dict["colorClass"] as? String { list.colorClass = v }
        if let v = dict["sortOrder"] as? Int { list.sortOrder = v }
        list.archivedAt = parseDate(dict["archivedAt"])
        if let d = parseDate(dict["createdAt"]) { list.createdAt = d }
        if let d = parseDate(dict["updatedAt"]) { list.updatedAt = d }
        list.deletedAt = parseDate(dict["deletedAt"])
    }

    // MARK: - CalendarEvent

    static func toServerPayload(_ event: CalendarEvent) -> [String: Any] {
        var dict: [String: Any] = [
            "id": event.id,
            "userId": event.userId,
            "googleAccountId": event.googleAccountId,
            "calendarListId": event.calendarListId,
            "googleEventId": event.googleEventId,
            "title": event.title,
            "startTime": isoString(event.startTime) ?? NSNull(),
            "endTime": isoString(event.endTime) ?? NSNull(),
            "isAllDay": event.isAllDay,
            "status": event.status,
            "myResponseStatus": event.myResponseStatus,
        ]
        dict["description"] = event.eventDescription ?? NSNull()
        dict["location"] = event.location ?? NSNull()
        dict["recurrence"] = event.recurrence ?? NSNull()
        dict["recurringEventId"] = event.recurringEventId ?? NSNull()
        dict["meetingLink"] = event.meetingLink ?? NSNull()
        dict["conferenceId"] = event.conferenceId ?? NSNull()
        dict["googleColorId"] = event.googleColorId ?? NSNull()
        dict["organizer"] = jsonDecoded(event.organizerJSON) ?? NSNull()
        dict["attendees"] = jsonDecoded(event.attendeesJSON) ?? NSNull()
        dict["attachments"] = jsonDecoded(event.attachmentsJSON) ?? NSNull()
        dict["rawGoogleEvent"] = jsonDecoded(event.rawGoogleEventJSON) ?? NSNull()
        dict["brettObservation"] = event.brettObservation ?? NSNull()
        dict["brettObservationAt"] = isoString(event.brettObservationAt) ?? NSNull()
        dict["brettObservationHash"] = event.brettObservationHash ?? NSNull()
        dict["syncedAt"] = isoString(event.syncedAt) ?? NSNull()
        dict["createdAt"] = isoString(event.createdAt) ?? NSNull()
        dict["updatedAt"] = isoString(event.updatedAt) ?? NSNull()
        return dict
    }

    static func calendarEventFromServerJSON(_ dict: [String: Any]) -> CalendarEvent? {
        guard let id = dict["id"] as? String,
              let userId = dict["userId"] as? String,
              let googleAccountId = dict["googleAccountId"] as? String,
              let calendarListId = dict["calendarListId"] as? String,
              let googleEventId = dict["googleEventId"] as? String,
              let title = dict["title"] as? String,
              let start = parseDate(dict["startTime"]),
              let end = parseDate(dict["endTime"]) else {
            return nil
        }
        let event = CalendarEvent(
            id: id,
            userId: userId,
            googleAccountId: googleAccountId,
            calendarListId: calendarListId,
            googleEventId: googleEventId,
            title: title,
            startTime: start,
            endTime: end,
            isAllDay: (dict["isAllDay"] as? Bool) ?? false,
            location: dict["location"] as? String,
            meetingLink: dict["meetingLink"] as? String,
            myResponseStatus: MyResponseStatus(
                rawValue: (dict["myResponseStatus"] as? String) ?? ""
            ) ?? .needsAction,
            createdAt: parseDate(dict["createdAt"]) ?? Date(),
            updatedAt: parseDate(dict["updatedAt"]) ?? Date()
        )
        applyCalendarEventFields(event, from: dict)
        return event
    }

    static func applyCalendarEventFields(_ event: CalendarEvent, from dict: [String: Any]) {
        if let v = dict["googleAccountId"] as? String { event.googleAccountId = v }
        if let v = dict["calendarListId"] as? String { event.calendarListId = v }
        if let v = dict["googleEventId"] as? String { event.googleEventId = v }
        if let v = dict["title"] as? String { event.title = v }
        event.eventDescription = dict["description"] as? String
        event.location = dict["location"] as? String
        if let d = parseDate(dict["startTime"]) { event.startTime = d }
        if let d = parseDate(dict["endTime"]) { event.endTime = d }
        if let v = dict["isAllDay"] as? Bool { event.isAllDay = v }
        if let v = dict["status"] as? String { event.status = v }
        if let v = dict["myResponseStatus"] as? String { event.myResponseStatus = v }
        event.recurrence = dict["recurrence"] as? String
        event.recurringEventId = dict["recurringEventId"] as? String
        event.meetingLink = dict["meetingLink"] as? String
        event.conferenceId = dict["conferenceId"] as? String
        event.googleColorId = dict["googleColorId"] as? String
        event.organizerJSON = jsonEncoded(dict["organizer"])
        event.attendeesJSON = jsonEncoded(dict["attendees"])
        event.attachmentsJSON = jsonEncoded(dict["attachments"])
        event.rawGoogleEventJSON = jsonEncoded(dict["rawGoogleEvent"])
        event.brettObservation = dict["brettObservation"] as? String
        event.brettObservationAt = parseDate(dict["brettObservationAt"])
        event.brettObservationHash = dict["brettObservationHash"] as? String
        if let d = parseDate(dict["syncedAt"]) { event.syncedAt = d }
        if let d = parseDate(dict["createdAt"]) { event.createdAt = d }
        if let d = parseDate(dict["updatedAt"]) { event.updatedAt = d }
        event.deletedAt = parseDate(dict["deletedAt"])
    }

    // MARK: - CalendarEventNote
    //
    // Codable-driven (Wave C pilot). The model owns its wire shape via the
    // `Codable` conformance in `Models/CalendarEvent.swift`. The static
    // helpers below stay so existing tests (`SyncEntityMapperTests`) and
    // call sites keep working — they're now thin shims over JSON{Encoder,
    // Decoder} configured with the project's date strategy.

    static func toServerPayload(_ note: CalendarEventNote) -> [String: Any] {
        do {
            let data = try makeEncoder().encode(note)
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return [:]
            }
            return json
        } catch {
            BrettLog.push.error("Encode CalendarEventNote failed: \(String(describing: error), privacy: .public)")
            return [:]
        }
    }

    static func calendarEventNoteFromServerJSON(_ dict: [String: Any]) -> CalendarEventNote? {
        do {
            let data = try JSONSerialization.data(withJSONObject: dict)
            return try makeDecoder().decode(CalendarEventNote.self, from: data)
        } catch {
            BrettLog.pull.error("Decode CalendarEventNote failed: \(String(describing: error), privacy: .public)")
            return nil
        }
    }

    /// Apply incoming server fields onto an existing local row. Kept as a
    /// dict-driven helper (rather than decoding into a fresh row and copying)
    /// so the partial-update semantics — only assign fields the server
    /// actually sent — match what the legacy implementation did.
    static func applyCalendarEventNoteFields(_ note: CalendarEventNote, from dict: [String: Any]) {
        if let v = dict["content"] as? String { note.content = v }
        if let d = parseDate(dict["createdAt"]) { note.createdAt = d }
        if let d = parseDate(dict["updatedAt"]) { note.updatedAt = d }
        note.deletedAt = parseDate(dict["deletedAt"])
    }

    // MARK: - Scout

    static func toServerPayload(_ scout: Scout) -> [String: Any] {
        var dict: [String: Any] = [
            "id": scout.id,
            "userId": scout.userId,
            "name": scout.name,
            "avatarLetter": scout.avatarLetter,
            "avatarGradientFrom": scout.avatarGradientFrom,
            "avatarGradientTo": scout.avatarGradientTo,
            "goal": scout.goal,
            "sensitivity": scout.sensitivity,
            "analysisTier": scout.analysisTier,
            "cadenceIntervalHours": scout.cadenceIntervalHours,
            "cadenceMinIntervalHours": scout.cadenceMinIntervalHours,
            "cadenceCurrentIntervalHours": scout.cadenceCurrentIntervalHours,
            "budgetTotal": scout.budgetTotal,
            "budgetUsed": scout.budgetUsed,
            "status": scout.status,
            "bootstrapped": scout.bootstrapped,
        ]
        dict["context"] = scout.context ?? NSNull()
        dict["sources"] = jsonDecoded(scout.sourcesJSON) ?? NSNull()
        dict["cadenceReason"] = scout.cadenceReason ?? NSNull()
        dict["budgetResetAt"] = isoString(scout.budgetResetAt) ?? NSNull()
        dict["statusLine"] = scout.statusLine ?? NSNull()
        dict["endDate"] = isoString(scout.endDate) ?? NSNull()
        dict["nextRunAt"] = isoString(scout.nextRunAt) ?? NSNull()
        dict["createdAt"] = isoString(scout.createdAt) ?? NSNull()
        dict["updatedAt"] = isoString(scout.updatedAt) ?? NSNull()
        return dict
    }

    static func scoutFromServerJSON(_ dict: [String: Any]) -> Scout? {
        guard let id = dict["id"] as? String,
              let userId = dict["userId"] as? String,
              let name = dict["name"] as? String,
              let goal = dict["goal"] as? String else { return nil }
        let scout = Scout(
            id: id,
            userId: userId,
            name: name,
            goal: goal,
            context: dict["context"] as? String,
            cadenceIntervalHours: (dict["cadenceIntervalHours"] as? Double) ?? 24,
            budgetTotal: (dict["budgetTotal"] as? Int) ?? 100,
            sensitivity: ScoutSensitivity(rawValue: (dict["sensitivity"] as? String) ?? "") ?? .medium,
            analysisTier: AnalysisTier(rawValue: (dict["analysisTier"] as? String) ?? "") ?? .standard,
            createdAt: parseDate(dict["createdAt"]) ?? Date(),
            updatedAt: parseDate(dict["updatedAt"]) ?? Date()
        )
        applyScoutFields(scout, from: dict)
        return scout
    }

    static func applyScoutFields(_ scout: Scout, from dict: [String: Any]) {
        if let v = dict["name"] as? String { scout.name = v }
        if let v = dict["avatarLetter"] as? String { scout.avatarLetter = v }
        if let v = dict["avatarGradientFrom"] as? String { scout.avatarGradientFrom = v }
        if let v = dict["avatarGradientTo"] as? String { scout.avatarGradientTo = v }
        if let v = dict["goal"] as? String { scout.goal = v }
        scout.context = dict["context"] as? String
        scout.sourcesJSON = jsonEncoded(dict["sources"])
        if let v = dict["sensitivity"] as? String { scout.sensitivity = v }
        if let v = dict["analysisTier"] as? String { scout.analysisTier = v }
        if let v = dict["cadenceIntervalHours"] as? Double { scout.cadenceIntervalHours = v }
        if let v = dict["cadenceMinIntervalHours"] as? Double { scout.cadenceMinIntervalHours = v }
        if let v = dict["cadenceCurrentIntervalHours"] as? Double { scout.cadenceCurrentIntervalHours = v }
        scout.cadenceReason = dict["cadenceReason"] as? String
        if let v = dict["budgetTotal"] as? Int { scout.budgetTotal = v }
        if let v = dict["budgetUsed"] as? Int { scout.budgetUsed = v }
        scout.budgetResetAt = parseDate(dict["budgetResetAt"])
        if let v = dict["status"] as? String { scout.status = v }
        scout.statusLine = dict["statusLine"] as? String
        if let v = dict["bootstrapped"] as? Bool { scout.bootstrapped = v }
        scout.endDate = parseDate(dict["endDate"])
        scout.nextRunAt = parseDate(dict["nextRunAt"])
        if let d = parseDate(dict["createdAt"]) { scout.createdAt = d }
        if let d = parseDate(dict["updatedAt"]) { scout.updatedAt = d }
        scout.deletedAt = parseDate(dict["deletedAt"])
    }

    // MARK: - ScoutFinding

    static func toServerPayload(_ finding: ScoutFinding) -> [String: Any] {
        var dict: [String: Any] = [
            "id": finding.id,
            "scoutId": finding.scoutId,
            "type": finding.type,
            "title": finding.title,
            "description": finding.findingDescription,
            "sourceName": finding.sourceName,
            "reasoning": finding.reasoning,
        ]
        dict["scoutRunId"] = finding.scoutRunId ?? NSNull()
        dict["sourceUrl"] = finding.sourceUrl ?? NSNull()
        dict["relevanceScore"] = finding.relevanceScore ?? NSNull()
        dict["itemId"] = finding.itemId ?? NSNull()
        dict["feedbackUseful"] = finding.feedbackUseful ?? NSNull()
        dict["feedbackAt"] = isoString(finding.feedbackAt) ?? NSNull()
        dict["createdAt"] = isoString(finding.createdAt) ?? NSNull()
        dict["updatedAt"] = isoString(finding.updatedAt) ?? NSNull()
        return dict
    }

    static func scoutFindingFromServerJSON(_ dict: [String: Any]) -> ScoutFinding? {
        guard let id = dict["id"] as? String,
              let scoutId = dict["scoutId"] as? String,
              let title = dict["title"] as? String,
              let description = dict["description"] as? String,
              let sourceName = dict["sourceName"] as? String else { return nil }
        let finding = ScoutFinding(
            id: id,
            scoutId: scoutId,
            scoutRunId: dict["scoutRunId"] as? String,
            type: FindingType(rawValue: (dict["type"] as? String) ?? "") ?? .insight,
            title: title,
            description: description,
            sourceName: sourceName,
            sourceUrl: dict["sourceUrl"] as? String,
            relevanceScore: dict["relevanceScore"] as? Double,
            reasoning: (dict["reasoning"] as? String) ?? "",
            createdAt: parseDate(dict["createdAt"]) ?? Date(),
            updatedAt: parseDate(dict["updatedAt"]) ?? Date()
        )
        applyScoutFindingFields(finding, from: dict)
        return finding
    }

    static func applyScoutFindingFields(_ finding: ScoutFinding, from dict: [String: Any]) {
        if let v = dict["scoutId"] as? String { finding.scoutId = v }
        finding.scoutRunId = dict["scoutRunId"] as? String
        if let v = dict["type"] as? String { finding.type = v }
        if let v = dict["title"] as? String { finding.title = v }
        if let v = dict["description"] as? String { finding.findingDescription = v }
        finding.sourceUrl = dict["sourceUrl"] as? String
        if let v = dict["sourceName"] as? String { finding.sourceName = v }
        finding.relevanceScore = dict["relevanceScore"] as? Double
        if let v = dict["reasoning"] as? String { finding.reasoning = v }
        finding.itemId = dict["itemId"] as? String
        finding.feedbackUseful = dict["feedbackUseful"] as? Bool
        finding.feedbackAt = parseDate(dict["feedbackAt"])
        if let d = parseDate(dict["createdAt"]) { finding.createdAt = d }
        if let d = parseDate(dict["updatedAt"]) { finding.updatedAt = d }
        finding.deletedAt = parseDate(dict["deletedAt"])
    }

    // MARK: - BrettMessage
    //
    // Codable-driven. The model owns its wire shape via the `Codable`
    // conformance in `Models/BrettMessage.swift`. The static helpers below
    // stay so existing tests and call sites keep working — they're now
    // thin shims over JSON{Encoder, Decoder} configured with the
    // project's date strategy.

    static func toServerPayload(_ msg: BrettMessage) -> [String: Any] {
        do {
            let data = try makeEncoder().encode(msg)
            guard let json = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) as? [String: Any] else {
                return [:]
            }
            return json
        } catch {
            BrettLog.push.error("Encode BrettMessage failed: \(String(describing: error), privacy: .public)")
            return [:]
        }
    }

    static func brettMessageFromServerJSON(_ dict: [String: Any]) -> BrettMessage? {
        do {
            let data = try JSONSerialization.data(withJSONObject: dict)
            return try makeDecoder().decode(BrettMessage.self, from: data)
        } catch {
            BrettLog.pull.error("Decode BrettMessage failed: \(String(describing: error), privacy: .public)")
            return nil
        }
    }

    /// Apply incoming server fields onto an existing local row. Kept as a
    /// dict-driven helper (rather than decoding into a fresh row and copying)
    /// so the partial-update semantics — only assign fields the server
    /// actually sent — match what the legacy implementation did.
    static func applyBrettMessageFields(_ msg: BrettMessage, from dict: [String: Any]) {
        if let v = dict["role"] as? String { msg.role = v }
        if let v = dict["content"] as? String { msg.content = v }
        msg.itemId = dict["itemId"] as? String
        msg.calendarEventId = dict["calendarEventId"] as? String
        if let d = parseDate(dict["createdAt"]) { msg.createdAt = d }
        if let d = parseDate(dict["updatedAt"]) { msg.updatedAt = d }
        msg.deletedAt = parseDate(dict["deletedAt"])
    }

    // MARK: - Attachment
    //
    // Codable-driven. The model owns its wire shape via the `Codable`
    // conformance in `Models/Attachment.swift`. The static helpers below
    // stay so existing tests and call sites keep working — they're now
    // thin shims over JSON{Encoder, Decoder} configured with the
    // project's date strategy.

    static func toServerPayload(_ att: Attachment) -> [String: Any] {
        do {
            let data = try makeEncoder().encode(att)
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return [:]
            }
            return json
        } catch {
            BrettLog.push.error("Encode Attachment failed: \(String(describing: error), privacy: .public)")
            return [:]
        }
    }

    static func attachmentFromServerJSON(_ dict: [String: Any]) -> Attachment? {
        do {
            let data = try JSONSerialization.data(withJSONObject: dict)
            return try makeDecoder().decode(Attachment.self, from: data)
        } catch {
            BrettLog.pull.error("Decode Attachment failed: \(String(describing: error), privacy: .public)")
            return nil
        }
    }

    /// Apply incoming server fields onto an existing local row. Kept as a
    /// dict-driven helper (rather than decoding into a fresh row and copying)
    /// so the partial-update semantics — only assign fields the server
    /// actually sent — match what the legacy implementation did.
    static func applyAttachmentFields(_ att: Attachment, from dict: [String: Any]) {
        if let v = dict["filename"] as? String { att.filename = v }
        if let v = dict["mimeType"] as? String { att.mimeType = v }
        if let v = dict["sizeBytes"] as? Int { att.sizeBytes = v }
        if let v = dict["storageKey"] as? String { att.storageKey = v }
        if let v = dict["itemId"] as? String { att.itemId = v }
        if let v = dict["userId"] as? String { att.userId = v }
        if let d = parseDate(dict["createdAt"]) { att.createdAt = d }
        if let d = parseDate(dict["updatedAt"]) { att.updatedAt = d }
        att.deletedAt = parseDate(dict["deletedAt"])
    }

    // MARK: - Per-table upsert wrappers

    private static func upsertItem(
        id: String,
        dict: [String: Any],
        context: ModelContext,
        respectLocalPending: Bool
    ) {
        if let existing = fetchById(Item.self, id: id, in: context) {
            if respectLocalPending && existing._syncStatus != SyncStatus.synced.rawValue {
                return
            }
            applyItemFields(existing, from: dict)
            markSynced(existing, baseUpdatedAt: dict["updatedAt"] as? String)
        } else {
            guard let new = itemFromServerJSON(dict) else { return }
            markSynced(new, baseUpdatedAt: dict["updatedAt"] as? String)
            context.insert(new)
        }
    }

    private static func upsertList(
        id: String,
        dict: [String: Any],
        context: ModelContext,
        respectLocalPending: Bool
    ) {
        if let existing = fetchById(ItemList.self, id: id, in: context) {
            if respectLocalPending && existing._syncStatus != SyncStatus.synced.rawValue {
                return
            }
            applyListFields(existing, from: dict)
            markSynced(existing, baseUpdatedAt: dict["updatedAt"] as? String)
        } else {
            guard let new = listFromServerJSON(dict) else { return }
            markSynced(new, baseUpdatedAt: dict["updatedAt"] as? String)
            context.insert(new)
        }
    }

    private static func upsertCalendarEvent(
        id: String,
        dict: [String: Any],
        context: ModelContext,
        respectLocalPending: Bool
    ) {
        if let existing = fetchById(CalendarEvent.self, id: id, in: context) {
            if respectLocalPending && existing._syncStatus != SyncStatus.synced.rawValue {
                return
            }
            applyCalendarEventFields(existing, from: dict)
            markSynced(existing, baseUpdatedAt: dict["updatedAt"] as? String)
        } else {
            guard let new = calendarEventFromServerJSON(dict) else { return }
            markSynced(new, baseUpdatedAt: dict["updatedAt"] as? String)
            context.insert(new)
        }
    }

    private static func upsertCalendarEventNote(
        id: String,
        dict: [String: Any],
        context: ModelContext,
        respectLocalPending: Bool
    ) {
        if let existing = fetchById(CalendarEventNote.self, id: id, in: context) {
            if respectLocalPending && existing._syncStatus != SyncStatus.synced.rawValue {
                return
            }
            applyCalendarEventNoteFields(existing, from: dict)
            markSynced(existing, baseUpdatedAt: dict["updatedAt"] as? String)
        } else {
            guard let new = calendarEventNoteFromServerJSON(dict) else { return }
            markSynced(new, baseUpdatedAt: dict["updatedAt"] as? String)
            context.insert(new)
        }
    }

    private static func upsertScout(
        id: String,
        dict: [String: Any],
        context: ModelContext,
        respectLocalPending: Bool
    ) {
        if let existing = fetchById(Scout.self, id: id, in: context) {
            if respectLocalPending && existing._syncStatus != SyncStatus.synced.rawValue {
                return
            }
            applyScoutFields(existing, from: dict)
            markSynced(existing, baseUpdatedAt: dict["updatedAt"] as? String)
        } else {
            guard let new = scoutFromServerJSON(dict) else { return }
            markSynced(new, baseUpdatedAt: dict["updatedAt"] as? String)
            context.insert(new)
        }
    }

    private static func upsertScoutFinding(
        id: String,
        dict: [String: Any],
        context: ModelContext,
        respectLocalPending: Bool
    ) {
        if let existing = fetchById(ScoutFinding.self, id: id, in: context) {
            if respectLocalPending && existing._syncStatus != SyncStatus.synced.rawValue {
                return
            }
            applyScoutFindingFields(existing, from: dict)
            markSynced(existing, baseUpdatedAt: dict["updatedAt"] as? String)
        } else {
            guard let new = scoutFindingFromServerJSON(dict) else { return }
            markSynced(new, baseUpdatedAt: dict["updatedAt"] as? String)
            context.insert(new)
        }
    }

    private static func upsertBrettMessage(
        id: String,
        dict: [String: Any],
        context: ModelContext,
        respectLocalPending: Bool
    ) {
        if let existing = fetchById(BrettMessage.self, id: id, in: context) {
            if respectLocalPending && existing._syncStatus != SyncStatus.synced.rawValue {
                return
            }
            applyBrettMessageFields(existing, from: dict)
            markSynced(existing, baseUpdatedAt: dict["updatedAt"] as? String)
        } else {
            guard let new = brettMessageFromServerJSON(dict) else { return }
            markSynced(new, baseUpdatedAt: dict["updatedAt"] as? String)
            context.insert(new)
        }
    }

    private static func upsertAttachment(
        id: String,
        dict: [String: Any],
        context: ModelContext,
        respectLocalPending: Bool
    ) {
        if let existing = fetchById(Attachment.self, id: id, in: context) {
            if respectLocalPending && existing._syncStatus != SyncStatus.synced.rawValue {
                return
            }
            applyAttachmentFields(existing, from: dict)
            markSynced(existing, baseUpdatedAt: dict["updatedAt"] as? String)
        } else {
            guard let new = attachmentFromServerJSON(dict) else { return }
            markSynced(new, baseUpdatedAt: dict["updatedAt"] as? String)
            context.insert(new)
        }
    }

    // MARK: - Sync metadata helpers

    /// Set the sync metadata columns to a freshly-pulled state. We switch
    /// on concrete types because SwiftData-generated `@Model` classes don't
    /// always expose properties via NSObject KVC under Swift 6.
    private static func markSynced(_ model: Any, baseUpdatedAt: String?) {
        switch model {
        case let m as Item:
            m._syncStatus = SyncStatus.synced.rawValue
            m._baseUpdatedAt = baseUpdatedAt
            m._lastError = nil
        case let m as ItemList:
            m._syncStatus = SyncStatus.synced.rawValue
            m._baseUpdatedAt = baseUpdatedAt
            m._lastError = nil
        case let m as CalendarEvent:
            m._syncStatus = SyncStatus.synced.rawValue
            m._baseUpdatedAt = baseUpdatedAt
            m._lastError = nil
        case let m as CalendarEventNote:
            m._syncStatus = SyncStatus.synced.rawValue
            m._baseUpdatedAt = baseUpdatedAt
            m._lastError = nil
        case let m as Scout:
            m._syncStatus = SyncStatus.synced.rawValue
            m._baseUpdatedAt = baseUpdatedAt
            m._lastError = nil
        case let m as ScoutFinding:
            m._syncStatus = SyncStatus.synced.rawValue
            m._baseUpdatedAt = baseUpdatedAt
            m._lastError = nil
        case let m as BrettMessage:
            m._syncStatus = SyncStatus.synced.rawValue
            m._baseUpdatedAt = baseUpdatedAt
            m._lastError = nil
        case let m as Attachment:
            m._syncStatus = SyncStatus.synced.rawValue
            m._baseUpdatedAt = baseUpdatedAt
            m._lastError = nil
        default:
            break
        }
    }

    // MARK: - Fetch

    private static func fetchById<T: PersistentModel>(
        _ type: T.Type,
        id: String,
        in context: ModelContext
    ) -> T? {
        // Dispatch to a typed predicate per model so SwiftData uses the
        // unique-id index instead of materialising every row. SwiftData's
        // #Predicate can't be written generically over an `id` key path, so
        // we route through a concrete switch; the cast back to T is safe
        // because each branch fetches the exact type.
        switch type {
        case is Item.Type:
            let pred = #Predicate<Item> { $0.id == id }
            var d = FetchDescriptor<Item>(predicate: pred); d.fetchLimit = 1
            return (try? context.fetch(d).first) as? T
        case is ItemList.Type:
            let pred = #Predicate<ItemList> { $0.id == id }
            var d = FetchDescriptor<ItemList>(predicate: pred); d.fetchLimit = 1
            return (try? context.fetch(d).first) as? T
        case is CalendarEvent.Type:
            let pred = #Predicate<CalendarEvent> { $0.id == id }
            var d = FetchDescriptor<CalendarEvent>(predicate: pred); d.fetchLimit = 1
            return (try? context.fetch(d).first) as? T
        case is CalendarEventNote.Type:
            let pred = #Predicate<CalendarEventNote> { $0.id == id }
            var d = FetchDescriptor<CalendarEventNote>(predicate: pred); d.fetchLimit = 1
            return (try? context.fetch(d).first) as? T
        case is Scout.Type:
            let pred = #Predicate<Scout> { $0.id == id }
            var d = FetchDescriptor<Scout>(predicate: pred); d.fetchLimit = 1
            return (try? context.fetch(d).first) as? T
        case is ScoutFinding.Type:
            let pred = #Predicate<ScoutFinding> { $0.id == id }
            var d = FetchDescriptor<ScoutFinding>(predicate: pred); d.fetchLimit = 1
            return (try? context.fetch(d).first) as? T
        case is BrettMessage.Type:
            let pred = #Predicate<BrettMessage> { $0.id == id }
            var d = FetchDescriptor<BrettMessage>(predicate: pred); d.fetchLimit = 1
            return (try? context.fetch(d).first) as? T
        case is Attachment.Type:
            let pred = #Predicate<Attachment> { $0.id == id }
            var d = FetchDescriptor<Attachment>(predicate: pred); d.fetchLimit = 1
            return (try? context.fetch(d).first) as? T
        default:
            return nil
        }
    }

    // MARK: - Date / JSON helpers

    /// Thin forwarders to the shared `BrettDate` utility so the mapper
    /// doesn't have its own formatter statics (which errored under Swift 6
    /// strict concurrency on newer Xcode). Sync still churns through
    /// hundreds of calls per pull — `BrettDate.iso8601WithFractional` is
    /// the single cached instance.
    static func isoString(_ date: Date?) -> String? {
        BrettDate.isoString(date)
    }

    static func parseDate(_ raw: Any?) -> Date? {
        BrettDate.parseISO(raw)
    }

    // MARK: - Codable factories (Wave C migration)
    //
    // Per-model `Codable` conformances delegate to `JSONEncoder` /
    // `JSONDecoder`, but Foundation's defaults disagree with our wire
    // format on dates. These factories install the same ISO-8601-with-
    // fractional-seconds strategy the hand-written mappers use, so a
    // model's `Codable` round-trip stays byte-compatible with the legacy
    // dict-based path.
    //
    // Date strategy:
    //   • Decode: try `BrettDate.parseISO` (lenient — handles fractional
    //     and non-fractional ISO-8601). Throws on unparseable strings so
    //     the failure surfaces instead of silently defaulting to epoch.
    //   • Encode: `BrettDate.isoString` (fractional ISO-8601 — what the
    //     server's Zod parsers expect on inbound writes).
    //
    // Null-handling: keep nil dates out of the wire shape via
    // `decodeIfPresent` / `encodeIfPresent` at the property level — the
    // strategy itself never sees `nil`.

    fileprivate static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            guard let date = BrettDate.parseISO(raw) else {
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Invalid ISO-8601 date string: \(raw)"
                )
            }
            return date
        }
        return decoder
    }

    fileprivate static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(BrettDate.isoString(date))
        }
        return encoder
    }

    /// Decode a JSON string (as stored on-device) back into a dict/array so
    /// we can slot it into a server payload. Returns nil for nil / malformed.
    static func jsonDecoded(_ rawString: String?) -> Any? {
        guard let rawString, let data = rawString.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    /// Encode a dict/array back to a JSON string for on-device storage.
    static func jsonEncoded(_ any: Any?) -> String? {
        guard let any, !(any is NSNull) else { return nil }
        guard JSONSerialization.isValidJSONObject(any) else { return nil }
        guard let data = try? JSONSerialization.data(withJSONObject: any) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
