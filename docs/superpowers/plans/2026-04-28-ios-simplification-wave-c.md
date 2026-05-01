# iOS Simplification — Wave C: God-File Splits

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break the iOS app's largest files into focused units. `ChatStore` (648 lines) splits into three composable pieces; `SyncEntityMapper` (918 lines) becomes per-model `Codable` conformance + a thin dispatcher; the three biggest settings views (`Location` 891, `Security` 784, `Calendar` 749) get their per-section sub-views extracted; `TaskDetailView`/`EventDetailView` share a small `DetailViewContainer` and `TaskDetailView`'s four `.onChange` chains collapse into one debounced commit.

**Architecture:** Five phases, ordered safest-first. (1) `ChatStore` split — well-tested module, surgical decomposition into `StreamingChatClient`, `ChatMessageBuffer`, `ChatPersister`. (2) Settings views — extract per-section sub-views as private structs in the same file. No new files; just visual decomposition + clearer scope per section. (3) `DetailViewContainer` extraction + `TaskDetailView` debounce-onChange collapse. (4) `SyncEntityMapper` — migrate model-by-model to `Codable`, starting with the smallest (`CalendarEventNote` — 5 fields) and ending with the largest (`CalendarEvent` — 32 fields, 4 JSON blobs). Each migration is its own commit, gated by an exhaustive round-trip test. (5) Dead-code sweep + final verification.

**Tech Stack:** Swift 6 / SwiftUI / SwiftData / Swift Testing. Existing infra: `InMemoryPersistenceController`, `MockURLProtocol`, `TestFixtures`, `BrettLog`, `ModelContextSaving` (Wave B), `ClearableStoreRegistry` (Wave A).

**Spec:** [`docs/superpowers/specs/2026-04-26-ios-simplification-design.md`](../specs/2026-04-26-ios-simplification-design.md), §Wave C.

---

## Spec reconciliation

A few divergences from the spec, decided after reconnaissance:

1. **Settings sub-stores deferred.** The spec said each settings section "gets a small `LocationSettingsSubStore` if it owns API calls." Reconnaissance shows the existing files mix UI + state + networking inline, but cleanly per-section. Extracting *sub-views* as private structs in the same file gives most of the readability win for ~10× less risk than introducing four new sub-stores per file. If sub-stores become a real need (e.g., section is reused elsewhere), they're a follow-up.

2. **`SyncEntityMapper` refactor is generic-`Codable`, not generic-via-macros.** Each model gains explicit `CodingKeys` + `init(from:)` + `encode(to:)`. The mapper file shrinks to a ~150-line dispatcher. Per-spec.

3. **TaskDetailView's four `.onChange` chains → one debounced commit.** Spec called this out; doing it in this wave (Phase 3, alongside the container extraction).

4. **`SyncEntityMapper` migration order is determined by complexity, not entity count.** Smallest first (`CalendarEventNote`), largest last (`CalendarEvent`). Pattern proven on the simple ones lowers risk on the hard ones.

---

## File structure

**New files (4):**

- `apps/ios/Brett/Stores/Chat/StreamingChatClient.swift` — SSE byte stream + parser (≈200 lines).
- `apps/ios/Brett/Stores/Chat/ChatMessageBuffer.swift` — In-memory `[String: [ChatMessage]]` + `isStreaming` + `lastError` + mutation ops (≈170 lines).
- `apps/ios/Brett/Stores/Chat/ChatPersister.swift` — `BrettMessage` SwiftData writer (≈60 lines).
- `apps/ios/Brett/Views/Detail/DetailViewContainer.swift` — Generic ScrollView + safe-area + lifecycle wrapper (≈70 lines).

**Heavily modified (existing):**

- `apps/ios/Brett/Stores/ChatStore.swift` — Becomes a thin coordinator wiring the three new pieces (≈200 lines after split, down from 648).
- `apps/ios/Brett/Sync/SyncEntityMapper.swift` — Becomes a ~150-line dispatcher; per-model logic migrates into model-owned `init(from:)` / `encode(to:)`.
- `apps/ios/Brett/Models/Item.swift` + 7 other model files — Each gains `Codable` conformance, ~30 lines added.
- `apps/ios/Brett/Views/Settings/LocationSettingsView.swift` — Refactor to extract `AssistantPersonaSection`, `MemoryFactsSection`, `TimezoneSection`, `WeatherLocationSection` as private structs in the same file. Body becomes a ~60-line outline.
- `apps/ios/Brett/Views/Settings/SecuritySettingsView.swift` — Same pattern: `AppLockSection`, `SignInMethodSection`, `PasskeysSection`, `PasswordChangeSection`.
- `apps/ios/Brett/Views/Settings/CalendarSettingsView.swift` — Same pattern: `GoogleCalendarSection`, `GranolaIntegrationSection`.
- `apps/ios/Brett/Views/Detail/TaskDetailView.swift` — Adopt `DetailViewContainer`; collapse four `.onChange` chains into one debounced commit.
- `apps/ios/Brett/Views/Detail/EventDetailView.swift` — Adopt `DetailViewContainer`.

**New tests (3):**

- `apps/ios/BrettTests/Stores/StreamingChatClientTests.swift`
- `apps/ios/BrettTests/Stores/ChatMessageBufferTests.swift`
- `apps/ios/BrettTests/Stores/ChatPersisterTests.swift`

**Modified tests:**

- `apps/ios/BrettTests/Sync/SyncEntityMapperTests.swift` — Existing tests stay; per-model migrations may add new round-trip cases. The existing test file is the **load-bearing safety net** for Phase 4.

**Total: 4 new + 1 new test infrastructure file + ~12 modified existing files.**

---

## Phase 1 — `ChatStore` split

Goal: `ChatStore` becomes a thin coordinator. Three new files own SSE / buffer / persistence respectively. Existing public API (`messages`, `isStreaming`, `lastError`, `send(...)`, `cancelAll()`, `clearForSignOut()`) stays unchanged so callers don't change.

### Task 1: Extract `ChatMessageBuffer`

Smallest piece first — pure in-memory state, no networking, no SwiftData. The lowest-risk extraction.

**Files:**
- Create: `apps/ios/Brett/Stores/Chat/ChatMessageBuffer.swift`
- Create: `apps/ios/BrettTests/Stores/ChatMessageBufferTests.swift`
- Modify: `apps/ios/Brett/Stores/ChatStore.swift` — delegate buffer state to the new type

#### Step 1: Write the failing test

Create `apps/ios/BrettTests/Stores/ChatMessageBufferTests.swift`:

