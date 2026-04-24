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
    var onSelectList: ((String) -> Void)? = nil

    @Environment(AuthManager.self) private var authManager

    @State private var itemStore = ItemStore(
        context: PersistenceController.shared.container.mainContext
    )
    @State private var listStore = ListStore(
        context: PersistenceController.shared.container.mainContext
    )

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
            // List-drawer button removed — Lists has its own tab at the
            // leftmost position, so the omnibar doesn't need a list
            // picker anymore. The `#listname` shortcut still works for
            // power users who want to assign a list inline.

            // Text field.
            TextField("", text: $inputText, prompt:
                Text(placeholder).foregroundStyle(BrettColors.textPlaceholder)
            )
            .font(.system(size: 15))
            .foregroundStyle(Color.white.opacity(0.85))
            .tint(BrettColors.gold)
            .focused($isFocused)
            .submitLabel(.send)
            .onSubmit { submit() }
            .accessibilityIdentifier("omnibar.input")
            // `.keyboard` Done button was here — removed because it
            // visually overlapped the gold send button and created a
            // dual-submit UX. Return key + send button are enough;
            // tap-outside-to-dismiss (wired in MainContainer) handles
            // the "get rid of the keyboard without submitting" case.

            // Right: send when text present, mic when empty.
            if hasText {
                Button { submit() } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 26, height: 26)
                        .background(BrettColors.gold, in: Circle())
                }
                .transition(.scale(scale: 0.5).combined(with: .opacity))
                .accessibilityIdentifier("omnibar.send")
            } else {
                Button { enterVoiceMode() } label: {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.35))
                        .frame(width: 26, height: 26)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background {
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(alignment: .top) {
                    Rectangle()
                        .fill(Color.white.opacity(0.04))
                        .frame(height: 0.5)
                }
                .overlay {
                    Rectangle()
                        .stroke(
                            BrettColors.gold.opacity(submitPulse ? 0.8 : 0.0),
                            lineWidth: 1
                        )
                        .animation(.easeOut(duration: 0.15), value: submitPulse)
                }
                .overlay {
                    Rectangle()
                        .stroke(
                            BrettColors.error.opacity(parseFailure ? 0.65 : 0.0),
                            lineWidth: 1
                        )
                        .animation(.easeOut(duration: 0.2), value: parseFailure)
                }
                .ignoresSafeArea(edges: .bottom)
        }
        .animation(.easeOut(duration: 0.15), value: hasText)
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
        // tag intent.
        let realLists = listStore.fetchAll(userId: authManager.currentUser?.id)
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

        let created = itemStore.create(
            userId: userId,
            title: parsed.title,
            type: itemType,
            dueDate: resolvedDueDate,
            listId: resolvedListId
        )

        // Hand the new id to SelectionStore so the host page can scroll
        // it into view. Without this, adding a task to a long list looks
        // like nothing happened — the row appears off-screen.
        SelectionStore.shared.lastCreatedItemId = created.id

        // Reminder mapping: apply as a follow-up mutation so ItemStore.create
        // doesn't need a reminder parameter. Uses the just-created item id
        // directly rather than re-querying.
        if let reminder = parsed.reminder {
            itemStore.update(
                id: created.id,
                changes: ["reminder": reminder],
                previousValues: ["reminder": NSNull()]
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
