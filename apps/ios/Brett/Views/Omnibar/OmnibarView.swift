import SwiftData
import SwiftUI

/// Glass pill at the bottom of the screen — the entry point for every
/// capture action in the app. Text input is run through `SmartParser`
/// on submit so the user can type natural-language dates, `#listname`
/// tags, or questions without any structured UI. Tapping the mic switches
/// to voice mode (speech-to-text with a live waveform).
struct OmnibarView: View {
    let placeholder: String
    /// 0=Lists, 1=Inbox, 2=Today, 3=Calendar. Drives parser defaults.
    /// (`MainContainer.currentPage` is the source of truth — keep
    /// these in sync if you re-order the tabs.)
    var currentPage: Int = 2
    /// When set (e.g. when the Omnibar is hosted inside ListView) new
    /// items default to this list unless the user explicitly tags a
    /// different list via `#name`.
    var listId: String? = nil

    /// Background opacity for the calm-hero adaptive chrome. At the
    /// top of Today this drops toward 0.55 so the photo breathes;
    /// past the hero (and on every other page) it's 1.0 so the glass
    /// reads substantively against busy lists. `MainContainer` drives
    /// this from the same scroll-offset preference key as the
    /// view-pills row, so all calm-hero affordances transition
    /// together. Declared before `onSelectList` so call-sites that
    /// supply both can match the synthesised member-wise init's
    /// expected argument order.
    var backgroundOpacity: Double = 1.0

    var onSelectList: ((String) -> Void)? = nil

    @Environment(AuthManager.self) private var authManager

    @State private var itemStore = ItemStore(
        context: PersistenceController.shared.container.mainContext
    )
    // ListStore previously held here for `fetchAll`-based name resolution.
    // The parser now runs a direct `FetchDescriptor<ItemList>` inside
    // `submit()` (see below), so the store is unnecessary here.

    @State private var inputText = ""
    @State private var isVoiceMode = false
    @State private var submitPulse = false
    @State private var parseFailure = false
    @State private var voiceRecognizer = VoiceRecognizer()

    @FocusState private var isFocused: Bool

    var body: some View {
        pill
            .overlay {
                if isVoiceMode {
                    VoiceModeOverlay(
                        recognizer: voiceRecognizer,
                        onComplete: { transcript in
                            inputText = transcript
                            exitVoiceMode()
                            submit()
                        },
                        onDismiss: {
                            exitVoiceMode()
                        }
                    )
                    .transition(.opacity)
                    .zIndex(10)
                }
            }
    }

    // MARK: - Pill