```swift
import Testing
import Foundation
@testable import Brett

@Suite("ChatMessageBuffer", .tags(.smoke))
@MainActor
struct ChatMessageBufferTests {
    @Test func appendUserCreatesMessageInOrder() {
        let buffer = ChatMessageBuffer()
        buffer.appendUser(key: "item-1", content: "Hello")
        buffer.appendUser(key: "item-1", content: "World")

        let messages = buffer.messages["item-1"] ?? []
        #expect(messages.count == 2)
        #expect(messages.map(\.content) == ["Hello", "World"])
        #expect(messages.allSatisfy { $0.role == .user })
    }

    @Test func beginAssistantReturnsIndexAndMarksStreaming() {
        let buffer = ChatMessageBuffer()
        let index = buffer.beginAssistant(key: "item-1")

        #expect(index == 0)
        let messages = buffer.messages["item-1"] ?? []
        #expect(messages.count == 1)
        #expect(messages[0].role == .brett)
        #expect(messages[0].isStreaming == true)
        #expect(messages[0].content.isEmpty)
        #expect(buffer.isStreaming["item-1"] == true)
    }

    @Test func appendAssistantDeltaAccumulatesContent() {
        let buffer = ChatMessageBuffer()
        let index = buffer.beginAssistant(key: "item-1")
        buffer.appendAssistantDelta(key: "item-1", index: index, delta: "Hello, ")
        buffer.appendAssistantDelta(key: "item-1", index: index, delta: "world.")

        let messages = buffer.messages["item-1"] ?? []
        #expect(messages[0].content == "Hello, world.")
    }

    @Test func markAssistantCompleteFlipsStreamingFalse() {
        let buffer = ChatMessageBuffer()
        let index = buffer.beginAssistant(key: "item-1")
        buffer.appendAssistantDelta(key: "item-1", index: index, delta: "Done")
        buffer.markAssistantComplete(key: "item-1", index: index)

        let messages = buffer.messages["item-1"] ?? []
        #expect(messages[0].isStreaming == false)
        #expect(buffer.isStreaming["item-1"] == false)
    }

    @Test func clearWipesAllState() {
        let buffer = ChatMessageBuffer()
        buffer.appendUser(key: "item-1", content: "Hi")
        _ = buffer.beginAssistant(key: "item-1")
        buffer.setError(key: "item-1", message: "stale")

        buffer.clear()

        #expect(buffer.messages.isEmpty)
        #expect(buffer.isStreaming.isEmpty)
        #expect(buffer.lastError.isEmpty)
    }

    @Test func multipleKeysAreIsolated() {
        let buffer = ChatMessageBuffer()
        buffer.appendUser(key: "item-1", content: "first")
        buffer.appendUser(key: "item-2", content: "second")

        #expect(buffer.messages["item-1"]?.count == 1)
        #expect(buffer.messages["item-2"]?.count == 1)
        #expect(buffer.messages["item-1"]?.first?.content == "first")
        #expect(buffer.messages["item-2"]?.first?.content == "second")
    }
}
```

#### Step 2: Run test, confirm failure

```bash
cd apps/ios && xcodegen
cd apps/ios && xcodebuild build-for-testing -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' 2>&1 | grep -E "(BUILD SUCCEEDED|BUILD FAILED|error:)" | head -10
```

Expected: BUILD FAILED — `ChatMessageBuffer` doesn't exist.

#### Step 3: Implement `ChatMessageBuffer`

Create `apps/ios/Brett/Stores/Chat/ChatMessageBuffer.swift`:

```swift
import Foundation
import Observation

/// In-memory conversation state, keyed by `itemId` or `eventId`. The
/// buffer is observable so SwiftUI views re-render on append, on
/// streaming-flag change, and on error-banner change. It owns no
/// networking and no SwiftData — `StreamingChatClient` produces deltas
/// that the coordinator routes here, and `ChatPersister` writes
/// completed assistant messages to disk separately.
///
/// Why split from `ChatStore`: the buffer is pure data + mutation; the
/// stream is pure I/O; the persister is pure SwiftData. Each tested
/// independently. The previous monolithic `ChatStore` (648 lines)
/// blurred all three.
@MainActor
@Observable
final class ChatMessageBuffer {
    /// Per-key (itemId or eventId) ordered messages.
    private(set) var messages: [String: [ChatMessage]] = [:]

    /// True while a stream is in flight for a given key. UI shows a
    /// spinner / disables send while true.
    private(set) var isStreaming: [String: Bool] = [:]

    /// Soft error banner per key. `nil` (absent key) means no error.
    /// Cleared on next successful `appendUser` or `beginAssistant`.
    private(set) var lastError: [String: String] = [:]

    /// Replace all in-memory messages for a given key. Used when
    /// hydrating from `BrettMessage` rows on view appear.
    func setMessages(key: String, messages: [ChatMessage]) {
        self.messages[key] = messages
    }

    /// Append a user message to the back of the conversation. Clears
    /// the error banner — typing implies the user is past the prior
    /// failure.
    func appendUser(key: String, content: String, id: String = UUID().uuidString) {
        let message = ChatMessage(
            id: id,
            role: .user,
            content: content,
            isStreaming: false,
            createdAt: Date()
        )
        messages[key, default: []].append(message)
        lastError.removeValue(forKey: key)
    }

    /// Open a new assistant message in the buffer. Returns the index
    /// of the new bubble so subsequent `appendAssistantDelta` calls
    /// can target it without a search.
    @discardableResult
    func beginAssistant(key: String, id: String = UUID().uuidString) -> Int {
        let placeholder = ChatMessage(
            id: id,
            role: .brett,
            content: "",
            isStreaming: true,
            createdAt: Date()
        )
        messages[key, default: []].append(placeholder)
        isStreaming[key] = true
        return (messages[key]?.count ?? 1) - 1
    }

    /// Append a streamed token to the assistant message at `index`.
    /// No-op if the index is out of bounds (defensive against late
    /// deltas arriving after `clear()` or `markAssistantComplete`).
    func appendAssistantDelta(key: String, index: Int, delta: String) {
        guard var list = messages[key], list.indices.contains(index) else { return }
        list[index].content += delta
        messages[key] = list
    }

    /// Flip the streaming flag off and reset the assistant bubble's
    /// `isStreaming`. Called when the SSE stream closes cleanly.
    func markAssistantComplete(key: String, index: Int) {
        if var list = messages[key], list.indices.contains(index) {
            list[index].isStreaming = false
            messages[key] = list
        }
        isStreaming[key] = false
    }

    /// Set a soft error banner for a key. UI shows a small inline
    /// banner; existing assistant bubble stays visible.
    func setError(key: String, message: String) {
        lastError[key] = message
        isStreaming[key] = false
    }

    /// Drop every key's state. Used by `ChatStore.clearForSignOut()`
    /// (Wave A `Clearable` fan-out) so the next user's session starts
    /// with a clean buffer. SwiftData rows are wiped separately by
    /// `PersistenceController.wipeAllData()`.
    func clear() {
        messages.removeAll()
        isStreaming.removeAll()
        lastError.removeAll()
    }
}

/// Lightweight value type for a single message in the buffer. Distinct
/// from `BrettMessage` (the SwiftData model): this is the in-memory
/// view-model shape that includes the live streaming flag.
struct ChatMessage: Identifiable, Equatable, Sendable {
    enum Role: String, Sendable {
        case user
        case brett
        case assistant
        case system
    }

    let id: String
    let role: Role
    var content: String
    var isStreaming: Bool
    let createdAt: Date
}
```

#### Step 4: Modify `ChatStore` to delegate buffer state to the new type

In `apps/ios/Brett/Stores/ChatStore.swift`:

1. **Remove** the existing `messages`, `isStreaming`, `lastError` stored properties.
2. **Remove** the existing `appendUser`, `beginAssistant`, `appendAssistantDelta`, `markAssistantComplete` private methods.
3. **Add** a `private let buffer = ChatMessageBuffer()` stored property.
4. **Replace** the public stored properties with computed properties:

```swift
var messages: [String: [ChatMessage]] { buffer.messages }
var isStreaming: [String: Bool] { buffer.isStreaming }
var lastError: [String: String] { buffer.lastError }
```

5. **Update** all internal call sites that previously mutated `self.messages` etc. to call `buffer.append*` / `buffer.setError` / `buffer.markAssistantComplete`.
6. **Update** `clearForSignOut()` to call `buffer.clear()` (in addition to `cancelAll()`).
7. **Move** the `ChatMessage` struct definition from `ChatStore.swift` to the new file — it lives with the buffer now.
8. **Update** `injectForTesting(...)` (DEBUG helper) to push state through `buffer.setMessages(...)` instead of mutating `self.messages` directly.

