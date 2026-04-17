import SwiftUI

// MARK: - Toast model

/// One queued toast. Kind drives the accent color and icon.
struct Toast: Identifiable, Equatable {
    enum Kind: Equatable {
        case error
        case success
    }

    let id = UUID()
    let kind: Kind
    let message: String
}

// MARK: - Toast manager

/// Queue + dispatcher for user-visible toasts.
///
/// Use-pattern:
/// ```swift
/// ToastManager.shared.showError("Failed to save")
/// ToastManager.shared.showSuccess("Copied to clipboard")
/// ```
///
/// Toasts are displayed one at a time for `displayDuration` seconds, then the
/// queue advances to the next entry. Calls to `dismissCurrent()` or
/// `clear()` let tests and tap handlers cut a toast short.
@MainActor
@Observable
final class ToastManager {
    static let shared = ToastManager()

    /// The toast currently on screen. `nil` when the queue is empty or the
    /// dispatcher is between toasts.
    private(set) var current: Toast?

    /// How long each toast stays visible. Exposed for tests.
    let displayDuration: TimeInterval

    /// Pending toasts waiting to be shown.
    private var queue: [Toast] = []

    /// Task that dismisses the current toast after `displayDuration`. Replaced
    /// whenever a toast is manually dismissed or a new one pops to the front.
    private var dispatchTask: Task<Void, Never>?

    init(displayDuration: TimeInterval = 4.0) {
        self.displayDuration = displayDuration
    }

    // MARK: - Public API

    func showError(_ message: String) {
        enqueue(Toast(kind: .error, message: message))
    }

    func showSuccess(_ message: String) {
        enqueue(Toast(kind: .success, message: message))
    }

    /// Dismiss the current toast immediately; the next queued one (if any)
    /// will be shown after a brief pause.
    func dismissCurrent() {
        dispatchTask?.cancel()
        dispatchTask = nil
        current = nil
        advance()
    }

    /// Clear everything — current + queue. Used by tests between cases and
    /// when signing out to avoid leaking cross-account messages.
    func clear() {
        dispatchTask?.cancel()
        dispatchTask = nil
        queue.removeAll()
        current = nil
    }

    // MARK: - Queue internals

    private func enqueue(_ toast: Toast) {
        queue.append(toast)
        if current == nil {
            advance()
        }
    }

    private func advance() {
        guard !queue.isEmpty else {
            current = nil
            return
        }
        let next = queue.removeFirst()
        current = next

        dispatchTask = Task { @MainActor [weak self] in
            guard let self else { return }
            let duration = self.displayDuration
            do {
                try await Task.sleep(nanoseconds: UInt64(duration * 1_000_000_000))
            } catch {
                return // cancelled by dismissCurrent / clear
            }
            if Task.isCancelled { return }
            // Only auto-dismiss if the current toast is still this one —
            // guards against races where another call beat us to it.
            if self.current?.id == next.id {
                self.current = nil
                self.advance()
            }
        }
    }
}

// MARK: - Toast view

/// Single toast card. Glass, tinted by `Toast.Kind`, dismissible by tap.
private struct ToastView: View {
    let toast: Toast
    let onTap: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(iconColor)

            Text(toast.message)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.90))
                .multilineTextAlignment(.leading)
                .lineLimit(3)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(.thinMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(tintColor.opacity(0.18))
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(tintColor.opacity(0.30), lineWidth: 1)
                }
        }
        .padding(.horizontal, 16)
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityHint("Tap to dismiss")
    }

    private var icon: String {
        switch toast.kind {
        case .error: return "exclamationmark.triangle"
        case .success: return "checkmark.circle"
        }
    }

    private var iconColor: Color {
        switch toast.kind {
        case .error: return Color.white.opacity(0.75)
        case .success: return Color.white.opacity(0.75)
        }
    }

    private var tintColor: Color {
        switch toast.kind {
        case .error: return BrettColors.error
        case .success: return BrettColors.success
        }
    }

    private var accessibilityLabel: String {
        switch toast.kind {
        case .error: return "Error: \(toast.message)"
        case .success: return "Success: \(toast.message)"
        }
    }
}

// MARK: - Host modifier

/// Anchors the toast area above the omnibar. The omnibar sits at the bottom
/// of `MainContainer` with its own padding; the toast is inset 96pt from the
/// bottom so it clears the bar comfortably without blocking it.
struct ErrorToastHost: ViewModifier {
    let manager: ToastManager

    init(manager: ToastManager = .shared) {
        self.manager = manager
    }

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                if let toast = manager.current {
                    ToastView(toast: toast) {
                        manager.dismissCurrent()
                    }
                    .padding(.bottom, 96)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .animation(
                        .spring(response: 0.35, dampingFraction: 0.82),
                        value: toast.id
                    )
                }
            }
    }
}

extension View {
    /// Mounts the shared `ToastManager`'s current toast above the omnibar.
    func errorToastHost(manager: ToastManager = .shared) -> some View {
        modifier(ErrorToastHost(manager: manager))
    }
}
