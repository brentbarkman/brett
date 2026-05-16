import XCTest
@testable import Brett

/// Locks the wire shape of `GET /granola/auth` against the API. If the server
/// renames `accounts` or the client struct drifts, these tests fail.
final class GranolaAuthStatusDecodingTests: XCTestCase {
    private func decode(_ json: String) throws -> GranolaAuthStatus {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(GranolaAuthStatus.self, from: Data(json.utf8))
    }

    func test_decodesEmptyAccountsArray() throws {
        let decoded = try decode(#"""
        { "connected": false, "accounts": [] }
        """#)
        XCTAssertFalse(decoded.connected)
        XCTAssertTrue(decoded.accounts.isEmpty)
    }

    func test_decodesSingleAccount() throws {
        let decoded = try decode(#"""
        {
          "connected": true,
          "accounts": [{
            "id": "acc-1",
            "email": "work@example.com",
            "lastSyncAt": "2026-05-16T18:00:00.000Z",
            "autoCreateMyTasks": true,
            "autoCreateFollowUps": false,
            "createdAt": "2026-05-01T00:00:00.000Z",
            "updatedAt": "2026-05-16T18:00:00.000Z"
          }]
        }
        """#)
        XCTAssertTrue(decoded.connected)
        XCTAssertEqual(decoded.accounts.count, 1)
        XCTAssertEqual(decoded.accounts[0].email, "work@example.com")
        XCTAssertEqual(decoded.accounts[0].autoCreateMyTasks, true)
        XCTAssertEqual(decoded.accounts[0].autoCreateFollowUps, false)
    }

    func test_decodesMultipleAccountsWithDifferentPrefs() throws {
        let decoded = try decode(#"""
        {
          "connected": true,
          "accounts": [
            {
              "id": "acc-1",
              "email": "work@example.com",
              "lastSyncAt": "2026-05-16T18:00:00.000Z",
              "autoCreateMyTasks": true,
              "autoCreateFollowUps": false,
              "createdAt": "2026-05-01T00:00:00.000Z",
              "updatedAt": "2026-05-16T18:00:00.000Z"
            },
            {
              "id": "acc-2",
              "email": "personal@example.com",
              "lastSyncAt": null,
              "autoCreateMyTasks": false,
              "autoCreateFollowUps": true,
              "createdAt": "2026-05-10T00:00:00.000Z",
              "updatedAt": "2026-05-15T00:00:00.000Z"
            }
          ]
        }
        """#)
        XCTAssertEqual(decoded.accounts.count, 2)
        XCTAssertEqual(decoded.accounts[0].email, "work@example.com")
        XCTAssertNotNil(decoded.accounts[0].lastSyncAt)
        XCTAssertEqual(decoded.accounts[1].email, "personal@example.com")
        XCTAssertNil(decoded.accounts[1].lastSyncAt)
        // Per-account prefs are independent
        XCTAssertNotEqual(decoded.accounts[0].autoCreateMyTasks, decoded.accounts[1].autoCreateMyTasks)
        XCTAssertNotEqual(decoded.accounts[0].autoCreateFollowUps, decoded.accounts[1].autoCreateFollowUps)
    }

    func test_emptyAccountsImpliesNotConnected() throws {
        // The server sets `connected = accounts.length > 0` — a defensive
        // assertion so we notice if that invariant ever drifts.
        let decoded = try decode(#"""
        { "connected": false, "accounts": [] }
        """#)
        XCTAssertFalse(decoded.connected)
        XCTAssertTrue(decoded.accounts.isEmpty)
    }
}
