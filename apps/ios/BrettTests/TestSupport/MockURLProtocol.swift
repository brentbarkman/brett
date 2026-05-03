import Foundation

/// A `URLProtocol` subclass that intercepts outgoing requests and returns
/// pre-registered stub responses. Register the protocol class on a custom
/// `URLSessionConfiguration` in tests — never on `.default`, or the stubs
/// will leak into other tests.
///
/// Usage:
/// ```swift
/// let config = URLSessionConfiguration.ephemeral
/// config.protocolClasses = [MockURLProtocol.self]
/// let session = URLSession(configuration: config)
///
/// MockURLProtocol.stub(
///     url: URL(string: "https://api.example.com/users/me")!,
///     statusCode: 200,
///     body: Data("""{"id":"u1","email":"a@b.com"}""".utf8)
/// )
/// // ... run code that makes the request ...
/// MockURLProtocol.reset()
/// ```
///
/// Thread-safety: the stub registry is protected by a serial queue so stubs
/// can be registered from tests while URLSession calls into the protocol
/// from its own queues.
final class MockURLProtocol: URLProtocol {
    // MARK: - Stub registry

    struct Stub {
        let statusCode: Int
        let headers: [String: String]
        let body: Data
        let error: Error?

        static func response(statusCode: Int, body: Data, headers: [String: String] = [:]) -> Stub {
            Stub(statusCode: statusCode, headers: headers, body: body, error: nil)
        }

        static func failure(_ error: Error) -> Stub {
            Stub(statusCode: 0, headers: [:], body: Data(), error: error)
        }
    }

    private static let queue = DispatchQueue(label: "com.brett.tests.MockURLProtocol")
    nonisolated(unsafe) private static var stubs: [URL: Stub] = [:]
    nonisolated(unsafe) private static var requestLog: [URLRequest] = []

    /// Sequenced stub queues per URL. Each call to the URL dequeues the next
    /// response. After the queue is exhausted, subsequent calls return the
    /// last response (sticky). Takes priority over `stubs` when registered.
    nonisolated(unsafe) private static var sequencedStubs: [URL: [Stub]] = [:]

    /// Register a stub response for a specific URL.
    static func stub(url: URL, statusCode: Int, body: Data, headers: [String: String] = [:]) {
        queue.sync { stubs[url] = .response(statusCode: statusCode, body: body, headers: headers) }
    }

    /// Register a stub that simulates a transport-level error for a URL.
    static func stub(url: URL, error: Error) {
        queue.sync { stubs[url] = .failure(error) }
    }

    /// Register a sequence of stub responses for a URL. Each call to the URL
    /// dequeues the next response. After the queue is exhausted, subsequent
    /// calls return the last response (sticky). Takes priority over a
    /// single-stub registration for the same URL.
    static func stubSequence(url: URL, responses: [Stub]) {
        precondition(!responses.isEmpty, "stubSequence requires at least one response")
        queue.sync { sequencedStubs[url] = responses }
    }

    /// Clear all registered stubs (single and sequenced) and the request log.
    /// Call this in `tearDown` or at the start of each test to avoid
    /// cross-test pollution.
    static func reset() {
        queue.sync {
            stubs.removeAll()
            sequencedStubs.removeAll()
            requestLog.removeAll()
        }
    }

    /// Returns every request that reached the protocol, in the order received.
    /// Useful for asserting request bodies / headers from tests.
    static func recordedRequests() -> [URLRequest] {
        queue.sync { requestLog }
    }

    // MARK: - URLProtocol overrides

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }

        MockURLProtocol.queue.sync { MockURLProtocol.requestLog.append(request) }

        // Sequenced stubs take priority: dequeue the next response for this
        // URL (or return the last one if the queue is exhausted). Fall back
        // to the single-stub registry, then to path-only matching for URLs
        // with query strings (lets tests stub `/api/search` and have it
        // match requests with `?q=...&limit=...` without re-registering).
        let stub = MockURLProtocol.queue.sync { () -> Stub? in
            // --- Sequenced stubs ---
            // Try exact URL first, then path-only for query-parameterized URLs.
            let sequenceKey: URL? = {
                if MockURLProtocol.sequencedStubs[url] != nil { return url }
                if var comps = URLComponents(url: url, resolvingAgainstBaseURL: false) {
                    comps.query = nil; comps.fragment = nil
                    if let pathOnly = comps.url,
                       MockURLProtocol.sequencedStubs[pathOnly] != nil { return pathOnly }
                }
                return nil
            }()
            if let key = sequenceKey {
                var queue = MockURLProtocol.sequencedStubs[key]!
                let next = queue.removeFirst()
                // Sticky: if more remain keep trimmed queue; otherwise leave
                // single-element queue so the last stub is returned forever.
                if !queue.isEmpty {
                    MockURLProtocol.sequencedStubs[key] = queue
                }
                // After removing the last element via removeFirst, restore it as the
                // sticky stub so subsequent requests continue to receive it.
                else {
                    MockURLProtocol.sequencedStubs[key] = [next]
                }
                return next
            }

            // --- Single stubs ---
            if let exact = MockURLProtocol.stubs[url] { return exact }
            if var comps = URLComponents(url: url, resolvingAgainstBaseURL: false) {
                comps.query = nil
                comps.fragment = nil
                if let pathOnly = comps.url, let match = MockURLProtocol.stubs[pathOnly] {
                    return match
                }
            }
            return nil
        }

        guard let stub else {
            client?.urlProtocol(self, didFailWithError: URLError(.resourceUnavailable))
            return
        }

        if let error = stub.error {
            client?.urlProtocol(self, didFailWithError: error)
            return
        }

        let response = HTTPURLResponse(
            url: url,
            statusCode: stub.statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: stub.headers
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: stub.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {
        // Nothing to cancel — responses are synchronous.
    }
}