#### Step 5: Run tests, verify pass

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BrettTests/ChatMessageBufferTests 2>&1 | grep -E "(passed|failed|error:)" | tail -10
```

Expected: 6 new tests pass.

Run the broader smoke pass:

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BrettTests 2>&1 | grep -E "(Test run|tests in|passed|failed)" | tail -5
```

Expected: 619 tests pass (613 baseline + 6 new buffer tests).

#### Step 6: Commit

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/suspicious-agnesi-6f55a9 && git add apps/ios/Brett/Stores/Chat/ChatMessageBuffer.swift apps/ios/BrettTests/Stores/ChatMessageBufferTests.swift apps/ios/Brett/Stores/ChatStore.swift
git commit -m "refactor(ios): extract ChatMessageBuffer from ChatStore"
```

---

### Task 2: Extract `ChatPersister`

Single method (`persistAssistant`) + a `BrettMessage` write. Tiny target.

**Files:**
- Create: `apps/ios/Brett/Stores/Chat/ChatPersister.swift`
- Create: `apps/ios/BrettTests/Stores/ChatPersisterTests.swift`
- Modify: `apps/ios/Brett/Stores/ChatStore.swift` — delegate persistence to the new type

#### Step 1: Write the failing test

Create `apps/ios/BrettTests/Stores/ChatPersisterTests.swift`:

```swift
import Testing
import Foundation
import SwiftData
@testable import Brett

@Suite("ChatPersister", .tags(.smoke))
@MainActor
struct ChatPersisterTests {
    @Test func persistAssistantWritesBrettMessageRow() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let persister = ChatPersister(context: context)

        try persister.persistAssistant(
            content: "Hello from Brett.",
            itemId: "item-1",
            calendarEventId: nil,
            userId: "alice"
        )

        let descriptor = FetchDescriptor<BrettMessage>()
        let rows = try context.fetch(descriptor)
        #expect(rows.count == 1)
        #expect(rows[0].content == "Hello from Brett.")
        #expect(rows[0].itemId == "item-1")
        #expect(rows[0].calendarEventId == nil)
        #expect(rows[0].userId == "alice")
        #expect(rows[0].brettRole == .brett)
    }

    @Test func persistAssistantSkipsWhenContentIsEmpty() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let persister = ChatPersister(context: context)

        try persister.persistAssistant(
            content: "",
            itemId: "item-1",
            calendarEventId: nil,
            userId: "alice"
        )

        let rows = try context.fetch(FetchDescriptor<BrettMessage>())
        #expect(rows.isEmpty, "empty content should not produce a row")
    }

    @Test func persistAssistantSkipsWhenUserIdMissing() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let persister = ChatPersister(context: context)

        try persister.persistAssistant(
            content: "Has content but no user.",
            itemId: "item-1",
            calendarEventId: nil,
            userId: nil
        )

        let rows = try context.fetch(FetchDescriptor<BrettMessage>())
        #expect(rows.isEmpty, "missing userId should be a no-op")
    }
}
```

#### Step 2: Run test, confirm failure

Expected: BUILD FAILED — `ChatPersister` doesn't exist.

#### Step 3: Implement `ChatPersister`

Create `apps/ios/Brett/Stores/Chat/ChatPersister.swift`:

```swift
import Foundation
import SwiftData

/// Writes completed assistant messages to SwiftData. Single
/// responsibility: turn an in-memory streamed reply into a persisted
/// `BrettMessage` row. Errors are surfaced via `throws` so the caller
/// (the coordinator in `ChatStore.send(...)`) can decide what to log.
///
/// `userId` is required for persistence — without it the row's
/// multi-user invariant is broken, so we silently skip rather than
/// inserting an unscoped row. Same with empty content.
@MainActor
struct ChatPersister {
    private let context: ModelContext

    init(context: ModelContext = PersistenceController.shared.mainContext) {
        self.context = context
    }

    /// Persist a finished assistant message. No-op if `content` is
    /// empty or `userId` is nil — those are the same edge cases the
    /// previous monolithic `ChatStore.persistAssistant` handled.
    func persistAssistant(
        content: String,
        itemId: String?,
        calendarEventId: String?,
        userId: String?
    ) throws {
        guard !content.isEmpty, let userId else { return }

        let message = BrettMessage(
            userId: userId,
            role: .brett,
            content: content,
            itemId: itemId,
            calendarEventId: calendarEventId,
            createdAt: Date(),
            updatedAt: Date()
        )
        context.insert(message)
        try context.save()
    }
}
```

(If `BrettMessage`'s init signature is different, look up the actual signature in `apps/ios/Brett/Models/BrettMessage.swift` and adapt.)

#### Step 4: Modify `ChatStore` to delegate persistence

In `apps/ios/Brett/Stores/ChatStore.swift`:

1. **Remove** the existing `persistAssistant(...)` private method.
2. **Add** a `private let persister: ChatPersister` stored property; initialize in init: `self.persister = ChatPersister(context: persistence?.mainContext ?? PersistenceController.shared.mainContext)`.
3. **Replace** the inline call site (in the `stream(...)` orchestrator method) with `try? persister.persistAssistant(content: ..., itemId: ..., calendarEventId: ..., userId: ...)`. Log the error if non-nil via `BrettLog.store.error(...)`.

(The inline call uses `try?` because the existing contract was non-throwing — the persister failure logs and the user already has the in-memory bubble. Wave B principles say log + return, not throw. If desired in a follow-up wave, surface the failure to the user.)

#### Step 5: Run tests, verify pass

Expected: 3 new tests pass; broader smoke green at 622.

#### Step 6: Commit

```bash
git commit -m "refactor(ios): extract ChatPersister from ChatStore"
```

---

### Task 3: Extract `StreamingChatClient`

The biggest of the three. Owns SSE parsing + URLSession + byte streaming.

**Files:**
- Create: `apps/ios/Brett/Stores/Chat/StreamingChatClient.swift`
- Create: `apps/ios/BrettTests/Stores/StreamingChatClientTests.swift`
- Modify: `apps/ios/Brett/Stores/ChatStore.swift` — delegate streaming to the new type

#### Step 1: Write the failing test

Create `apps/ios/BrettTests/Stores/StreamingChatClientTests.swift`. Use `MockURLProtocol` (existing) to feed canned SSE bytes. The existing `apps/ios/BrettTests/Sync/ChatStreamingTests.swift` is a good template — much of its parser coverage migrates here, but tested against the new `StreamingChatClient` API.

```swift
import Testing
import Foundation
@testable import Brett

