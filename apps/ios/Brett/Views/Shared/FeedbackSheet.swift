import SwiftUI
import UIKit

/// Lightweight feedback form. Mirrors the desktop's FeedbackModal but
/// trimmed to fit a half-sheet: type picker, title, description, send.
/// No screenshot/diagnostics yet — we send the bare minimum that the
/// server endpoint accepts so the channel works end-to-end on day one.
struct FeedbackSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var authManager

    enum FeedbackType: String, CaseIterable, Identifiable {
        case bug, feature, enhancement
        var id: String { rawValue }
        var label: String {
            switch self {
            case .bug: return "Bug"
            case .feature: return "Feature"
            case .enhancement: return "Enhancement"
            }
        }
        var placeholder: String {
            switch self {
            case .bug: return "What happened? What did you expect?"
            case .feature: return "What would you like to see?"
            case .enhancement: return "What could be better?"
            }
        }
    }

    @State private var type: FeedbackType = .bug
    @State private var title: String = ""
    @State private var description: String = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var successMessage: String?

    private var canSubmit: Bool {
        !title.trimmingCharacters(in: .whitespaces).isEmpty &&
        !description.trimmingCharacters(in: .whitespaces).isEmpty &&
        !isSubmitting
    }

    var body: some View {
        // Rely on the caller's .presentationBackground(Color.black) — don't
        // render the photography wallpaper inside the sheet. The wallpaper
        // dropped contrast under the inputs and made the labels/help text
        // hard to read. Other sheets (TaskDetailView, SearchSheet) follow
        // the same pattern.
        VStack(spacing: 16) {
            header

            Picker("Type", selection: $type) {
                ForEach(FeedbackType.allCases) { t in
                    Text(t.label).tag(t)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 20)

            titleField
            descriptionField

            if let errorMessage {
                Text(errorMessage)
                    .font(.system(size: 13))
                    .foregroundStyle(BrettColors.error)
                    .padding(.horizontal, 20)
            }

            if let successMessage {
                Text(successMessage)
                    .font(.system(size: 13))
                    .foregroundStyle(BrettColors.success)
                    .padding(.horizontal, 20)
            }

            Spacer(minLength: 0)

            submitButton
        }
        .padding(.top, 20)
        .padding(.bottom, 24)
    }

    private var header: some View {
        HStack {
            Button("Cancel") { dismiss() }
                .foregroundStyle(Color.white.opacity(0.55))

            Spacer()

            Text("Send feedback")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)

            Spacer()

            // Right-side spacer so the title centers visually.
            Color.clear.frame(width: 60, height: 1)
        }
        .padding(.horizontal, 20)
    }

    private var titleField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("TITLE")
                .font(.system(size: 10, weight: .semibold))
                .tracking(1.5)
                .foregroundStyle(Color.white.opacity(0.40))

            NeutralPlaceholder("One-liner", isEmpty: title.isEmpty) {
                TextField("", text: $title)
                    .textFieldStyle(.plain)
                    .foregroundStyle(.white)
                    .tint(BrettColors.gold)
            }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.white.opacity(0.05))
                        .overlay {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.10), lineWidth: 0.5)
                        }
                }
        }
        .padding(.horizontal, 20)
    }

    private var descriptionField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("DETAILS")
                .font(.system(size: 10, weight: .semibold))
                .tracking(1.5)
                .foregroundStyle(Color.white.opacity(0.40))

            NeutralPlaceholder(
                type.placeholder,
                isEmpty: description.isEmpty,
                alignment: .topLeading
            ) {
                TextField("", text: $description, axis: .vertical)
                    .textFieldStyle(.plain)
                    .foregroundStyle(.white)
                    .tint(BrettColors.gold)
                    .lineLimit(4...10)
            }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.white.opacity(0.05))
                        .overlay {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.10), lineWidth: 0.5)
                        }
                }
        }
        .padding(.horizontal, 20)
    }

    private var submitButton: some View {
        Button {
            Task { await submit() }
        } label: {
            HStack(spacing: 8) {
                if isSubmitting {
                    ProgressView().tint(.white).scaleEffect(0.85)
                }
                Text(isSubmitting ? "Sending…" : "Send feedback")
                    .font(.system(size: 15, weight: .semibold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(
                BrettColors.gold.opacity(canSubmit ? 1.0 : 0.35),
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
        }
        .buttonStyle(.plain)
        .disabled(!canSubmit)
        .padding(.horizontal, 20)
    }

    // MARK: - Submit

    private func submit() async {
        isSubmitting = true
        errorMessage = nil
        successMessage = nil
        defer { isSubmitting = false }

        // Server expects `{ type, title, description, diagnostics: { ... } }`.
        // Diagnostics on iOS v1 is just app+OS info — no breadcrumbs, no
        // screenshot. Future enhancement: add CMMotionManager-tagged
        // breadcrumbs and a UIKit screenshot like the desktop sends.
        let diagnostics: [String: Any] = [
            "appVersion": appVersion,
            "os": "iOS \(UIDevice.current.systemVersion)",
            "currentRoute": "iOS",
            "consoleErrors": [],
            "consoleLogs": [],
            "failedApiCalls": [],
            "breadcrumbs": [],
            "userId": authManager.currentUser?.id ?? "",
        ]

        let payload: [String: Any] = [
            "type": type.rawValue,
            "title": String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200)),
            "description": String(description.trimmingCharacters(in: .whitespacesAndNewlines).prefix(4000)),
            "diagnostics": diagnostics,
        ]

        do {
            let body = try JSONSerialization.data(withJSONObject: payload)
            _ = try await APIClient.shared.rawRequest(
                path: "/feedback",
                method: "POST",
                body: body
            )
            HapticManager.success()
            successMessage = "Thanks — sent. We'll take a look."
            // Auto-dismiss after a beat so the user sees confirmation.
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            dismiss()
        } catch {
            HapticManager.error()
            errorMessage = (error as? APIError)?.userFacingMessage ?? "Couldn't send. Try again later."
        }
    }

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
    }
}
