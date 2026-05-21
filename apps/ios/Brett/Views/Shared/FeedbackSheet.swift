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
    /// True for ~2 seconds after the user taps "Copy report" — drives
    /// the inline confirmation that swaps the button label to
    /// "Copied" so the action feels acknowledged.
    @State private var didCopyReport = false

    /// Per-feedback request timeout. Tighter than the APIClient default
    /// (30s) because the user is sitting in front of a half-sheet
    /// staring at a spinner — failing fast and offering Copy is
    /// kinder than a 30-second hang. 5 seconds catches Railway-edge
    /// 502s (which fire ~15s into a request) by giving up before
    /// the gateway does.
    private static let feedbackRequestTimeout: TimeInterval = 5

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
                VStack(alignment: .leading, spacing: 10) {
                    Text(errorMessage)
                        .font(.system(size: 13))
                        .foregroundStyle(BrettColors.error)

                    // Recovery row — Retry resubmits using the same body
                    // the user already typed; Copy writes the full report
                    // to the pasteboard so they can paste into email /
                    // Slack manually when Brett is unreachable for longer
                    // than they want to wait. Both stay visible until
                    // the next submit attempt clears `errorMessage`.
                    HStack(spacing: 10) {
                        Button {
                            Task { await submit() }
                        } label: {
                            Text("Try again")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Color.white.opacity(0.85))
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(
                                    RoundedRectangle(cornerRadius: 999, style: .continuous)
                                        .fill(Color.white.opacity(0.10))
                                )
                        }
                        .buttonStyle(.plain)
                        .disabled(isSubmitting)

                        Button {
                            copyReportToPasteboard()
                        } label: {
                            Text(didCopyReport ? "Copied" : "Copy report")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Color.white.opacity(0.85))
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(
                                    RoundedRectangle(cornerRadius: 999, style: .continuous)
                                        .fill(Color.white.opacity(didCopyReport ? 0.16 : 0.10))
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }
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
        didCopyReport = false
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
                body: body,
                timeout: Self.feedbackRequestTimeout
            )
            HapticManager.success()
            successMessage = "Thanks — sent. We'll take a look."
            // Auto-dismiss after a beat so the user sees confirmation.
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            dismiss()
        } catch {
            HapticManager.error()
            errorMessage = Self.errorCopy(for: error)
        }
    }

    /// Copy the report (type + title + description + minimal diagnostics)
    /// to the system pasteboard so the user can paste it into email or
    /// Slack when Brett is unreachable. The copied form is plain text —
    /// not the JSON payload — because the destination is human, not the
    /// API. Briefly flips `didCopyReport` so the button label confirms
    /// the action.
    private func copyReportToPasteboard() {
        UIPasteboard.general.string = Self.formatReportForClipboard(
            type: type,
            title: title,
            description: description,
            appVersion: appVersion,
            os: "iOS \(UIDevice.current.systemVersion)",
            userId: authManager.currentUser?.id
        )
        HapticManager.success()
        didCopyReport = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 2_000_000_000) // 2s
            didCopyReport = false
        }
    }

    // MARK: - Pure helpers (testable)

    /// Map a thrown error from `/feedback` into user-facing copy. Three
    /// branches:
    ///
    ///  1. Transport-shaped APIErrors (offline / serverError /
    ///     rateLimited / unknown / decodingFailed) → unified "Brett is
    ///     unreachable" message so the user just knows to retry or copy,
    ///     not the underlying HTTP status. Transport errors are the
    ///     dominant case for `/feedback` in practice.
    ///  2. Sign-in expired (unauthorized) → distinct message because the
    ///     fix is different (the user needs to reopen / re-auth, not
    ///     retry the same payload).
    ///  3. Validation / credential errors → defer to the existing
    ///     `userFacingMessage` since the server provided a specific
    ///     message worth surfacing.
    ///  4. Non-APIError fallback → same as transport-shaped: assume
    ///     unreachable. Anything that escaped as a plain `Error` from
    ///     `APIClient.rawRequest` is functionally a transport problem
    ///     (the client wraps known categories in APIError).
    ///
    /// `internal` (default access) so tests can hit it without
    /// standing up the full SwiftUI view.
    static func errorCopy(for error: Error) -> String {
        let unreachable = "Couldn't send — Brett is unreachable. Try again or copy your report."

        guard let apiError = error as? APIError else {
            return unreachable
        }

        switch apiError {
        case .offline, .serverError, .rateLimited, .unknown, .decodingFailed:
            return unreachable
        case .unauthorized:
            return "Sign-in expired. Reopen the app and try again."
        case .invalidCredentials, .validation, .keychainWriteFailed:
            // Server / client provided a specific message worth surfacing
            // (validation rules, credential hints, keychain failure copy).
            return apiError.userFacingMessage
        }
    }

    /// Compose the plain-text report a user can paste into email or
    /// Slack. Includes the minimal diagnostics needed for triage
    /// (version, OS, user id) but no breadcrumbs / console dumps —
    /// the user is going to paste this into a chat, not a debugger.
    /// Pure helper so tests can pin the exact format.
    static func formatReportForClipboard(
        type: FeedbackType,
        title: String,
        description: String,
        appVersion: String,
        os: String,
        userId: String?
    ) -> String {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDescription = description.trimmingCharacters(in: .whitespacesAndNewlines)

        var lines: [String] = []
        lines.append("[\(type.label)] \(trimmedTitle.isEmpty ? "(no title)" : trimmedTitle)")
        lines.append("")
        lines.append(trimmedDescription.isEmpty ? "(no description)" : trimmedDescription)
        lines.append("")
        lines.append("— Diagnostics —")
        lines.append("App: \(appVersion)")
        lines.append("OS: \(os)")
        if let userId, !userId.isEmpty {
            lines.append("User: \(userId)")
        }
        return lines.joined(separator: "\n")
    }

    /// Marketing version + Fastlane-bumped build number.
    /// `MARKETING_VERSION` is hardcoded at "1.0.0" today, so the build
    /// number is the part that actually identifies which TestFlight upload
    /// a reporter is on (`fastlane/Fastfile` sets it to one above the
    /// highest TestFlight build for this marketing version).
    private var appVersion: String {
        let info = Bundle.main.infoDictionary
        let marketing = info?["CFBundleShortVersionString"] as? String ?? "1.0.0"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(marketing) (\(build))"
    }
}