@Suite("StreamingChatClient", .tags(.smoke))
@MainActor
struct StreamingChatClientTests {
    @Test func parsesSimpleChunkSequence() async throws {
        let body = """
        event: chunk\ndata: {"type":"text","text":"Hello, "}\n\nevent: chunk\ndata: {"type":"text","text":"world."}\n\nevent: done\ndata: \n\n
        """
        let session = MockURLProtocol.makeSession(response: body)
        let client = StreamingChatClient(apiClient: APIClient.shared, session: session)

        var events: [StreamEvent] = []
        try await client.stream(path: "/chat/stream", body: ["test": true]) { event in
            events.append(event)
        }

        #expect(events.count == 3)
        if case .chunk(let s1) = events[0] { #expect(s1 == "Hello, ") } else { Issue.record("first event not chunk") }
        if case .chunk(let s2) = events[1] { #expect(s2 == "world.") } else { Issue.record("second event not chunk") }
        if case .done = events[2] {} else { Issue.record("third event not done") }
    }

    @Test func surfacesServerErrorEvent() async throws {
        let body = """
        event: error\ndata: {"message":"rate limited"}\n\n
        """
        let session = MockURLProtocol.makeSession(response: body)
        let client = StreamingChatClient(apiClient: APIClient.shared, session: session)

        var events: [StreamEvent] = []
        try await client.stream(path: "/chat/stream", body: [:]) { event in
            events.append(event)
        }

        #expect(events.count == 1)
        if case .error(let msg) = events[0] {
            #expect(msg == "rate limited")
        } else {
            Issue.record("expected .error event")
        }
    }

    @Test func handlesMalformedJsonAsEmptyChunk() async throws {
        let body = """
        event: chunk\ndata: {bad json}\n\nevent: done\n\n
        """
        let session = MockURLProtocol.makeSession(response: body)
        let client = StreamingChatClient(apiClient: APIClient.shared, session: session)

        var events: [StreamEvent] = []
        try await client.stream(path: "/chat/stream", body: [:]) { event in
            events.append(event)
        }

        // Malformed chunk should be dropped (not crash); done still fires.
        #expect(events.count == 1)
        if case .done = events[0] {} else { Issue.record("expected done after malformed chunk") }
    }
}
```

If `MockURLProtocol.makeSession(response:)` doesn't exist as a helper, look at how existing tests stub URL responses (`apps/ios/BrettTests/TestSupport/MockURLProtocol.swift`) and adapt — the existing API likely accepts a `Data` payload + a status code.

#### Step 2: Run test, confirm failure

Expected: BUILD FAILED — `StreamingChatClient` and `StreamEvent` don't exist (latter currently lives inside ChatStore as private).

#### Step 3: Implement `StreamingChatClient`

Create `apps/ios/Brett/Stores/Chat/StreamingChatClient.swift`:

```swift
import Foundation

/// Wire-format event from the chat SSE endpoint. Consumers receive
/// these as the stream emits; the coordinator turns them into buffer
/// mutations.
enum StreamEvent: Sendable, Equatable {
    case chunk(String)
    case done(String?)
    case error(String)
}

/// Owns the chat SSE transport. Single responsibility: produce a stream
/// of `StreamEvent` values from the server. No buffer, no SwiftData,
/// no orchestration.
///
/// Distinct from `Sync/SSEClient` which is a long-running reconnecting
/// client for sync notifications. Chat streams are short-lived per
/// message, so `StreamingChatClient` opens a fresh `URLSession.bytes`
/// for each call and exits when the stream closes.
@MainActor
struct StreamingChatClient {
    private let apiClient: APIClient
    private let session: URLSession

    init(
        apiClient: APIClient = .shared,
        session: URLSession = StreamingChatClient.makeStreamingSession()
    ) {
        self.apiClient = apiClient
        self.session = session
    }

    /// Open a stream against `path`, POST `body` as JSON, and yield
    /// each parsed event to `onEvent`. Returns when the stream closes
    /// (cleanly or via error). Throws on transport-level failure
    /// (network error, non-200 response).
    func stream(
        path: String,
        body: [String: Any],
        onEvent: @escaping (StreamEvent) async -> Void
    ) async throws {
        let url = apiClient.absoluteURL(for: path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        if let token = apiClient.tokenProvider?() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            // Drain bytes for error message before throwing.
            let errorMessage = await drainErrorMessage(from: bytes)
            await onEvent(.error(errorMessage))
            return
        }

        var lines: [String] = []
        for try await line in bytes.lines {
            if line.isEmpty {
                if !lines.isEmpty {
                    if let event = parseEvent(lines: lines) {
                        await onEvent(event)
                    }
                    lines.removeAll(keepingCapacity: true)
                }
                continue
            }
            lines.append(line)
        }
        // Flush any trailing event without a blank line.
        if !lines.isEmpty, let event = parseEvent(lines: lines) {
            await onEvent(event)
        }
    }

    /// Parse one SSE event from accumulated `event:` and `data:` lines.
    /// Returns nil for malformed events (the caller should drop them).
    static func parseEvent(lines: [String]) -> StreamEvent? {
        var eventName: String?
        var dataPayload: String?

        for line in lines {
            if let value = lineValue(line, prefix: "event:") {
                eventName = value
            } else if let value = lineValue(line, prefix: "data:") {
                if let existing = dataPayload {
                    dataPayload = existing + "\n" + value
                } else {
                    dataPayload = value
                }
            }
        }

        switch eventName {
        case "chunk":
            guard
                let dataPayload,
                let data = dataPayload.data(using: .utf8),
                let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                return nil
            }
            // Server sends { type, text } or { type, content }. Accept either.
            if let text = json["text"] as? String { return .chunk(text) }
            if let content = json["content"] as? String { return .chunk(content) }
            return nil
        case "done":
            return .done(dataPayload)
        case "error":
            guard
                let dataPayload,
                let data = dataPayload.data(using: .utf8),
                let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let message = json["message"] as? String
            else {
                return .error("Unknown error")
            }
            return .error(message)
        default:
            return nil
        }
    }

    private static func lineValue(_ line: String, prefix: String) -> String? {
        guard line.hasPrefix(prefix) else { return nil }
        let rest = line.dropFirst(prefix.count)
        // SSE convention: optional space after colon.
        if rest.first == " " { return String(rest.dropFirst()) }
        return String(rest)
    }

    private func drainErrorMessage(from bytes: URLSession.AsyncBytes) async -> String {
        var buffer = ""
        for try? await line in bytes.lines {
            buffer += line + "\n"
        }
        // Try to parse server's standard error envelope.
        if let data = buffer.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let message = json["error"] as? String {
            return message
        }
        return buffer.isEmpty ? "Stream failed" : buffer
    }

    static func makeStreamingSession() -> URLSession {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 120
        config.timeoutIntervalForResource = 600
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        config.httpShouldUsePipelining = false
        return URLSession(configuration: config)
    }
}
```

(The exact `apiClient.absoluteURL(for:)` and `tokenProvider` calls may have different names — read `apps/ios/Brett/Networking/APIClient.swift` and adapt to the existing public API. The point is: the new class wraps what `ChatStore` already does, just isolated.)

#### Step 4: Modify `ChatStore` to delegate streaming

In `apps/ios/Brett/Stores/ChatStore.swift`:

1. **Remove** `makeStreamingSession()`, `parseSSE(...)`, `extractErrorMessage(...)`, `drainBytes(...)`, and the inline `URLSession.bytes(for:)` block from the existing `stream(...)` orchestrator.
2. **Remove** the `StreamEvent` enum (now lives in `StreamingChatClient.swift`).
3. **Add** a `private let streaming: StreamingChatClient` stored property; initialize in init: `self.streaming = StreamingChatClient(apiClient: apiClient, session: session)`.
4. **Replace** the streaming portion of the orchestrator with `try await streaming.stream(path:, body:, onEvent: { event in self.handle(event:, key:, index:) })`. The `handle` method (which routes events into buffer mutations) stays in the coordinator.

#### Step 5: Run tests

Expected: 3 new streaming tests pass; broader smoke green.

Pay extra attention to `apps/ios/BrettTests/Sync/ChatStreamingTests.swift` and `apps/ios/BrettTests/Views/ChatStoreTests.swift` — they exercise the parser. After this task, the parser test file should still pass (the parser logic is now in the new client, but the tests can target either the old or new parser; if they target a `ChatStore`-private API, they may need updating to use `StreamingChatClient.parseEvent` directly).

If those tests fail, decide:
- (a) Update them to call `StreamingChatClient.parseEvent(lines:)` directly (preferred — same coverage, just retargeted)
- (b) Delete the redundant cases (they'd duplicate the new `StreamingChatClientTests`)

Recommend (a) for now; (b) is a cleanup follow-up.

#### Step 6: Commit

```bash
git commit -m "refactor(ios): extract StreamingChatClient from ChatStore"
```

---

### Task 4: Slim `ChatStore` to a thin coordinator

After Tasks 1–3, `ChatStore` is much smaller already. This task is a polish pass: ensure the file is now a clean coordinator with no leftover state, no dead helpers, no orphan comments.

**Files:**
- Modify: `apps/ios/Brett/Stores/ChatStore.swift`

#### Steps

1. Read the post-Task-3 `ChatStore.swift`. Identify any:
   - Dead private helpers
   - Stored state that's now duplicated in `buffer`/`persister`/`streaming`
   - Comments that referenced moved code
   - Leftover `import` statements that the slimmed file no longer needs (e.g., `SwiftData` if no SwiftData type is referenced after delegation)

2. Trim. Each removal should not change behavior; verify with the test suite.

3. The post-trim file should have:
   - One coordinator class `ChatStore` with the delegated triple
   - `send(itemId:message:userId:)` and `send(eventId:message:userId:)` orchestrator methods
   - `cancelAll()`, `clearForSignOut()`, `hydrate*` helpers
   - The `ChatStoreRegistry` (kept for now — Wave A integration)
   - Likely under 250 lines

4. Run the full test suite; expect green.

5. Commit:

```bash
git commit -m "refactor(ios): slim ChatStore to coordinator after split"
```

---

## Phase 2 — Settings views section extraction

Goal: each of the three biggest settings views drops from ~750-900 lines to a ~80-line outline + per-section private structs in the same file. No new files, no new sub-stores.

The pattern: extract each user-visible section into a `private struct XSection: View` defined in the same file. Each section owns its own `@State` (moved from the parent), takes a small set of `@Bindings` or a `@ObservedObject` for the parent's shared state, and has its own API call sites.

### Task 5: Extract sections from `LocationSettingsView`

**Files:**
- Modify: `apps/ios/Brett/Views/Settings/LocationSettingsView.swift`

#### Reference: post-recon section map

| Section | Lines (current) | State owned | API |
|---|---|---|---|
| `AssistantPersonaSection` | 152–233 | `assistantName`, `isAssistantNameSaving`, `briefingEnabled` | `PATCH /users/me` |
| `MemoryFactsSection` | 235–408 | `memoryFacts`, `isLoadingMemory`, `memoryErrorMessage`, `factIdPendingConfirm`, `factIdDeleting` | `GET /brett/memory/facts`, `DELETE /brett/memory/facts/:id` |
| `TimezoneSection` | 410–453 | `timezoneAuto`, `selectedTimezone` (+ search picker) | `PATCH /users/timezone` |
| `WeatherLocationSection` | 454–571 | `weatherEnabled`, `selectedTempUnit`, `cityQuery`, `geocodeResults`, `isSearching`, `debounceTask` | `GET /weather/geocode`, `PATCH /users/location` |

#### Steps

1. Read `apps/ios/Brett/Views/Settings/LocationSettingsView.swift` end-to-end. Confirm the line ranges above.

2. For each section:
   - Define `private struct XSection: View` after the existing `LocationSettingsBody` struct.
   - Move the section's `@State` properties into the new struct (private).
   - Move the section's API helper methods (e.g., `saveAssistantName`, `loadMemoryFacts`) into the new struct.
   - Move the `@ViewBuilder var body: some View` content into the section struct.
   - The new struct takes whatever bindings it needs from the parent — typically `userId: String` (non-optional), `currentProfile: UserProfile?`, plus any cross-section state (e.g., the global `successMessage`/`errorMessage` flags from the parent's save toolbar).

3. The body of `LocationSettingsBody` becomes a thin outline:

```swift
var body: some View {
    Form {
        AssistantPersonaSection(
            userId: userId,
            currentProfile: currentProfile,
            globalErrorBinding: $errorMessage,
            globalSuccessBinding: $successMessage
        )
        MemoryFactsSection(userId: userId)
        TimezoneSection(userId: userId, currentProfile: currentProfile)
        WeatherLocationSection(userId: userId, currentProfile: currentProfile)
    }
    // ... navigation chrome, toolbar, etc.
}
```

4. **Keep the global save toolbar** that the recon flagged — `LocationSettingsView`'s `save()` calls `saveTimezone()` + `saveWeatherLocation()`. After this refactor, the parent's save still calls into both sections via `@State` keys or via methods on the section structs. If methods need to live on the sections but be invokable from the parent, expose them via a shared `ObservableObject` or pass a closure. Cleanest:
   - Keep `saveTimezone` / `saveWeatherLocation` as methods on the parent (LocationSettingsBody).
   - The sections read state via `@Binding` from the parent.
   - When the user taps the toolbar Save button, the parent's `save()` runs both sequentially.

   This is a wider scope than pure section extraction — adapt as the file's actual shape demands.

5. Run the build + test suite. Expected: 619 + 6 + 3 + 3 = 631 tests still pass (no new tests in this task; pure refactor).

6. Commit:

```bash
git commit -m "refactor(ios): extract sections from LocationSettingsView"
```

#### Constraint

- Sections are PRIVATE structs in the same file — don't create new files. The goal is visual decomposition + clearer scope per section, not new files.
- Don't add tests — settings views aren't unit-tested in this codebase, manual smoke covers them.

---

### Task 6: Extract sections from `SecuritySettingsView`

**Files:**
- Modify: `apps/ios/Brett/Views/Settings/SecuritySettingsView.swift`

#### Reference: section map

| Section | Lines | State | API |
|---|---|---|---|
| `AppLockSection` | 71–91 | `faceIDEnabled`, `biometryAvailable`, `biometryType` | None (local UserDefaults) |
| `SignInMethodSection` | 93–134 | `providerIds`, `isLoadingAccounts` | `GET /api/auth/list-accounts` |
| `PasskeysSection` | 212–283, 418–561 | `passkeys`, `isLoadingPasskeys`, `passkeyErrorMessage`, etc. | 4 endpoints under `/api/auth/passkey/*` |
| `PasswordChangeSection` | 154–210 | `currentPassword`, `newPassword`, etc. | `POST /api/auth/change-password` |

#### Steps

Same pattern as Task 5. Each section becomes a `private struct XSection: View`.

**Special note: `PasskeysSection`** is ~180 lines including WebAuthn boilerplate (`PasskeyRegistrar` continuation bridge). Keep that boilerplate inline in the section struct. Don't try to extract the WebAuthn helper into a separate file — same-file private struct is the right scope.

**`SignInMethodSection`** is read-only and small. It can be even simpler — just take `providerIds: [String]` as input, no internal state.

The parent (`SecuritySettingsBody`, if it has one — verify by reading the file; if no body subview, the outer view is the body) becomes:

```swift
Form {
    AppLockSection()
    SignInMethodSection(/* params */)
    if isCredentialAccount {
        PasswordChangeSection(/* params */)
    }
    PasskeysSection(/* params */)
}
```

Run + commit:

```bash
git commit -m "refactor(ios): extract sections from SecuritySettingsView"
```

---

### Task 7: Extract sections from `CalendarSettingsView`

**Files:**
- Modify: `apps/ios/Brett/Views/Settings/CalendarSettingsView.swift`

#### Reference: section map

| Section | Lines | State | API |
|---|---|---|---|
| `GoogleCalendarSection` | 77–110 + 152–295 | `store` (CalendarAccountsStore), `isConnecting`, `errorMessage`, `pendingDeleteId`, `reauthingAccountId` | Delegated to `CalendarAccountsStore` |
| `GranolaIntegrationSection` | 300–662 | `granolaStatus`, `isGranolaLoading`, etc. | `/granola/auth/*` |

#### Steps

Same pattern — two sections this time, both completely decoupled per recon.

The parent becomes:

```swift
Form {
    GoogleCalendarSection(store: calendarAccountsStore)
    GranolaIntegrationSection()
}
```

Commit:

```bash
git commit -m "refactor(ios): extract sections from CalendarSettingsView"
```

---

## Phase 3 — Detail view container + onChange consolidation

### Task 8: Extract `DetailViewContainer`

**Files:**
- Create: `apps/ios/Brett/Views/Detail/DetailViewContainer.swift`
- Modify: `apps/ios/Brett/Views/Detail/TaskDetailView.swift`
- Modify: `apps/ios/Brett/Views/Detail/EventDetailView.swift`

#### Reference: shared shape

Both detail views currently:
- ScrollView with `.scrollDismissesKeyboard(.interactively)` + `.scrollIndicators(.hidden)`
- Safe-area padding
- `.task` lifecycle to load data
- A loading placeholder while data is fetching
- A `dismiss` button via `@Environment(\.dismiss)`

`DetailViewContainer<Content: View>` captures the scroll + safe-area + dismiss + loading wireframe. Each detail view passes its content via a `@ViewBuilder`.

#### Steps

Create `apps/ios/Brett/Views/Detail/DetailViewContainer.swift`:

```swift
import SwiftUI

/// Shared wireframe for detail views. Captures the scroll setup, safe
/// area handling, and dismiss button so `TaskDetailView` and
/// `EventDetailView` (and future detail views) don't duplicate it.
///
/// Intentionally minimal. Doesn't try to share section components
/// (header, notes editor, attachments) — those have task-vs-event-
/// specific semantics that resist a shared abstraction. Just the
/// outermost wireframe.
struct DetailViewContainer<Content: View>: View {
    @ViewBuilder let content: () -> Content

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            content()
                .padding(.horizontal, BrettSpacing.gutter)
                .padding(.bottom, BrettSpacing.bottomSafe)
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollIndicators(.hidden)
        .background(BackgroundView())
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .accessibilityLabel("Close")
                }
            }
        }
    }
}
```

(The exact `BrettSpacing.gutter` / `BrettSpacing.bottomSafe` may have different names — read the existing detail view files to find the spacing tokens they use today and adapt.)

#### Adopt in `TaskDetailView`

In `TaskDetailView` (specifically in `TaskDetailBody`), wrap the existing body content in `DetailViewContainer`:

```swift
var body: some View {
    DetailViewContainer {
        // ... existing section composition: header, ContentPreview,
        //     DetailsCard, NotesEditor, AttachmentsSection,
        //     LinksSection, BrettChatSection
    }
    .task { /* existing task body */ }
    .onChange(of: item?.id) { /* existing seed-draft logic */ }
    // ... other existing modifiers
}
```

The container handles the scroll wrapper + dismiss button. The detail-specific `.task`, `.onChange`, etc. modifiers stay on the outermost view (the container itself or the wrapping subview).

#### Adopt in `EventDetailView`

Same. Wrap the body content in `DetailViewContainer { ... }`.

#### Tests

No new tests required — detail views aren't unit-tested. The build is the regression guard; if the container's interface is wrong the type-checker fails.

#### Run + commit

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BrettTests 2>&1 | grep -E "(Test run|tests in|passed|failed)" | tail -5
```

