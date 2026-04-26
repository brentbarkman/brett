import Testing
import Foundation
@testable import Brett

@Suite("SSEClient lifecycle", .tags(.sync))
@MainActor
struct SSEClientLifecycleTests {
    @Test func disconnectCancelsLoopWithinShortDeadline() async throws {
        let client = SSEClient(
            apiClient: APIClient.shared,
            session: .shared,
            maxBackoffSeconds: 30,
            backoffMultiplier: 0
        )
        client.connect()
        try await Task.sleep(nanoseconds: 20_000_000)
        let start = Date()
        client.disconnect()
        try await Task.sleep(nanoseconds: 100_000_000)
        let elapsed = Date().timeIntervalSince(start)
        #expect(elapsed < 1.0, "disconnect must terminate the loop within 1s, got \(elapsed)s")
    }

    @Test func loopTaskIsClearedAfterDisconnect() async throws {
        let client = SSEClient(
            apiClient: APIClient.shared,
            session: .shared,
            maxBackoffSeconds: 30,
            backoffMultiplier: 0
        )
        client.connect()
        try await Task.sleep(nanoseconds: 20_000_000)
        client.disconnect()
        try await Task.sleep(nanoseconds: 50_000_000)
        #expect(client.hasLoopTask == false)
    }
}
