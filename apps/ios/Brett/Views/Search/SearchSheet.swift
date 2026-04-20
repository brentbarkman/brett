import SwiftUI

/// Spotlight-style search overlay.
///
/// Behaviour:
/// - Presented as a `.sheet` with `.large` detent and a dark-glass
///   background so the search field sits on a blurred canvas.
/// - The text field auto-focuses on appear and dismisses the keyboard when
///   the user swipes the sheet down (`scrollDismissesKeyboard`).
/// - Search runs via `SearchStore.search(_:types:)` which debounces at 300ms.
/// - Tapping a result records it in recent queries and invokes `onSelect`
///   so the parent can push the appropriate detail view.
/// - Empty state shows recent queries + fixed suggestions.
/// - Error state shows a short message beneath the filter row.
struct SearchSheet: View {
    @Bindable var store: SearchStore

    /// Invoked when the user taps a result. The parent decides whether to
    /// dismiss the sheet and/or push a detail view.
    var onSelect: ((SearchResult) -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @FocusState private var isFocused: Bool

    /// Fixed starter queries — ideas lifted from the product spec. The
    /// order is intentionally opinionated (user-visible defaults).
    private let suggestions: [String] = [
        "overdue",
        "this week",
        "with john",
        "meeting notes",
        "scout findings",
    ]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                searchField
                SearchTypeFilter(selection: $store.activeTypes)
                    .onChange(of: store.activeTypes) { _, _ in
                        // Filters changed — re-run the query immediately so
                        // the user sees filtered results without retyping.
                        Task { await store.searchNow(store.query) }
                    }

                Divider()
                    .overlay(BrettColors.hairline)

                content
            }
            .background {
                Rectangle().fill(.ultraThinMaterial).ignoresSafeArea()
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") {
                        store.cancel()
                        dismiss()
                    }
                    .foregroundStyle(BrettColors.gold)
                }
            }
            .navigationTitle("Search")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            // Focus the field one runloop tick after appear — doing it
            // synchronously inside `.task` sometimes loses the focus to
            // the sheet's presentation animation.
            try? await Task.sleep(for: .milliseconds(150))
            isFocused = true
        }
        .onDisappear {
            store.cancel()
        }
    }

    // MARK: - Search field

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(BrettColors.textSecondary)

            NeutralPlaceholder("Search everything", isEmpty: store.query.isEmpty) {
                TextField("", text: $store.query)
                    .font(.system(size: 17))
                    .foregroundStyle(.white)
                    .tint(BrettColors.gold)
                    .focused($isFocused)
            }
            .submitLabel(.search)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .onChange(of: store.query) { _, newValue in
                Task { await store.search(newValue) }
            }
            .onSubmit {
                Task {
                    await store.searchNow(store.query)
                    store.addRecent(store.query)
                }
            }

            if !store.query.isEmpty {
                Button {
                    store.query = ""
                    store.results = []
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(BrettColors.textGhost)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color.white.opacity(0.05))
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if let error = store.error {
            errorView(error)
        } else if store.query.trimmingCharacters(in: .whitespaces).isEmpty {
            emptyStateView
        } else if store.isSearching && store.results.isEmpty {
            loadingView
        } else if store.results.isEmpty {
            noResultsView
        } else {
            resultsList
        }
    }

    private var resultsList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(store.results) { result in
                    Button {
                        store.addRecent(store.query)
                        onSelect?(result)
                    } label: {
                        SearchResultRow(result: result, query: store.query)
                    }
                    .buttonStyle(.plain)

                    Divider()
                        .overlay(BrettColors.hairline)
                        .padding(.leading, 58)
                }
            }
            .padding(.top, 4)
            .padding(.bottom, 40)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var emptyStateView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if !store.recentQueries.isEmpty {
                    section(title: "Recent") {
                        VStack(spacing: 0) {
                            ForEach(store.recentQueries, id: \.self) { recent in
                                queryRow(text: recent, icon: "clock")
                            }
                        }
                    } trailing: {
                        Button("Clear") { store.clearRecent() }
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(BrettColors.textSecondary)
                    }
                }

                section(title: "Try") {
                    VStack(spacing: 0) {
                        ForEach(suggestions, id: \.self) { suggestion in
                            queryRow(text: suggestion, icon: "sparkles")
                        }
                    }
                }
            }
            .padding(.top, 16)
            .padding(.bottom, 40)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var loadingView: some View {
        VStack(spacing: 12) {
            ProgressView()
                .controlSize(.regular)
                .tint(BrettColors.gold)
            Text("Searching\u{2026}")
                .font(.system(size: 13))
                .foregroundStyle(BrettColors.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }

    private var noResultsView: some View {
        VStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 32))
                .foregroundStyle(BrettColors.textGhost)
            Text("No results for \u{201C}\(store.query)\u{201D}")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(BrettColors.textSecondary)
            Text("Try a different keyword or remove filters.")
                .font(.system(size: 13))
                .foregroundStyle(BrettColors.textMeta)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: "exclamationmark.circle")
                .font(.system(size: 24))
                .foregroundStyle(BrettColors.error)
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(BrettColors.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }

    // MARK: - Helper UI

    @ViewBuilder
    private func section<Content: View, Trailing: View>(
        title: String,
        @ViewBuilder content: () -> Content,
        @ViewBuilder trailing: () -> Trailing = { EmptyView() }
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title.uppercased())
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(BrettColors.sectionLabelColor)
                    .kerning(0.8)
                Spacer()
                trailing()
            }
            .padding(.horizontal, 16)

            content()
        }
    }

    private func queryRow(text: String, icon: String) -> some View {
        Button {
            store.query = text
            Task {
                await store.searchNow(text)
                store.addRecent(text)
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(BrettColors.textMeta)
                    .frame(width: 20)
                Text(text)
                    .font(.system(size: 15))
                    .foregroundStyle(BrettColors.textBody)
                Spacer()
                Image(systemName: "arrow.up.left")
                    .font(.system(size: 11))
                    .foregroundStyle(BrettColors.textGhost)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