Expected: same test count, all green.

```bash
git commit -m "refactor(ios): extract DetailViewContainer for Task + Event detail"
```

---

### Task 9: Collapse TaskDetailView's four `.onChange` chains into one debounced commit

**Files:**
- Modify: `apps/ios/Brett/Views/Detail/TaskDetailView.swift`

#### Current state

`TaskDetailBody` has four separate `.onChange` modifiers, each calling `commitDraft()`:

```swift
.onChange(of: draft.dueDate) { _, _ in commitDraft() }
.onChange(of: draft.listId) { _, _ in commitDraft() }
.onChange(of: draft.reminder) { _, _ in commitDraft() }
.onChange(of: draft.recurrence) { _, _ in commitDraft() }
```

A user editing two fields in quick succession enqueues two separate mutations. The fix: one `.onChange` on the entire `draft` struct, debounced ~500ms.

#### Implementation

Replace the four `.onChange` blocks with one:

```swift
.onChange(of: draft) { _, newDraft in
    debounceCommit(newDraft)
}
```

Add a debounce helper:

```swift
@State private var commitDebounceTask: Task<Void, Never>?

private func debounceCommit(_ newDraft: ItemDraft) {
    commitDebounceTask?.cancel()
    commitDebounceTask = Task {
        do {
            try await Task.sleep(nanoseconds: 500_000_000)  // 500 ms
            guard !Task.isCancelled else { return }
            await MainActor.run {
                commitDraft()
            }
        } catch {
            // CancellationError — a newer change came in; that's fine.
        }
    }
}
```

