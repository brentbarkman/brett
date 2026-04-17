import SwiftUI

/// Shared chrome for every settings screen. Extracted so the 10 settings
/// views can't drift apart on:
///  - section header style (some used native Form headers, some used a
///    custom `Text("…").uppercased()` helper, the difference was visible
///    when navigating between screens)
///  - row background (each view re-defined the same rounded rectangle —
///    easy to forget a corner radius)
///  - inter-section spacing (the parent SettingsView used 20pt, every
///    child view used the system default which made transitions feel
///    inconsistent)
///
/// Usage:
/// ```swift
/// Form {
///     Section {
///         row.brettSettingsRowBackground()
///     } header: {
///         BrettSectionHeader("Account")
///     }
/// }
/// .brettSettingsForm()
/// ```
///
/// Pair with `BackgroundView()` underneath in a ZStack — the form's own
/// background is intentionally cleared so the page background shows.

// MARK: - Section header

/// Standardised settings section header. Bumped to 12pt + bold + brighter
/// gold so labels read clearly against a photo background. Earlier the
/// system default of white/0.40 at 10pt (then gold/0.50 at 11pt) was
/// still flagged as illegible — the photo would dim already-dim text
/// further, especially on bright sky/sunset frames.
struct BrettSectionHeader: View {
    let title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        Text(title.uppercased())
            .font(.system(size: 12, weight: .bold))
            .tracking(1.8)
            .foregroundStyle(BrettColors.gold.opacity(0.75))
            // No internal padding — parent (Form section header or
            // BrettSettingsSection's VStack) owns the alignment so the
            // header lines up correctly in both layouts.
            .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Row background

/// The shared backing for every settings row.
///
/// Earlier `.thinMaterial` made each row pick up the photo background
/// behind it — Security/Account looked orange against a sunset, while
/// Calendar/AI/Newsletter looked neutral. Each row tinted differently
/// based on what was vertically behind it. The fix is a near-opaque
/// solid black so the rows always render the same colour regardless of
/// what photo is loaded behind the page. We keep a thin material on top
/// for the brand "glass" feel — it tints the dark fill subtly without
/// letting full photo colour through.
private struct BrettSettingsRowBackground: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(Color.black.opacity(0.45))
            .overlay {
                // Subtle material tint on top of the dark fill so the
                // rows still have the brand glass character — the
                // material's transparency is mostly absorbed by the
                // black underneath, so colour bleed is minimal.
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(.ultraThinMaterial.opacity(0.40))
            }
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.10), lineWidth: 0.5)
            }
    }
}

extension View {
    /// Apply to a `Section`'s row to give it the standard Brett glass
    /// rounded background. Equivalent to `.listRowBackground(...)` with
    /// the canonical material + stroke.
    func brettSettingsRowBackground() -> some View {
        listRowBackground(BrettSettingsRowBackground())
    }
}

// MARK: - Form modifier

extension View {
    /// Apply to a `Form` (or list) to enforce the canonical Brett
    /// settings layout: inset-grouped, page background visible through
    /// the form, 20pt between sections.
    ///
    /// Every Settings* view should call this as its outer form modifier
    /// so the user can navigate between screens without the layout
    /// jumping (different list styles, different spacings).
    func brettSettingsForm() -> some View {
        self
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .listSectionSpacing(20)
    }
}

// MARK: - Section card (one card per section, hairlines between rows)

/// One container card per settings section. Use this instead of giving
/// each row its own rounded background — that pattern made every row
/// look like a separate floating capsule with awkward gaps between
/// them. iOS Settings, Apple's Mail, etc. all group rows in a single
/// section card with hairlines between them; this matches that
/// convention.
///
/// Pair with `BrettSettingsDivider` between rows inside the closure.
struct BrettSettingsCard<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: 0) { content() }
            .background {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.black.opacity(0.45))
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(.ultraThinMaterial.opacity(0.40))
                    }
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.10), lineWidth: 0.5)
                    }
            }
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// Hairline divider drawn between rows inside a `BrettSettingsCard`.
/// Indented so it starts past the icon circle, matching iOS Settings'
/// inset divider treatment.
struct BrettSettingsDivider: View {
    var body: some View {
        Rectangle()
            .fill(Color.white.opacity(0.08))
            .frame(height: 0.5)
            .padding(.leading, 56)
    }
}

// MARK: - Page-level wrapper for non-Form settings layouts

/// Standard scroll + spacing wrapper for settings screens that use
/// `BrettSettingsCard` instead of `Form`. Provides the page background
/// and consistent vertical breathing room.
struct BrettSettingsScroll<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        ZStack {
            BackgroundView()

            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    content()
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 100)
            }
            .scrollIndicators(.hidden)
        }
    }
}

/// A section as a labelled card. Header above, single rounded card
/// below containing the rows. Replaces the
/// `Form.Section { … } header: { BrettSectionHeader(…) }` pattern for
/// screens that have moved off Form.
struct BrettSettingsSection<Content: View>: View {
    let title: String?
    @ViewBuilder var content: () -> Content

    init(_ title: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title { BrettSectionHeader(title) }
            BrettSettingsCard { content() }
        }
    }
}
