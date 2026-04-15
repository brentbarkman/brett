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

        let lists = store.lists.map { SmartParser.ListRef(id: $0.id, name: $0.name) }
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

        switch parsed.kind {
        case .task, .event, .question:
            // MockStore has a single `addItem` API — the parsed kind and
            // reminder are preserved via listName / dueDate for now; a
            // future pass will thread `ItemType` and `ReminderType` all
            // the way through once the Omnibar migrates off MockStore.
            store.addItem(
                title: parsed.title,
                dueDate: parsed.dueDate,
                listId: parsed.listId
            )
            #if DEBUG
            if parsed.kind == .question {
                print("[Omnibar] Question captured — would open Brett chat: \(parsed.title)")
            } else if parsed.kind == .event {
                print("[Omnibar] Event captured — would open calendar draft: \(parsed.title)")
            }
            #endif
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