This requires `ItemDraft: Equatable`. Verify by reading `apps/ios/Brett/Models/MutableFieldModel.swift` (or wherever `ItemDraft` lives). If it's not, add an `Equatable` conformance with the four user-mutable fields (dueDate, listId, reminder, recurrence) — the spec already considers these the relevant axes.

If `commitDraft` is async, adapt accordingly. If `ItemDraft` includes the title (which is bound to a TextField with its own commit-on-blur path), be careful: title-typing shouldn't fire commitDraft 500ms later — title commits already go through the existing TextField handler. Either:
- Exclude title from the `Equatable` conformance (ignored for change detection)
- Keep title's separate commit path; the new debounce only fires on non-title field changes

Read the actual `ItemDraft` shape and `commitDraft()` body to decide.

#### Cleanup

The new debounce task needs to be cancelled on view disappear so it doesn't outlive the view:

```swift
.onDisappear { commitDebounceTask?.cancel() }
```

#### Tests

If `ItemDraftTests` exists, add a test or adjust an existing one to assert that:
- One field change triggers exactly one commit after the debounce window
- Two field changes within the window trigger only one commit

The exact test depends on whether `commitDraft` is observable from a test perspective. If it's not (e.g., only mutates an internal cache), the manual smoke is the regression check; document that.

#### Run + commit

```bash
git commit -m "fix(ios): debounce TaskDetailView draft commits (one .onChange instead of four)"
```

---

## Phase 4 — `SyncEntityMapper` migration to per-model `Codable`

Eight model migrations, ordered safest-first. The strategy: each model gains explicit `Codable` (with `CodingKeys`, `init(from:)`, `encode(to:)`); the mapper's per-model methods migrate to use the Codable round-trip; existing round-trip tests are the safety net.

**Migration order** (smallest field count first):
1. `CalendarEventNote` (5 fields) — trivial pilot
2. `Attachment` (9 fields) — simple
3. `BrettMessage` (6 fields) — adds enum role
4. `ItemList` (7 fields) — first list migration
5. `ScoutFinding` (13 fields) — reserved-word remap (`description`)
6. `Scout` (20 fields) — JSON blob (`sourcesJSON`)
7. `Item` (28 fields) — reserved-word remap + content metadata JSON
8. `CalendarEvent` (32 fields, 4 JSON blobs) — last and hardest

**Strategy invariant per migration:** the existing `SyncEntityMapperTests` round-trip test for that model continues to pass at every commit. Don't move on to the next model until that test is green for the current one.

### Task 10: Pilot — `CalendarEventNote`

**Files:**
- Modify: `apps/ios/Brett/Models/<wherever CalendarEventNote is defined>` (likely `apps/ios/Brett/Models/CalendarEvent.swift` or a sibling)
- Modify: `apps/ios/Brett/Sync/SyncEntityMapper.swift`