    private var pill: some View {
        HStack(spacing: 8) {
            // Text field with overlaid mixed-styled placeholder. The
            // placeholder string carries `**…**` markers around the
            // segment that should bold (per the v18 mockup `<strong>`
            // styling — e.g. "Add or **ask Brett…**" emphasises the
            // verb-object). SwiftUI's `prompt:` only takes a flat
            // `Text`, which can't mix weights, so we render the
            // placeholder as our own overlay and hide the TextField's
            // own prompt.
            ZStack(alignment: .leading) {
                if !hasText {
                    placeholderView
                        .allowsHitTesting(false)
                }
                TextField("", text: $inputText)
                    .font(.system(size: 15))
                    .foregroundStyle(Color.white.opacity(0.85))
                    .tint(BrettColors.gold)
                    .focused($isFocused)
                    .submitLabel(.send)
                    .onSubmit { submit() }
                    .accessibilityIdentifier("omnibar.input")
            }

            // Right: send when text present, mic when empty. Both
            // render as a 38pt antique-gold-filled circle per the
            // v18 mockup `.omni-mic` — bg `rgba(199,154,77,0.85)`,
            // border `rgba(255,220,180,0.30)`, drop shadow
            // `0 4px 10px rgba(199,154,77,0.30)`. Glyph is a
            // STROKED outline (`fill: none; stroke-width: 1.8`) —
            // the previous `mic.fill` was a solid white silhouette,
            // wrong family. SF Symbols' `mic` is the outline variant.
            if hasText {
                Button { submit() } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                        .background { goldButtonCircle }
                }
                .transition(.scale(scale: 0.5).combined(with: .opacity))
                .accessibilityIdentifier("omnibar.send")
            } else {
                Button { enterVoiceMode() } label: {
                    Image(systemName: "mic")
                        .font(.system(size: 16, weight: .regular))
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                        .background { goldButtonCircle }
                }
                .accessibilityLabel("Voice input")
            }
        }
        .padding(.leading, 20)
        .padding(.trailing, 6)
        .frame(height: 56)
        .background {
            // Tinted dark-warm capsule with a real drop shadow per the
            // v18 mockup spec — `background: rgba(20,14,18, 0.55);
            // backdrop-filter: blur(36px) saturate(180%); border: 1px
            // rgba(255,255,255,0.14); box-shadow: 0 16px 36px
            // rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.10);`.
            //
            // Was using `.thinMaterial` previously which gave us the
            // standard iOS-translucent-white glass look — wrong family
            // for a calm-hero pill that should read as a dark warm
            // object floating over the wash, not as iOS chrome.
            ZStack {
                Capsule()
                    .fill(Color(red: 20/255, green: 14/255, blue: 18/255).opacity(backgroundOpacity * 0.85 + 0.10))
                    .background(
                        Capsule()
                            .fill(.ultraThinMaterial)
                            .opacity(backgroundOpacity)
                    )
                    .overlay {
                        // Outer hairline border + a subtle top inner
                        // highlight (mockup's `inset 0 1px 0 ...`).
                        Capsule()
                            .strokeBorder(Color.white.opacity(0.14), lineWidth: 1)
                    }
                    .overlay(alignment: .top) {
                        Capsule()
                            .frame(height: 1)
                            .foregroundStyle(Color.white.opacity(0.10))
                            .padding(.horizontal, 10)
                    }
                    .shadow(color: Color.black.opacity(0.50), radius: 18, x: 0, y: 16)

                Capsule()
                    .stroke(
                        BrettColors.gold.opacity(submitPulse ? 0.8 : 0.0),
                        lineWidth: 1
                    )
                    .animation(.easeOut(duration: 0.15), value: submitPulse)

                Capsule()
                    .stroke(
                        BrettColors.error.opacity(parseFailure ? 0.65 : 0.0),
                        lineWidth: 1
                    )
                    .animation(.easeOut(duration: 0.2), value: parseFailure)
            }
            .animation(
                BrettAnimation.respectingReduceMotion(.easeOut(duration: 0.20)),
                value: backgroundOpacity
            )
        }
        // Floating margin from the screen edges (calm-hero spec — the
        // pill is a discrete object, not edge-welded chrome). Bottom
        // padding keeps it clear of the home indicator.
        .padding(.horizontal, 14)
        .padding(.bottom, 8)
        .animation(.easeOut(duration: 0.15), value: hasText)
    }

    /// Mixed-styled placeholder per v18 mockup — `<strong>` segments
    /// (delimited by `**…**` in the placeholder string) render
    /// at white/0.85 weight medium; the surrounding base segments
    /// stay at white/0.55 regular. Built as a SwiftUI Text by
    /// concatenating styled spans so the whole placeholder reads
    /// as one line with mixed weights, no manual string splicing.
    private var placeholderView: some View {
        let segments = OmnibarPlaceholder.parse(placeholder)
        return segments.reduce(Text("")) { acc, seg in
            let span = Text(seg.text)
                .foregroundStyle(seg.bold ? Color.white.opacity(0.85) : Color.white.opacity(0.55))
                .fontWeight(seg.bold ? .medium : .regular)
            return acc + span
        }
        .font(.system(size: 15))
    }

    /// Shared antique-gold-filled circle for both send + mic buttons.
    /// Mockup `.omni-mic`: width 38, bg `rgba(199,154,77,0.85)`,
    /// border 1px `rgba(255,220,180,0.30)`, drop shadow
    /// `0 4px 10px rgba(199,154,77,0.30)`.
    private var goldButtonCircle: some View {
        Circle()
            .fill(BrettColors.mockupGold.opacity(0.85))
            .overlay {
                Circle().strokeBorder(
                    Color(red: 1.0, green: 0.86, blue: 0.71).opacity(0.30),
                    lineWidth: 1
                )
            }
            .shadow(color: BrettColors.mockupGold.opacity(0.30), radius: 5, x: 0, y: 4)
    }

    // MARK: - Derived

    private var hasText: Bool {
        !inputText.trimmingCharacters(in: .whitespaces).isEmpty
    }

    // MARK: - Submit

    private func submit() {
        let trimmed = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        // Scope to the current user — #listname tags should only resolve
        // against lists the signed-in account owns. Without userId, a
        // late-arriving sync row from a prior session could capture the
        // tag intent. Direct `FetchDescriptor` instead of going through
        // the soon-to-be-deleted `ListStore.fetchAll`; this is a
        // submit-time read with no need to subscribe to changes.
        let realLists: [ItemList] = {
            guard let uid = authManager.currentUser?.id else { return [] }
            let context = PersistenceController.shared.mainContext
            var descriptor = FetchDescriptor<ItemList>(
                sortBy: [SortDescriptor(\.sortOrder)]
            )
            descriptor.predicate = #Predicate { list in
                list.deletedAt == nil && list.userId == uid
            }
            return (try? context.fetch(descriptor)) ?? []
        }()
        let lists = realLists.map { SmartParser.ListRef(id: $0.id, name: $0.name) }
        let parsed = SmartParser.parse(
            trimmed,
            context: SmartParser.ParseContext(currentPage: currentPage, lists: lists)
        )

        guard !parsed.title.isEmpty else {
            // Nothing meaningful left after stripping tokens — treat as a
            // parse failure and flash the border red.
            HapticManager.error()
            flashParseFailure()
            return
        }

        // Route through ItemStore (sync-backed). Without a signed-in user
        // the omnibar shouldn't be reachable (root is gated by SignInView),
        // but if we somehow end up here anyway, just bail with a haptic.
        guard let userId = authManager.currentUser?.id else {
            HapticManager.error()
            flashParseFailure()
            return
        }

        let itemType: ItemType = parsed.kind == .event ? .content : .task

        // List context precedence: explicit `#list` in input > host view's
        // `listId` prop > none. Inside ListView the hosting view passes
        // its current listId so new items land in that list unless the
        // user tagged a different one.
        let resolvedListId = parsed.listId ?? listId

        // Today-view default: new tasks captured from the Today page
        // should land in Today, not Inbox. Parser output takes precedence
        // — if the user typed a natural-language date (or none because
        // they were on Inbox) we respect it. Mirrors the desktop omnibar
        // behaviour in `apps/desktop/src/api/omnibar.ts`.
        // Today is now page index 2 (Lists/Inbox/Today/Calendar).
        let resolvedDueDate: Date? = {
            if let parsedDue = parsed.dueDate { return parsedDue }
            if currentPage == 2 && itemType == .task {
                return Calendar.current.startOfDay(for: Date())
            }
            return nil
        }()

        let created: Item
        do {
            created = try itemStore.create(
                userId: userId,
                title: parsed.title,
                type: itemType,
                dueDate: resolvedDueDate,
                listId: resolvedListId
            )
        } catch {
            // Atomic create failed (SwiftData save threw). The row was
            // rolled back, so the user sees nothing happen — flash the
            // failure border + haptic to surface the loss instead of
            // silently swallowing it.
            BrettLog.store.error("Omnibar create failed: \(String(describing: error), privacy: .public)")
            HapticManager.error()
            flashParseFailure()
            return
        }

        // Hand the new id to NavStore so the host page can scroll
        // it into view. Without this, adding a task to a long list looks
        // like nothing happened — the row appears off-screen.
        NavStore.shared.lastCreatedItemId = created.id

        // Reminder mapping: apply as a follow-up mutation so ItemStore.create
        // doesn't need a reminder parameter. Uses the just-created item id
        // directly rather than re-querying.
        if let reminder = parsed.reminder {
            itemStore.update(
                id: created.id,
                changes: ["reminder": reminder],
                previousValues: ["reminder": NSNull()],
                userId: userId
            )
        }

        #if DEBUG
        if parsed.kind == .question {
            print("[Omnibar] Question captured — future: open Brett chat: \(parsed.title)")
        }
        #endif

        HapticManager.light()
        flashSubmitPulse()

        inputText = ""
        isFocused = false
    }

    private func flashSubmitPulse() {
        submitPulse = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            submitPulse = false
        }
    }

    private func flashParseFailure() {
        parseFailure = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.20) {
            parseFailure = false
        }
    }

    // MARK: - Voice mode

    private func enterVoiceMode() {
        HapticManager.heavy()
        // Fall back gracefully if speech recognition isn't offered in this
        // locale / device — keep the keyboard flow usable.
        guard voiceRecognizer.isAvailable else {
            #if DEBUG
            print("[Omnibar] Speech recognizer unavailable — voice mode disabled.")
            #endif
            return
        }
        isFocused = false

        voiceRecognizer.requestAuthorization { ok in
            guard ok else { return }
            withAnimation(.easeOut(duration: 0.2)) {
                isVoiceMode = true
            }
            voiceRecognizer.start {
                // Fired after silence window — auto-submit via onComplete.
                // The overlay's own transcript handler delivers the text
                // back through `onComplete`, so when silence triggers stop
                // we rely on the transcript that's already been populated.
                DispatchQueue.main.async {
                    let transcript = voiceRecognizer.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !transcript.isEmpty {
                        inputText = transcript
                        exitVoiceMode()
                        submit()
                    } else {
                        exitVoiceMode()
                    }
                }
            }
        }
    }

    private func exitVoiceMode() {
        HapticManager.light()
        withAnimation(.easeOut(duration: 0.2)) {
            isVoiceMode = false
        }
        voiceRecognizer.stop(fireSilence: false)
    }
}

