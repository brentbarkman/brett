import Foundation
import Testing
@testable import Brett

/// Tests for `SearchStore` covering:
///   - API wiring (URL shape, query-string, types param)
///   - Debounce behaviour — taps the debounce duration via a short override
///   - Recent query persistence (add / dedupe / cap / clear)
///   - Error branch returns a friendly message
///
/// Strategy: we inject a short-debounce store with a `URLSession` wired to
/// `MockURLProtocol` via a dedicated `APIClient`. We use a fresh ephemeral
/// UserDefaults suite per test so recent-query persistence doesn't leak.
@MainActor
@Suite("SearchStore", .tags(.views), .serialized)
struct SearchStoreTests {
    /// Reset MockURLProtocol before each test. See AttachmentUploaderTests.
    init() { MockURLProtocol.reset() }

    // MARK: - Fixtures

    private static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        return URLSession(configuration: config)
    }

    private static func makeStore(
        debounce: Duration = .milliseconds(10),
        session: URLSession
    ) -> (SearchStore, APIClient, UserDefaults) {
        let api = APIClient(session: session)
        api.tokenProvider = { "test-token" }
        // Unique suite per test so persistence is hermetic. Using the
        // MemoryMapped `UserDefaults(suiteName:)` + explicit reset gives
        // the same effect as an in-memory store.
        let suite = "brett.search.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)

        let store = SearchStore(
            apiClient: api,
            userDefaults: defaults,
            debounce: debounce
        )
        return (store, api, defaults)
    }

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = .sortedKeys
        return e
    }()

    private static func responseData(_ payload: [[String: Any]]) -> Data {
        try! JSONSerialization.data(withJSONObject: payload, options: [])
    }

    // MARK: - URL + query wiring

    @Test func searchSendsCorrectURLWithQueryAndLimit() async throws {
        MockURLProtocol.reset()
        let session = Self.makeSession()
        let (store, api, _) = Self.makeStore(session: session)
        let url = api.baseURL.appendingPathComponent("api/search")

        MockURLProtocol.stub(
            url: url,
            statusCode: 200,
            body: Self.responseData([])
        )

        // Stub the URL including the query for full match.
        // URLSession resolves with the query string intact, so the mock
        // must key on the exact final URL. We register both — no-query
        // URL for the appendingPathComponent step, and the full URL for
        // the actual GET.
        var comps = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "q", value: "hello"),
            URLQueryItem(name: "limit", value: "30"),
        ]
        MockURLProtocol.stub(
            url: comps.url!,
            statusCode: 200,
            body: Self.responseData([])
        )

        await store.searchNow("hello")

        #expect(store.isSearching == false)
        #expect(store.error == nil)

        let last = MockURLProtocol.recordedRequests().last?.url?.absoluteString ?? ""
        #expect(last.contains("q=hello"))
        #expect(last.contains("limit=30"))
    }

    @Test func searchIncludesTypesParam() async throws {
        MockURLProtocol.reset()
        let session = Self.makeSession()
        let (store, api, _) = Self.makeStore(session: session)

        // Pre-stub both the keyed URL and the full URL we expect the
        // store to fire.
        let base = api.baseURL.appendingPathComponent("api/search")
        var comps = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "q", value: "foo"),
            URLQueryItem(name: "limit", value: "30"),
            URLQueryItem(name: "types", value: "calendar_event,item"),
        ]
        MockURLProtocol.stub(
            url: comps.url!,
            statusCode: 200,
            body: Self.responseData([])
        )

        store.activeTypes = [.item, .calendarEvent]
        await store.searchNow("foo")

        let lastURL = MockURLProtocol.recordedRequests().last?.url?.absoluteString ?? ""
        #expect(lastURL.contains("types=calendar_event,item"))
    }

    // MARK: - Debounce + cancellation

    @Test func debouncedSearchSkipsStaleQueries() async throws {
        MockURLProtocol.reset()
        let session = Self.makeSession()
        // Longer debounce so we can observe cancellation clearly.
        let (store, api, _) = Self.makeStore(
            debounce: .milliseconds(50),
            session: session
        )
        let base = api.baseURL.appendingPathComponent("api/search")

        // Stub "final" query — returns one result.
        var comps = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "q", value: "final"),
            URLQueryItem(name: "limit", value: "30"),
        ]
        MockURLProtocol.stub(
            url: comps.url!,
            statusCode: 200,
            body: Self.responseData([
                [
                    "entityType": "item",
                    "entityId": "t-1",
                    "title": "Final task",
                    "score": 0.9,
                    "matchType": "hybrid",
                ]
            ])
        )

        // Fire rapid queries — all but the last should be cancelled.
        async let a: Void = store.search("fi")
        async let b: Void = store.search("fin")
        async let c: Void = store.search("final")
        _ = await (a, b, c)

        #expect(store.isSearching == false)
        #expect(store.results.count == 1)
        #expect(store.results.first?.title == "Final task")

        // At most one HTTP request should have been fired — the prior
        // Tasks were cancelled during their debounce sleep.
        let recorded = MockURLProtocol.recordedRequests()
        #expect(recorded.count == 1)
    }

    @Test func tooShortQueryClearsResultsWithoutNetworkCall() async {
        MockURLProtocol.reset()
        let session = Self.makeSession()
        let (store, _, _) = Self.makeStore(session: session)

        store.results = [
            SearchResult(
                entityType: .item,
                entityId: "x",
                title: "Stale"
            )
        ]

        await store.search("a")

        #expect(store.results.isEmpty)
        #expect(store.isSearching == false)
        #expect(MockURLProtocol.recordedRequests().isEmpty)
    }

    // MARK: - Recent queries

    @Test func addRecentDedupesAndCapsAndPersists() {
        MockURLProtocol.reset()
        let session = Self.makeSession()
        let (store, _, defaults) = Self.makeStore(session: session)

        store.addRecent("one")
        store.addRecent("two")
        store.addRecent("Three")
        store.addRecent("three") // same as Three, case-insensitive

        #expect(store.recentQueries == ["three", "two", "one"])

        // Exceed cap
        for i in 0..<20 {
            store.addRecent("q-\(i)")
        }
        #expect(store.recentQueries.count == SearchStore.maxRecentQueries)

        // Persisted
        let stored = defaults.stringArray(forKey: SearchStore.recentQueriesDefaultsKey) ?? []
        #expect(stored.count == SearchStore.maxRecentQueries)
    }

    @Test func addRecentIgnoresEmptyAndShortQueries() {
        MockURLProtocol.reset()
        let session = Self.makeSession()
        let (store, _, _) = Self.makeStore(session: session)

        store.addRecent("")
        store.addRecent("   ")
        store.addRecent("a")
        #expect(store.recentQueries.isEmpty)

        store.addRecent("ok")
        #expect(store.recentQueries == ["ok"])
    }

    @Test func clearRecentWipesMemoryAndPersistence() {
        MockURLProtocol.reset()
        let session = Self.makeSession()
        let (store, _, defaults) = Self.makeStore(session: session)

        store.addRecent("foo")
        store.addRecent("bar")
        #expect(!store.recentQueries.isEmpty)

        store.clearRecent()
        #expect(store.recentQueries.isEmpty)
        #expect(defaults.stringArray(forKey: SearchStore.recentQueriesDefaultsKey) == nil)
    }

    @Test func recentQueriesRehydrateFromUserDefaultsOnInit() {
        MockURLProtocol.reset()
        let suite = "brett.search.rehydrate.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.set(["alpha", "beta"], forKey: SearchStore.recentQueriesDefaultsKey)

        let api = APIClient(session: Self.makeSession())
        api.tokenProvider = { "t" }

        let store = SearchStore(
            apiClient: api,
            userDefaults: defaults,
            debounce: .milliseconds(10)
        )
        #expect(store.recentQueries == ["alpha", "beta"])

        defaults.removePersistentDomain(forName: suite)
    }

    // MARK: - Error handling

    @Test func serverErrorPopulatesFriendlyMessage() async {
        MockURLProtocol.reset()
        let session = Self.makeSession()
        let (store, api, _) = Self.makeStore(session: session)
        let base = api.baseURL.appendingPathComponent("api/search")

        var comps = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "q", value: "boom"),
            URLQueryItem(name: "limit", value: "30"),
        ]
        MockURLProtocol.stub(
            url: comps.url!,
            statusCode: 500,
            body: Data()
        )

        await store.searchNow("boom")

        #expect(store.results.isEmpty)
        #expect(store.isSearching == false)
        #expect(store.error != nil)
    }

    // MARK: - Decoding sanity

    @Test func parsesFullResponseShape() async throws {
        MockURLProtocol.reset()
        let session = Self.makeSession()
        let (store, api, _) = Self.makeStore(session: session)
        let base = api.baseURL.appendingPathComponent("api/search")

        var comps = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "q", value: "review"),
            URLQueryItem(name: "limit", value: "30"),
        ]
        let payload: [[String: Any]] = [
            [
                "entityType": "item",
                "entityId": "t-1",
                "title": "Review PR",
                "snippet": "need to review",
                "score": 0.92,
                "matchType": "hybrid",
                "metadata": [
                    "status": "active",
                    "type": "task",
                    "listName": "Inbox",
                    "dueDate": "2026-04-20",
                ],
            ],
            [
                "entityType": "calendar_event",
                "entityId": "e-1",
                "title": "Standup",
                "score": 0.4,
                "matchType": "keyword",
            ],
        ]
        MockURLProtocol.stub(
            url: comps.url!,
            statusCode: 200,
            body: try JSONSerialization.data(withJSONObject: payload)
        )

        await store.searchNow("review")

        #expect(store.results.count == 2)
        #expect(store.results[0].entityType == .item)
        #expect(store.results[0].matchType == .hybrid)
        #expect(store.results[0].metadata?.listName == "Inbox")
        #expect(store.results[1].entityType == .calendarEvent)
        #expect(store.results[1].matchType == .keyword)
    }
}