#### Steps

1. Read the existing `CalendarEventNote` model definition + the existing `SyncEntityMapper` per-model methods for it (`toServerPayloadCalendarEventNote`, `calendarEventNoteFromServerJSON`, `applyCalendarEventNoteFields`, `upsertCalendarEventNote`).

2. Read the existing test in `apps/ios/BrettTests/Sync/SyncEntityMapperTests.swift` — `calendarEventNoteRoundTrip()`. This is the safety net.

3. Add `Codable` conformance + explicit logic to `CalendarEventNote`:

```swift
extension CalendarEventNote: Codable {
    enum CodingKeys: String, CodingKey {
        case id, userId, eventId, content, createdAt, updatedAt, deletedAt
        // ... add any sync-metadata keys: _syncStatus, _baseUpdatedAt
    }

    convenience init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let userId = try container.decode(String.self, forKey: .userId)
        let eventId = try container.decode(String.self, forKey: .eventId)
        let content = try container.decode(String.self, forKey: .content)
        let createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        let updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt) ?? Date()

        self.init(
            id: id,
            userId: userId,
            eventId: eventId,
            content: content,
            createdAt: createdAt,
            updatedAt: updatedAt
        )

        self.deletedAt = try container.decodeIfPresent(Date.self, forKey: .deletedAt)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(userId, forKey: .userId)
        try container.encode(eventId, forKey: .eventId)
        try container.encode(content, forKey: .content)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encodeIfPresent(deletedAt, forKey: .deletedAt)
    }
}
```

(The exact field set comes from the existing `toServerPayloadCalendarEventNote` and `applyCalendarEventNoteFields` methods. Mirror them precisely — same field names, same date strategy, same nullability.)

4. Add a `JSONDecoder` / `JSONEncoder` factory in `SyncEntityMapper` if one doesn't exist:

```swift
private static func makeDecoder() -> JSONDecoder {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .custom { decoder in
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        return BrettDate.parse(raw) ?? Date()  // Match existing fallback
    }
    return decoder
}

private static func makeEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .custom { date, encoder in
        var container = encoder.singleValueContainer()
        try container.encode(BrettDate.isoString(date))
    }
    return encoder
}
```

(The exact `BrettDate.parse`/`isoString` API comes from `apps/ios/Brett/Utilities/` — read it and adapt.)

5. Replace the existing `SyncEntityMapper` per-model methods for `CalendarEventNote`:

```swift
private static func upsertCalendarEventNote(
    record: [String: Any],
    context: ModelContext,
    respectLocalPending: Bool
) -> CalendarEventNote? {
    do {
        let data = try JSONSerialization.data(withJSONObject: record)
        let decoder = makeDecoder()
        let incoming = try decoder.decode(CalendarEventNote.self, from: data)

        // Existing fetchById + respect-pending logic stays.
        if let existing = fetchById(CalendarEventNote.self, id: incoming.id, in: context) {
            if respectLocalPending && existing._syncStatus != "synced" {
                return existing
            }
            // Apply fields onto existing — preserve old applyFields logic.
            existing.userId = incoming.userId
            existing.eventId = incoming.eventId
            existing.content = incoming.content
            existing.updatedAt = incoming.updatedAt
            existing.deletedAt = incoming.deletedAt
            markSynced(existing, baseUpdatedAt: existing.updatedAt)
            return existing
        }
        context.insert(incoming)
        markSynced(incoming, baseUpdatedAt: incoming.updatedAt)
        return incoming
    } catch {
        BrettLog.pull.error("Decode CalendarEventNote failed: \(String(describing: error), privacy: .public)")
        return nil
    }
}

private static func toServerPayloadCalendarEventNote(_ note: CalendarEventNote) -> [String: Any] {
    let encoder = makeEncoder()
    do {
        let data = try encoder.encode(note)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return [:]
        }
        return json
    } catch {
        BrettLog.push.error("Encode CalendarEventNote failed: \(String(describing: error), privacy: .public)")
        return [:]
    }
}
```

Note: `applyCalendarEventNoteFields` becomes inline in the upsert path; it's a small enough field set that the inline version is clearer than a helper. For larger models, keep the helper.

6. Run the existing `calendarEventNoteRoundTrip()` test:

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BrettTests/SyncEntityMapperTests 2>&1 | grep -E "(passed|failed)" | tail -10
```

Expected: PASS. If FAIL, debug — the field mapping likely diverged from the existing impl. The test is the authoritative spec; the new impl must match field-for-field.

7. Run the broader smoke pass to confirm pull/push integration still works:

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BrettTests/PullEngineTests -only-testing:BrettTests/PushEngineTests 2>&1 | grep -E "(passed|failed)" | tail -10
```

Expected: PASS.

8. Commit:

```bash
git commit -m "refactor(ios): SyncEntityMapper migrates CalendarEventNote to Codable"
```

---

### Tasks 11–17: Migrate remaining models

Each follows the same pattern as Task 10 — `Codable` conformance on the model, replace the per-model methods in the mapper. Per-task highlights:

### Task 11: `Attachment`

9 fields, simple. Round-trip test: `attachmentRoundTrip()`.

Commit: `refactor(ios): SyncEntityMapper migrates Attachment to Codable`

### Task 12: `BrettMessage`

6 fields + `Role` enum. The enum already conforms to `Codable` (verify in `Enums.swift`); `Role` decodes from a String.

Commit: `refactor(ios): SyncEntityMapper migrates BrettMessage to Codable`

### Task 13: `ItemList`

7 fields. First list migration. Round-trip test: `listRoundTrip()`.

Commit: `refactor(ios): SyncEntityMapper migrates ItemList to Codable`

### Task 14: `ScoutFinding`

13 fields with reserved-word remap (`findingDescription` ↔ `"description"`):

```swift
enum CodingKeys: String, CodingKey {
    case id, userId, scoutId, title
    case findingDescription = "description"
    case createdAt, updatedAt, deletedAt
    // ... etc.
}
```

Round-trip test: `scoutFindingReservedDescriptionRoundTrips()`.

Commit: `refactor(ios): SyncEntityMapper migrates ScoutFinding to Codable`

### Task 15: `Scout`

20 fields + JSON blob (`sourcesJSON: String?` ↔ `"sources"` as JSON dict/array).

The JSON blob handling: in `init(from:)`, decode `sources` as a generic `Any?` via `decodeIfPresent(JSONValue.self, ...)` (or use `JSONSerialization` directly), then re-encode to a string and store as `sourcesJSON`. In `encode(to:)`, take `sourcesJSON`, parse to a JSON value, and encode as `sources`.

Define a small `JSONValue` enum for this if it doesn't exist:

```swift
enum JSONValue: Codable, Sendable {
    case string(String), int(Int), double(Double), bool(Bool)
    case array([JSONValue]), object([String: JSONValue]), null
    // ... encode/decode
}
```

Or — simpler, given the existing code already does `JSONSerialization` round-trips — keep the helper-based approach for blob fields and only use `Codable` for the structured fields.

Round-trip test: `scoutSourcesJSONRoundTrips()`.

Commit: `refactor(ios): SyncEntityMapper migrates Scout to Codable`

### Task 16: `Item`

28 fields with reserved-word remap (`itemDescription` ↔ `"description"`) and content metadata JSON. The most important model in the app. Existing test: `itemRoundTripPreservesAllFields()` — exhaustive coverage.

Commit: `refactor(ios): SyncEntityMapper migrates Item to Codable`

### Task 17: `CalendarEvent`

