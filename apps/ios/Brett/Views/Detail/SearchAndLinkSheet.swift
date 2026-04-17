import SwiftUI

/// Debounced search sheet for picking an Item to link.
///
/// Hits `GET /api/search?q=...&types=item`. Results are filtered so the
/// user can't select the currently-open item as its own link (the server
/// already rejects this but we guard client-side for a snappier UX).
struct SearchAndLinkSheet: View {
    let currentItemId: String
    let onSelect: (String) -> Void
    let onCancel: () -> Void

    @State private var query: String = ""
    @State private var results: [SearchResultItem] = []
    @State private var isSearching: Bool = false
    @State private var errorMessage: String?
    @State private var debounceTask: Task<Void, Never>?

    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            header

            searchField
                .padding(.horizontal, 20)
                .padding(.bottom, 12)

            if let errorMessage {
                Text(errorMessage)
                    .font(.system(size: 12))
                    .foregroundStyle(BrettColors.error)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
            }

            resultsList
        }
        .background(Color.clear)
        .onAppear { isFocused = true }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Button("Cancel", action: onCancel)
                .foregroundStyle(BrettColors.textInactive)
            Spacer()
            Text("Add link")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
            Spacer()
            // Right-hand placeholder keeps the title centered.
            Text("Cancel")
                .foregroundStyle(.clear)
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 14)
    }

    // MARK: - Search field

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(BrettColors.textGhost)

            TextField("Search tasks and content\u{2026}", text: $query)
                .focused($isFocused)
                .font(.system(size: 14))
                .foregroundStyle(.white)
                .tint(BrettColors.gold)
                .autocorrectionDisabled(true)
                .textInputAutocapitalization(.never)
                .onChange(of: query) { _, newValue in
                    scheduleSearch(newValue)
                }

            if isSearching {
                ProgressView()
                    .scaleEffect(0.6)
                    .tint(BrettColors.gold)
            } else if !query.isEmpty {
                Button {
                    query = ""
                    results = []
                    errorMessage = nil
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(BrettColors.textGhost)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(0.08))
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(BrettColors.cardBorder, lineWidth: 0.5)
                }
        }
    }

    // MARK: - Results

    @ViewBuilder
    private var resultsList: some View {
        ScrollView {
            VStack(spacing: 0) {
                ForEach(results, id: \.id) { result in
                    Button {
                        onSelect(result.id)
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: result.type == "task" ? "bolt.fill" : "book")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(result.type == "task" ? BrettColors.gold : BrettColors.amber400.opacity(0.80))

                            VStack(alignment: .leading, spacing: 2) {
                                Text(result.title.isEmpty ? "Untitled" : result.title)
                                    .font(.system(size: 14))
                                    .foregroundStyle(BrettColors.textBody)
                                    .lineLimit(1)
                                if let snippet = result.snippet, !snippet.isEmpty {
                                    Text(snippet)
                                        .font(.system(size: 11))
                                        .foregroundStyle(BrettColors.textInactive)
                                        .lineLimit(1)
                                }
                            }
                            Spacer()
                            Image(systemName: "plus")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(BrettColors.gold)
                        }
                        .contentShape(Rectangle())
                        .padding(.vertical, 10)
                    }
                    .buttonStyle(.plain)
                    .overlay(alignment: .bottom) {
                        Rectangle()
                            .fill(BrettColors.hairline)
                            .frame(height: 0.5)
                    }
                }

                if !isSearching && !query.isEmpty && results.isEmpty {
                    Text("No results")
                        .font(.system(size: 13))
                        .foregroundStyle(BrettColors.textPlaceholder)
                        .padding(.top, 28)
                }
            }
            .padding(.horizontal, 20)
        }
    }

    // MARK: - Search

    private func scheduleSearch(_ value: String) {
        debounceTask?.cancel()
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else {
            results = []
            errorMessage = nil
            isSearching = false
            return
        }

        isSearching = true
        debounceTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            if Task.isCancelled { return }
            await runSearch(trimmed)
        }
    }

    private func runSearch(_ q: String) async {
        do {
            let response = try await APIClient.shared.searchItems(query: q)
            await MainActor.run {
                self.results = response.filter { $0.id != currentItemId }
                self.errorMessage = nil
                self.isSearching = false
            }
        } catch {
            await MainActor.run {
                self.errorMessage = (error as? APIError)?.userFacingMessage ?? "Search failed"
                self.isSearching = false
            }
        }
    }
}

// MARK: - Search result DTO

struct SearchResultItem: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let snippet: String?
    let type: String
}

// MARK: - APIClient extension for search

@MainActor
extension APIClient {
    /// GET /api/search?q=...&types=item → decoded into a flat list for the
    /// link picker. The real payload has enriched metadata we don't use in
    /// this surface, so we decode a targeted subset.
    func searchItems(query: String) async throws -> [SearchResultItem] {
        let raw: SearchResponse = try await request(
            SearchResponse.self,
            path: "/api/search?q=\(encode(query))&types=item&limit=20",
            method: "GET"
        )

        return raw.results
            .filter { $0.entityType == "item" }
            .map { r in
                SearchResultItem(
                    id: r.entityId,
                    title: r.title ?? "",
                    snippet: r.snippet,
                    type: r.metadata?.type ?? "task"
                )
            }
    }

    private func encode(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
    }

    // Shapes

    struct SearchResponse: Decodable {
        let results: [SearchEntry]
    }

    struct SearchEntry: Decodable {
        let entityType: String
        let entityId: String
        let title: String?
        let snippet: String?
        let score: Double?
        let matchType: String?
        let metadata: SearchMetadata?
    }

    struct SearchMetadata: Decodable {
        let type: String?
        let status: String?
        let contentType: String?
    }
}