/// Tiny parser for the omnibar's mixed-styled placeholder strings.
/// Splits on `**…**` markers so callers can write the placeholder
/// like Markdown — `"Add or **ask Brett…**"` becomes two segments,
/// the second flagged `bold`. Matches the v18 mockup `<strong>`
/// styling (`.omni-input strong { font-weight: 500 }`).
enum OmnibarPlaceholder {
    struct Segment {
        let text: String
        let bold: Bool
    }

    /// Parse a placeholder string into bold/non-bold segments. Pure,
    /// allocation-light, no regex — splits on `**` and toggles a
    /// flag. Unbalanced markers are passed through as literal text
    /// so a typo never crashes the omnibar.
    static func parse(_ raw: String) -> [Segment] {
        let parts = raw.components(separatedBy: "**")
        // Even number of `**` markers ⇒ even count of parts ⇒
        // bold/non-bold alternation works out. Odd ⇒ orphan
        // marker; treat all as plain text to avoid silently
        // hiding a chunk of the placeholder.
        let isBalanced = parts.count.isMultiple(of: 2) == false
        guard isBalanced else {
            return [Segment(text: raw.replacingOccurrences(of: "**", with: ""), bold: false)]
        }
        return parts.enumerated().map { index, text in
            Segment(text: text, bold: index.isMultiple(of: 2) == false)
        }
    }
}