32 fields, 4 JSON blobs (`organizerJSON`, `attendeesJSON`, `attachmentsJSON`, `rawGoogleEventJSON`), reserved-word remap (`eventDescription` ↔ `"description"`).

The riskiest. Existing test: `calendarEventReservedDescriptionRoundTrips()` (covers reserved word + JSON blobs but not all 32 fields). Consider adding an exhaustive `calendarEventRoundTripPreservesAllFields()` test in this commit to mirror the Item-level coverage.

Commit: `refactor(ios): SyncEntityMapper migrates CalendarEvent to Codable`

---

### Task 18: Mapper cleanup + dispatcher slimming

After all 8 models migrate, the mapper file has dead helpers (the old per-model `toServerPayload*` etc. should already be gone, but the file may still have `applyXFields` helpers that became unused, plus dead utility funcs).

**Files:**
- Modify: `apps/ios/Brett/Sync/SyncEntityMapper.swift`

#### Steps

1. Read the post-migration mapper file. Identify:
   - Unused private methods
   - Dead imports
   - Stale comments referencing old approach
   - Helpers that are now duplicated in the model files

2. Remove. Each removal verified by build + tests.

3. The post-cleanup mapper should be ~150 lines: the dispatcher + the `JSONDecoder`/`JSONEncoder` factory + `markSynced` + `fetchById<T>` + `hardDelete`.

4. Run all tests; expect green.

5. Commit:

```bash
git commit -m "refactor(ios): slim SyncEntityMapper after Codable migration"
```

---

## Phase 5 — Dead-code sweep + final verification

### Task 19: Dead-code sweep

After Wave C, opportunities for cleanup that surfaced during reconnaissance:

- `ChatStore.send(eventId:...)` may be unused if calendar-event chat isn't wired in any view (per recon, no view caller found). Verify with `grep -r "send(eventId:" apps/ios/Brett/Views/`. If unused, delete.
- `ChatStoreRegistry` (existing) coexists with `ClearableStoreRegistry` (Wave A). Wave A's plan said this would be revisited; now is the time. If `ChatStoreRegistry.cancelAllActive()` is functionally redundant with `ClearableStoreRegistry.clearAll()` (which already calls `ChatStore.clearForSignOut()` which calls `cancelAll()`), retire `ChatStoreRegistry`.
- Stale doc comment in `Session.tearDown()` referencing the chat-cancel-as-step-1 ordering (deferred from Wave A Task 2 review). Update once `ChatStoreRegistry` is gone.
- `MutationCompactor` decision (spawned task from Wave B). If the user has decided how to handle it, action accordingly. If still undecided, leave alone.
- Other obvious dead code surfaced during the wave.

Per finding, decide: delete, document, or punt. Each decision gets a comment in the commit message.

#### Steps

1. Audit each candidate. Verify "dead" with `grep` + careful reading.
2. Apply deletions.
3. Run tests; expect green.
4. Commit:

```bash
git commit -m "refactor(ios): dead-code sweep after Wave C"
```

---

### Task 20: Final smoke + manual verification

#### Step 1: Full unit test suite

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BrettTests 2>&1 | grep -E "(Test run|tests in|passed|failed)" | tail -5
```

Expected: ~625 tests pass (613 baseline + ~12 new in Phase 1's chat split). Test count drop from any retired tests in Task 19 or Task 18 is fine; the round-trip tests are unchanged.

#### Step 2: UI test suite

```bash
cd apps/ios && xcodebuild test -scheme BrettUITests -destination 'platform=iOS Simulator,name=iPhone 17' 2>&1 | tail -10
```

Expected: same green/skipped count as before.

#### Step 3: Manual smoke checklist

Boot the app on a simulator. Walk through:

1. Send a chat message in a task detail. Verify streaming renders incrementally, completes cleanly, and the assistant message persists across app restart.
2. Force-quit during streaming. Relaunch. Verify the partial assistant message either persists (if server flush completed) or is gone — no orphaned "thinking..." spinner.
3. Open Settings → Location. Edit assistant name + timezone. Tap Save. Verify both persist. Verify each section's loading state is independent.
4. Open Settings → Security. Verify each section renders correctly. Try password change (account-permitting) and passkey list.
5. Open Settings → Calendar. Verify Google Calendar accounts list and Granola section both render.
6. Open a task detail, edit due date and list rapidly. Verify mutation queue gets ONE entry (debounce works).
7. Sync an item from desktop. Verify it appears on iOS. Edit on iOS. Verify sync round-trips through the new Codable path. (`SyncEntityMapper` round-trip is the load-bearing piece.)
8. Sign out, sign in as different user. Verify all detail views, settings, and chat history start clean for the new user.

#### Step 4: Push branch + update PR

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/suspicious-agnesi-6f55a9 && git push origin claude/suspicious-agnesi-6f55a9
```

Update PR description (`gh pr edit 105`) with a Wave C section.

---

## Self-review checklist (run once after final task)

- [ ] **Spec coverage:** Every Wave C scope item from the spec maps to ≥1 task above:
  - ChatStore split → Tasks 1-4
  - SyncEntityMapper generic refactor → Tasks 10-18
  - Settings splits (top 3) → Tasks 5-7
  - DetailViewContainer + onChange consolidation → Tasks 8-9
  - Dead-code sweep → Task 19
- [ ] **No placeholders:** every step has a concrete file path, code block, expected output, or commit command.
- [ ] **Type consistency:** `ChatMessageBuffer`, `ChatPersister`, `StreamingChatClient`, `StreamEvent`, `DetailViewContainer`, `JSONValue` (if used), `makeDecoder`/`makeEncoder` are used consistently.
- [ ] **Commits:** each task ends with a commit message matching the project convention.
- [ ] **Test framework:** Swift Testing for new tests (consistent with Waves A and B).

## Risk acknowledgment

This wave's biggest risks:

- **`SyncEntityMapper` per-model migration could corrupt sync** if a `Codable` round-trip diverges from the existing `toServerPayload`/`fromServerJSON` contract by even one field name, type, or null-handling decision. Mitigations: (1) the existing round-trip tests are the spec; never advance to the next model until the current model's test is green. (2) Migrate smallest first to prove the pattern. (3) Date strategy is consistent (`BrettDate.isoString`/`parse` via custom strategies on the shared decoder/encoder factory).
- **`ChatStore` split could regress streaming** if the orchestration boundary leaks state between the three new pieces. Mitigation: each piece has its own unit tests (`StreamingChatClientTests`, `ChatMessageBufferTests`, `ChatPersisterTests`); the existing `ChatStoreClearTests` continues to assert the integration.
- **Settings section extraction could break the global save flow on `LocationSettingsView`** if the toolbar's `save()` no longer reaches the section's API state. Mitigation: keep the section API helpers callable from the parent (either via `@Binding` exposing the section's commit method, or by keeping `saveTimezone`/`saveWeatherLocation` on the parent and reading section state via `@Binding`).
- **`DetailViewContainer` could regress detail-view chrome** if a section relies on outer scroll state or safe-area positioning. Mitigation: container is intentionally minimal; the post-extraction views remain visually identical.
- **`TaskDetailView` debounce could regress edit semantics** if `ItemDraft` isn't `Equatable` or `commitDraft` has hidden state. Mitigation: explicit `Equatable` conformance with the four edit fields; debounce uses `Task.sleep` so cancellation is well-defined.

---

## Post-wave plan

After Wave C merges, **Wave D** (navigation unification) is the final structural wave:
- One `NavDestination` enum drives both `.sheet(item:)` and `.navigationDestination`
- Settings deep-link via hash fragment, parity with desktop
- `SelectionStore` becomes presentation-state-only (renamed `NavStore`)
- Removes the manual two-step `path.append` deep-link pattern
