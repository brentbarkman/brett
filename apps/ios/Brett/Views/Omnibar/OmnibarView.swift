import SwiftUI

/// Glass pill at the bottom of the screen — the entry point for every
/// capture action in the app. Text input is run through `SmartParser`
/// on submit so the user can type natural-language dates, `#listname`
/// tags, or questions without any structured UI. Tapping the mic switches
/// to voice mode (speech-to-text with a live waveform).
struct OmnibarView: View {
    @Bindable var store: MockStore
    let placeholder: String
    /// 0 = Inbox, 1 = Today, 2 = Calendar. Drives parser defaults.
    /// Defaults to `.task` (Today) so ListView's legacy call site keeps
    /// working without modification.
    var currentPage: Int = 1
    var onSelectList: ((String) -> Void)? = nil

    @Environment(AuthManager.self) private var authManager

    /// Real store used for sync-backed capture. Falls back to MockStore
    /// only when there's no signed-in user (e.g. preview / UITest seed).
    @State private var itemStore = ItemStore(
        context: PersistenceController.shared.container.mainContext
    )
    @State private var listStore = ListStore(
        context: PersistenceController.shared.container.mainContext
    )

    @State private var inputText = ""
    @State private var showListDrawer = false
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
            .sheet(isPresented: $showListDrawer) {
                ListDrawer(store: store, onSelectList: onSelectList)
                    .presentationDetents([.medium])
                    .presentationDragIndicator(.visible)
                    .presentationBackground(.ultraThinMaterial)
            }
    }

    // MARK: - Pill

    private var pill: some View {
        HStack(spacing: 8) {
            // Left: list drawer button.
            Button {
                showListDrawer = true
            } label: {
                Image(systemName: "list.bullet")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.40))
                    .frame(width: 28, height: 28)
            }

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
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { isFocused = false }
                        .foregroundStyle(BrettColors.gold)
                }
            }

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

        // Prefer the real list store (so #listname matches sync-backed lists
        // first). Fall back to MockStore lists only if SwiftData has none —
        // preserves the prototype flow.
        let realLists = listStore.fetchAll()  // excludes archived by default
        let lists: [SmartParser.ListRef]
        if !realLists.isEmpty {
            lists = realLists.map { SmartParser.ListRef(id: $0.id, name: $0.name) }
        } else {
            lists = store.lists.map { SmartParser.ListRef(id: $0.id, name: $0.name) }
        }
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

        // Route through ItemStore (sync-backed) when a user is signed in.
        // MockStore stays as fallback so the SwiftUI previews + unauthed
        // UITests keep working. Task/event/question all persist as items;
        // the `question` kind is tagged for a future chat-route; `event` is
        // captured as a content item so it's not lost until the calendar
        // draft flow lands.
        if let userId = authManager.currentUser?.id {
            // Resolve list id against the real ListStore first (the parser
            // was given the set of real lists); otherwise the parsed id is
            // still a valid Swift UUID and sync will upsert.
            let resolvedListId = parsed.listId
            let itemType: ItemType = parsed.kind == .event ? .content : .task
            _ = itemStore.create(
                userId: userId,
                title: parsed.title,
                type: itemType,
                dueDate: parsed.dueDate,
                listId: resolvedListId
            )
            // Reminder mapping: apply as a second mutation if parser found
            // one (ItemStore.create has no reminder param, so we patch it
            // in on the freshly-created record).
            if let reminder = parsed.reminder {
                if let created = itemStore.fetchAll(listId: resolvedListId, status: nil)
                    .first(where: { $0.title == parsed.title && $0.reminder == nil }) {
                    itemStore.update(
                        id: created.id,
                        changes: ["reminder": reminder],
                        previousValues: ["reminder": NSNull()]
                    )
                }
            }
            #if DEBUG
            if parsed.kind == .question {
                print("[Omnibar] Question captured — future: open Brett chat: \(parsed.title)")
            }
            #endif
        } else {
            // No auth context — prototype/preview path.
            store.addItem(
                title: parsed.title,
                dueDate: parsed.dueDate,
                listId: parsed.listId
            )
        }

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
