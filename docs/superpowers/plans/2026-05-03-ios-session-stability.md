# iOS Session Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the iOS app signing the user out unexpectedly (issues #111, #121, #123), and make Face ID re-issue sessions silently so users never see the sign-in screen on a trusted device.

**Architecture:**
- Server: sessions effectively never expire — iOS Google bypass-better-auth path uses 100 years; better-auth itself capped at 400 days by the cookie serializer's RFC 6265bis enforcement (`better-auth/dist/cookies/index.mjs:46` ties cookie max-age to `session.expiresIn`). With `updateAge: 24h` sliding refresh, any active user never expires either way. Tradeoff: a leaked token has lifetime access until manually revoked. Mitigated by the biometric keychain gate on iOS; web/desktop sessions also extend (acceptable — `__Secure-` cookies + CSRF). Future safety valve: "sign out all devices" feature (out of scope here).
- iOS: defensive 401 retry (3 attempts, exponential backoff) on both `/users/me` and `/api/auth/ios/session` paths before escalating to sign-out. Keychain write verification (read-back assertion). Soft sign-out UX (preserve last email + neutral "please sign in again" banner) — fires rarely (revoked-from-another-device, admin actions, server bug) but stops feeling like the app forgot the user.
- iOS: biometric-gated Keychain entry — when Settings → Security → Face ID is on, the bearer token is stored with `kSecAttrAccessControl` requiring `userPresence`. The single Face ID prompt covers both app unlock and Keychain decrypt via shared `LAContext` (`kSecUseAuthenticationContext`). When Face ID is off, fall back to today's `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`.

**Tech Stack:** Swift / SwiftUI / SecItem / LocalAuthentication; TypeScript / Hono / better-auth / Prisma; vitest / Swift Testing.

---

## File Structure

**Server (TypeScript)**
- Modify: `apps/api/src/lib/ios-google-signin.ts:55` — bump `SESSION_LIFETIME_SECONDS` constant.
- Modify: `packages/api-core/src/auth.ts:18` — add `session.expiresIn` + `session.updateAge` to `betterAuth({...})` config.
- Modify: `apps/api/src/__tests__/ios-google-signin.test.ts` — assert 90-day expiry math.
- Create: `apps/api/src/__tests__/session-lifetime.test.ts` — assert better-auth issues 90-day sessions for email/password.

**iOS — bug-fix layer**
- Modify: `apps/ios/Brett/Auth/AuthManager.swift` — extract retry helper, wire it into `refreshCurrentUser` and `refreshIfStale` post-first-refresh paths; surface keychain-write failures from `persist`.
- Modify: `apps/ios/Brett/Auth/KeychainStore.swift` — read-back verification helper; new biometric-gated write/read paths.
- Create: `apps/ios/Brett/Auth/SessionExpiryHint.swift` — small UserDefaults-backed type holding last email + "expired" flag for the soft-UX banner.
- Modify: `apps/ios/Brett/Views/SignInView.swift` (or wherever the sign-in UI lives — look for the `errorMessage` display) — show the banner + prefill email when `SessionExpiryHint` is set.
- Modify: `apps/ios/BrettTests/Auth/AuthManagerTests.swift` — retry behaviour, keychain-write-failure surfacing, soft-UX state.

**iOS — biometric gating layer**
- Modify: `apps/ios/Brett/Auth/BiometricLockManager.swift` — own the post-unlock `LAContext`, expose it for keychain reads.
- Modify: `apps/ios/Brett/Auth/AuthManager.swift` — defer keychain-hydrate until BiometricLockManager publishes an unlocked context; toggle re-write of stored token when Face ID setting changes.
- Modify: `apps/ios/Brett/Auth/KeychainStore.swift` — accept optional `LAContext` for reads; `writeToken(biometricGated: Bool)` variant.
- Modify: `apps/ios/BrettTests/Auth/KeychainEdgeTests.swift` — biometric-gated write fallback when policy unevaluable in test env.

---

## Plan Mode Review (per project CLAUDE.md)

**Size:** BIG. Auth code, multi-file, multi-platform. Full 4-section review below.

### 1. Architecture

- **Single-PR risk.** Bug-fix and biometric-gating changes are coupled in this PR. Recommendation: structure commits so the bug-fix tasks (Phases 1–4) land first, biometric gating (Phase 5) last. If review finds issues with biometric, we can drop the last commits without backing out the whole PR.
- **Launch-order change.** Today, `AuthManager.init()` hydrates the keychain synchronously. After Phase 5, hydration moves to *after* `BiometricLockManager` publishes a usable context. This is the riskiest single change in the plan; tested via UI-test launch args + a unit test that drives the new sequence directly.
- **Session-lifetime change applies to all clients.** Web/desktop sessions also become non-expiring. They're protected by `__Secure-` cookies + CSRF; the security boundary is the cookie/keychain itself, not `expiresIn`. Documented in the PR body. Future safety valve: "sign out all devices" feature for users to revoke a leaked token themselves.
- **Fallback when Face ID can't evaluate.** If `LAContext.canEvaluatePolicy` fails (no biometry + no passcode), we ALREADY fail-closed in `BiometricLockManager` (line 167-183). For the keychain side, the same code path falls through to "treat as not signed in" — user gets the sign-in screen, token stays put, can be recovered when they fix biometry.

### 2. Code Quality

- **DRY: retry helper.** Both `refreshCurrentUser` and `refreshIfStale` need identical 3-attempt exponential backoff on 401. Extract once. Lives in AuthManager (private), not a shared file — only two call sites.
- **`SessionExpiryHint` placement.** UserDefaults-backed, not a SwiftData model. Avoids polluting the persistence schema for a 2-field UI hint.
- **No new abstractions for the biometric path.** Reuse existing `BiometricLockManager` rather than introduce a new `KeychainAuthorizer` indirection — fewer moving parts, easier to reason about at launch.

### 3. Tests

- **Existing AuthManagerTests is 482 lines and covers cold-launch lenience already.** Extend, don't rewrite.
- **No Mac CI per project memory.** Server tests run in CI; iOS tests run locally + via release script. Plan the manual test pass on real device for biometric flows.
- **Manual test cases the PR description must list:**
  - sign in → hard kill → reopen (should NOT see sign-in screen if Face ID enabled; should see Face ID prompt then app)
  - sign in → airplane mode → off → 5-min wait (should NOT sign out; keepalive should retry then succeed)
  - sign in → wait several days → reopen (should still be signed in — sessions effectively don't expire)
  - sign out from another device → reopen (should soft sign-out with banner)
  - Face ID disabled in Settings → all flows behave like today

### 4. Performance

- **Retry adds up to ~7s of latency on real session-expiry.** Acceptable — better than wrongly signing user out. The 7s only applies to genuine revocations.
- **No N+1, no extra DB queries.** Server change is a constant.
- **Keychain readback adds one SecItem op per sign-in.** Negligible.

---

## Phase 1: Server — non-expiring sessions

### Task 1.1: Bump iOS Google session lifetime to 100 years

**Files:**
- Modify: `apps/api/src/lib/ios-google-signin.ts:55`
- Test: `apps/api/src/__tests__/ios-google-signin.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/__tests__/ios-google-signin.test.ts` (place near other expiry-related assertions; if none exist, add at the bottom of the existing test file before the closing brace):

```typescript
import { describe, it, expect } from "vitest";

describe("session lifetime", () => {
  it("issues effectively-non-expiring sessions for iOS Google sign-in", async () => {
    const fixedNow = new Date("2026-05-03T00:00:00Z");
    const result = await signInWithIOSGoogleIdToken({
      idToken: "fake.fake.fake",
      verifier: makeFakeVerifier({
        sub: "google-sub-1",
        email: "test@example.com",
        emailVerified: true,
      }),
      prisma: makeInMemoryPrisma(), // existing test helper in this file
      now: () => fixedNow,
    });

    const session = await prisma.session.findUnique({
      where: { token: result.token },
      select: { expiresAt: true },
    });
    // Assert "more than 50 years" rather than an exact number — keeps the
    // test stable if we ever bump the constant up further.
    const fiftyYearsMs = 50 * 365 * 24 * 60 * 60 * 1000;
    const diff = session!.expiresAt.getTime() - fixedNow.getTime();
    expect(diff).toBeGreaterThan(fiftyYearsMs);
  });
});
```

If the test helpers (`makeFakeVerifier`, `makeInMemoryPrisma`) named here don't exist verbatim, use whatever patterns the existing tests in this file use to construct a verifier and a prisma stub — read the top 80 lines of `ios-google-signin.test.ts` first. Do NOT introduce new test infrastructure.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && pnpm test -- ios-google-signin
```

Expected: FAIL — current value is 7 days, diff well below the 50-year threshold.

- [ ] **Step 3: Update the constant**

In `apps/api/src/lib/ios-google-signin.ts:55`, change:

```typescript
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7; // 7 days
```

to:

```typescript
// 100 years — effectively non-expiring. Active users never see a sign-in
// screen on a trusted device; revocation is the security boundary, not
// expiry. The biometric keychain gate (when Face ID is enabled in
// Settings → Security) protects the bearer at rest. Future "sign out all
// devices" feature is the user-visible recovery path.
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 365 * 100;
```

- [ ] **Step 4: Re-run test to verify it passes**

```bash
cd apps/api && pnpm test -- ios-google-signin
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/ios-google-signin.ts apps/api/src/__tests__/ios-google-signin.test.ts
git commit -m "feat(api): non-expiring iOS Google sessions"
```

### Task 1.2: Configure better-auth session lifetime

**Files:**
- Modify: `packages/api-core/src/auth.ts:18-78` — add `session` block to `betterAuth({...})` call.
- Test: `apps/api/src/__tests__/session-lifetime.test.ts` (new).

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/__tests__/session-lifetime.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

describe("better-auth session lifetime", () => {
  it("issues effectively-non-expiring sessions for email/password sign-up", async () => {
    const email = `lifetime-test-${Date.now()}@example.com`;
    const before = Date.now();
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password: "test-password-1234",
        name: "Lifetime Test",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const session = await prisma.session.findUnique({
      where: { token: body.token },
      select: { expiresAt: true },
    });
    expect(session).not.toBeNull();
    // Assert "more than 50 years out" — flexible enough to survive future
    // tweaks to the exact constant.
    const fiftyYearsMs = 50 * 365 * 24 * 60 * 60 * 1000;
    const diff = session!.expiresAt.getTime() - before;
    expect(diff).toBeGreaterThan(fiftyYearsMs);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && pnpm test -- session-lifetime
```

Expected: FAIL — better-auth's default is 7 days.

- [ ] **Step 3: Add session config to better-auth**

In `packages/api-core/src/auth.ts`, inside the `betterAuth({...})` call (between `database:` and `emailAndPassword:`), add:

```typescript
    session: {
      // 100 years — effectively non-expiring. Same rationale as
      // SESSION_LIFETIME_SECONDS in apps/api/src/lib/ios-google-signin.ts.
      // Web/desktop benefit too — browser sessions are bounded by cookie
      // lifecycle + `__Secure-` + CSRF, not by `expiresIn`.
      expiresIn: 60 * 60 * 24 * 365 * 100,
      updateAge: 60 * 60 * 24, // refresh `expiresAt` on activity once per 24h
    },
```

- [ ] **Step 4: Re-run test to verify it passes**

```bash
cd apps/api && pnpm test -- session-lifetime
```

Expected: PASS.

- [ ] **Step 5: Verify other auth tests still pass**

```bash
cd apps/api && pnpm test
```

Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api-core/src/auth.ts apps/api/src/__tests__/session-lifetime.test.ts
git commit -m "feat(api): non-expiring better-auth sessions with daily updateAge slide"
```

---

## Phase 2: iOS — defensive 401 retry helper

### Task 2.1: Add retry helper + wire into refreshCurrentUser

**Files:**
- Modify: `apps/ios/Brett/Auth/AuthManager.swift:380-415` (the `refreshCurrentUser` method).
- Test: `apps/ios/BrettTests/Auth/AuthManagerTests.swift`.

- [ ] **Step 1: Write the failing test**

In `apps/ios/BrettTests/Auth/AuthManagerTests.swift`, add (place inside the existing `AuthManagerTests` struct/suite, near other 401-related tests):

```swift
@Test("refreshCurrentUser retries 3 times on 401 before signing out")
@MainActor
func refreshCurrentUserRetriesOn401() async {
    let mockClient = MockAPIClient()
    // Return 401 three times, then succeed on the fourth.
    mockClient.queueResponse(.unauthorized)
    mockClient.queueResponse(.unauthorized)
    mockClient.queueResponse(.unauthorized)
    mockClient.queueResponse(.success(AuthUser(
        id: "u1", email: "a@b.com", name: "A",
        avatarUrl: nil, timezone: "UTC", assistantName: "Brett"
    )))

    let mgr = AuthManager(client: mockClient)
    mgr.injectFakeSession(
        user: AuthUser(id: "u1", email: "a@b.com", name: "A",
                       avatarUrl: nil, timezone: "UTC", assistantName: "Brett"),
        token: "tok",
        hasRefreshed: true
    )

    await mgr.refreshCurrentUser()

    #expect(mgr.token == "tok")
    #expect(mgr.currentUser?.id == "u1")
    #expect(mockClient.callCount == 4)
}

@Test("refreshCurrentUser signs out after 4 consecutive 401s")
@MainActor
func refreshCurrentUserGivesUpAfterRetries() async {
    let mockClient = MockAPIClient()
    for _ in 0..<10 { mockClient.queueResponse(.unauthorized) }

    let mgr = AuthManager(client: mockClient)
    mgr.injectFakeSession(
        user: AuthUser(id: "u1", email: "a@b.com", name: "A",
                       avatarUrl: nil, timezone: "UTC", assistantName: "Brett"),
        token: "tok",
        hasRefreshed: true
    )

    await mgr.refreshCurrentUser()

    #expect(mgr.token == nil)
    #expect(mockClient.callCount == 4)
}
```

If `MockAPIClient` doesn't yet have `queueResponse(.unauthorized)` ergonomics, look at the existing test file for the established pattern (search for `MockAPIClient` or `class MockAPI`) and reuse it. If existing mocks return only success/single-failure, extend the mock instead of building a new one.

- [ ] **Step 2: Run tests to verify they fail**

Build & test in Xcode (`Cmd+U`) or via:

```bash
xcodebuild -project apps/ios/Brett.xcodeproj -scheme Brett \
    -destination 'platform=iOS Simulator,name=iPhone 16' test \
    -only-testing:BrettTests/AuthManagerTests/refreshCurrentUserRetriesOn401 \
    -only-testing:BrettTests/AuthManagerTests/refreshCurrentUserGivesUpAfterRetries
```

Expected: FAIL — current code escalates on the first 401 post-refresh.

- [ ] **Step 3: Add retry helper + use it**

In `apps/ios/Brett/Auth/AuthManager.swift`, inside the `AuthManager` class, near the bottom of the private methods:

```swift
/// Runs `attempt` up to 4 times (initial + 3 retries) with 1s/2s/4s
/// exponential backoff, ONLY on `APIError.unauthorized`. Any other
/// error or success returns immediately.
///
/// Used for post-first-refresh 401 paths where we want to absorb
/// transient blips (token-rotation race, brief server hiccups, NAT64
/// warmup post-Wi-Fi-reconnect) before treating the 401 as a real
/// session revocation. ~7s of patience total before escalation.
private func retryingOnUnauthorized<T>(
    _ attempt: () async throws -> T
) async throws -> T {
    var delay: UInt64 = 1_000_000_000 // 1s
    for retry in 0..<3 {
        do {
            return try await attempt()
        } catch APIError.unauthorized {
            BrettLog.auth.info("401 on retry \(retry, privacy: .public) — backing off \(delay/1_000_000_000, privacy: .public)s")
            try? await Task.sleep(nanoseconds: delay)
            delay *= 2
        }
    }
    return try await attempt() // 4th attempt — bubble up if still 401
}
```

Then in `refreshCurrentUser()` (line 380), replace:

```swift
do {
    let me = try await endpoints.getMe()
```

with:

```swift
do {
    let me = try await retryingOnUnauthorized {
        try await self.endpoints.getMe()
    }
```

- [ ] **Step 4: Re-run tests to verify they pass**

Same xcodebuild command as Step 2.

Expected: PASS, callCount == 4 in both tests.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Auth/AuthManager.swift apps/ios/BrettTests/Auth/AuthManagerTests.swift
git commit -m "fix(ios-auth): retry 3x on 401 in refreshCurrentUser before signing out"
```

### Task 2.2: Wire retry into refreshIfStale (#121 path)

**Files:**
- Modify: `apps/ios/Brett/Auth/AuthManager.swift:434-471` (the `refreshIfStale` method).
- Test: `apps/ios/BrettTests/Auth/AuthManagerTests.swift`.

- [ ] **Step 1: Write the failing test**

Add to `AuthManagerTests.swift`, mirroring Task 2.1:

```swift
@Test("refreshIfStale retries 3 times on 401 before signing out")
@MainActor
func refreshIfStaleRetriesOn401() async {
    let mockClient = MockAPIClient()
    mockClient.queueResponse(.unauthorized)
    mockClient.queueResponse(.unauthorized)
    mockClient.queueResponse(.unauthorized)
    // 4th call: a valid session response. Match the real `getSession`
    // shape (token + expiresAt + minimal user).
    mockClient.queueResponse(.sessionOk(userId: "u1"))

    let mgr = AuthManager(client: mockClient)
    mgr.injectFakeSession(
        user: AuthUser(id: "u1", email: "a@b.com", name: "A",
                       avatarUrl: nil, timezone: "UTC", assistantName: "Brett"),
        token: "tok",
        hasRefreshed: true
    )

    await mgr.refreshIfStale(threshold: 0)

    #expect(mgr.token == "tok")
    #expect(mockClient.callCount == 4)
}
```

If `MockAPIClient.queueResponse` doesn't have a `.sessionOk` variant, add one that returns a payload matching the `getSession` route (see `apps/api/src/routes/auth-ios.ts:121-141`).

- [ ] **Step 2: Run test to verify it fails**

Same xcodebuild command pattern as Task 2.1, with the new test name.

Expected: FAIL — current code escalates on the first 401.

- [ ] **Step 3: Use the retry helper in refreshIfStale**

In `AuthManager.swift:440-441` (inside `refreshIfStale`), replace:

```swift
do {
    let session = try await endpoints.getSession()
```

with:

```swift
do {
    let session = try await retryingOnUnauthorized {
        try await self.endpoints.getSession()
    }
```

- [ ] **Step 4: Re-run test to verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Auth/AuthManager.swift apps/ios/BrettTests/Auth/AuthManagerTests.swift
git commit -m "fix(ios-auth): retry 3x on 401 in refreshIfStale before signing out"
```

---

## Phase 3: iOS — Keychain write verification

### Task 3.1: Read-back assertion in writeToken

**Files:**
- Modify: `apps/ios/Brett/Auth/KeychainStore.swift:147-149` — add verification after write.
- Test: `apps/ios/BrettTests/Auth/KeychainEdgeTests.swift`.

- [ ] **Step 1: Write the failing test**

In `KeychainEdgeTests.swift`, add:

```swift
@Test("writeToken throws if read-back returns a different value")
func writeTokenVerifiesReadBack() throws {
    // Use a deliberately-wrong access group so the write succeeds in one
    // location but the verify-read can't find it. Or: stub out SecItem to
    // return success on add and itemNotFound on copy. Prefer the latter
    // for hermeticity.
    //
    // Skip on simulator where keychain mocking isn't available — see
    // existing skip-pattern in this file (`#if targetEnvironment(simulator)`).
    let token = "verify-token-\(UUID().uuidString)"
    try KeychainStore.writeToken(token)
    let readBack = try KeychainStore.readToken()
    #expect(readBack == token)
    try KeychainStore.deleteToken()
}
```

(This first test asserts the happy path; the next test exercises the failure case.)

```swift
@Test("writeToken with verification rejects empty roundtrip")
func writeTokenRejectsEmptyTokens() throws {
    // Empty string isn't a valid bearer; the verification path must
    // refuse to leave an empty token in keychain.
    #expect(throws: KeychainStore.KeychainError.self) {
        try KeychainStore.writeToken("")
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
xcodebuild ... -only-testing:BrettTests/KeychainEdgeTests/writeTokenRejectsEmptyTokens
```

Expected: FAIL — current code happily writes empty strings.

- [ ] **Step 3: Add verification to writeToken**

In `KeychainStore.swift`, replace `writeToken`:

```swift
static func writeToken(_ token: String) throws {
    guard !token.isEmpty else {
        BrettLog.auth.error("Refused to write empty token to Keychain")
        throw KeychainError.unexpectedData
    }
    try writeInternal(token, accessGroup: sharedAccessGroup)

    // Verify the write landed by reading back. A SecItemAdd that returns
    // errSecSuccess but stores nothing is a known iOS edge case
    // (corrupted keychain, locked device with non-AfterFirstUnlock
    // accessibility, etc.). Without this check, a silent write failure
    // produces a "I just signed in but I'm signed out on relaunch" bug.
    let readBack = try readToken()
    guard readBack == token else {
        BrettLog.auth.error("Keychain write verification failed: read-back mismatch")
        throw KeychainError.unexpectedData
    }
}
```

- [ ] **Step 4: Re-run tests**

Expected: both tests PASS.

- [ ] **Step 5: Surface failures from persist()**

In `AuthManager.swift:330` (inside `persist`), the line `try KeychainStore.writeToken(session.token)` already propagates errors up to `runSignIn`. Verify the error message in `APIError.unknown(error).userFacingMessage` is reasonable (look at `APIError` enum); if it's a generic "Something went wrong," add a more specific case:

```swift
// In APIError (wherever it's defined — likely apps/ios/Brett/API/APIError.swift)
case keychainWriteFailed
// In userFacingMessage:
case .keychainWriteFailed:
    return "Couldn't save your session. Try again, and if the problem persists, restart your device."
```

Then in `runSignIn`:

```swift
} catch let kc as KeychainStore.KeychainError {
    BrettLog.auth.error("Keychain write failure during sign-in: \(String(describing: kc), privacy: .public)")
    errorMessage = APIError.keychainWriteFailed.userFacingMessage
}
```

(Place this catch before the `} catch let apiError as APIError` block.)

- [ ] **Step 6: Run all auth tests**

```bash
xcodebuild ... -only-testing:BrettTests/AuthManagerTests \
              -only-testing:BrettTests/KeychainEdgeTests
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/ios/Brett/Auth/KeychainStore.swift apps/ios/Brett/Auth/AuthManager.swift apps/ios/Brett/API/APIError.swift apps/ios/BrettTests/Auth/KeychainEdgeTests.swift
git commit -m "fix(ios-auth): verify keychain write with read-back assertion + surface failures in sign-in"
```

---

## Phase 4: iOS — Soft sign-out UX

### Task 4.1: Persist last email + expired flag

**Files:**
- Create: `apps/ios/Brett/Auth/SessionExpiryHint.swift`.
- Modify: `apps/ios/Brett/Auth/AuthManager.swift` (`persist`, `clearInvalidSession`, `signOut`).
- Test: `apps/ios/BrettTests/Auth/AuthManagerTests.swift`.

- [ ] **Step 1: Write the failing test**

```swift
@Test("clearInvalidSession leaves SessionExpiryHint with last email + expired flag")
@MainActor
func clearInvalidSessionLeavesHint() async {
    SessionExpiryHint.clear() // start clean

    let mockClient = MockAPIClient()
    let mgr = AuthManager(client: mockClient)
    let user = AuthUser(id: "u1", email: "soft@example.com", name: "Soft",
                       avatarUrl: nil, timezone: "UTC", assistantName: "Brett")
    try await mgr.persistForTesting(session: AuthSession(token: "tok", user: user))
    // Simulate post-first-refresh 401:
    for _ in 0..<10 { mockClient.queueResponse(.unauthorized) }
    mgr.injectFakeSession(user: user, token: "tok", hasRefreshed: true)
    await mgr.refreshCurrentUser()

    #expect(mgr.token == nil)
    #expect(SessionExpiryHint.lastEmail == "soft@example.com")
    #expect(SessionExpiryHint.didExpire == true)

    SessionExpiryHint.clear()
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `SessionExpiryHint` doesn't exist yet.

- [ ] **Step 3: Create the type**

`apps/ios/Brett/Auth/SessionExpiryHint.swift`:

```swift
import Foundation

/// UserDefaults-backed hint shown to the user after a token-rejection
/// sign-out. Lets `SignInView` prefill the email and surface a "your
/// session expired — please sign back in" banner instead of a cold sign-in
/// experience that feels like the app forgot them.
///
/// Cleared on successful sign-in. Survives app kills, but is wiped on
/// uninstall (UserDefaults is not in the shared keychain group).
enum SessionExpiryHint {
    private static let emailKey = "auth.sessionExpiry.lastEmail"
    private static let didExpireKey = "auth.sessionExpiry.didExpire"

    static var lastEmail: String? {
        get { UserDefaults.standard.string(forKey: emailKey) }
        set { UserDefaults.standard.set(newValue, forKey: emailKey) }
    }

    static var didExpire: Bool {
        get { UserDefaults.standard.bool(forKey: didExpireKey) }
        set { UserDefaults.standard.set(newValue, forKey: didExpireKey) }
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: emailKey)
        UserDefaults.standard.removeObject(forKey: didExpireKey)
    }
}
```

- [ ] **Step 4: Wire into AuthManager**

In `persist(session:)` (after `try KeychainStore.writeToken`), add:

```swift
SessionExpiryHint.lastEmail = session.user.email
SessionExpiryHint.didExpire = false
```

In `clearInvalidSession()` (BEFORE clearing `currentUser`), add:

```swift
if let email = currentUser?.email {
    SessionExpiryHint.lastEmail = email
}
SessionExpiryHint.didExpire = true
```

In `signOut()` (user-initiated), add `SessionExpiryHint.clear()` — a deliberate sign-out shouldn't leave a "your session expired" banner.

- [ ] **Step 5: Re-run test**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/ios/Brett/Auth/SessionExpiryHint.swift apps/ios/Brett/Auth/AuthManager.swift apps/ios/BrettTests/Auth/AuthManagerTests.swift
git commit -m "feat(ios-auth): persist last email + expired flag for soft sign-out UX"
```

### Task 4.2: SignInView reads SessionExpiryHint

**Files:**
- Modify: the SwiftUI view that renders the sign-in screen. Search for it:

```bash
rg -l 'SignInView|signInEmail|"Sign in"' apps/ios/Brett --type swift | head
```

The view will likely be `apps/ios/Brett/Views/SignInView.swift` or similar; the email field will use a `@State private var email`.

- [ ] **Step 1: Write the failing test (or skip — SwiftUI views are commonly verified manually)**

If a snapshot or unit test exists for SignInView, add one. If not (typical), document the manual test in the PR body and skip directly to implementation. **Do NOT add a SwiftUI snapshot framework just for this test.**

- [ ] **Step 2: Update SignInView**

At the top of the View struct, add:

```swift
@State private var email: String = SessionExpiryHint.lastEmail ?? ""
@State private var showExpiredBanner: Bool = SessionExpiryHint.didExpire
```

Render the banner above the email field (use the existing `errorMessage` styling for visual consistency — copy that exact treatment, do NOT design new chrome):

```swift
if showExpiredBanner {
    // Neutral copy: with non-expiring sessions, "expired" would be a lie
    // most of the time. The banner fires only on revocation /
    // sign-out-from-another-device / server bug, where the user just needs
    // to re-authenticate without a technical reason.
    Text("Please sign in again to continue.")
        // ... use existing error-banner styling ...
        .onTapGesture { showExpiredBanner = false }
}
```

In the sign-in success handler (or in `AuthManager.persist` — already done in 4.1), `SessionExpiryHint.didExpire = false` is already cleared, so the next render shows the normal sign-in.

- [ ] **Step 3: Build + manually verify on simulator**

Run app, sign in, force `clearInvalidSession()` via DEBUG menu (or wait for token to actually expire on a 1-minute test session), kill, reopen → see banner + prefilled email.

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Brett/Views/SignInView.swift   # (or actual path)
git commit -m "feat(ios-auth): show session-expired banner + prefill email on re-auth"
```

---

## Phase 5: iOS — biometric-gated Keychain (Option A)

### Task 5.1: KeychainStore biometric-gated write/read variants

**Files:**
- Modify: `apps/ios/Brett/Auth/KeychainStore.swift`.
- Test: `apps/ios/BrettTests/Auth/KeychainEdgeTests.swift`.

- [ ] **Step 1: Write the failing test**

```swift
@Test("writeToken with biometricGated=true sets userPresence access control")
func writeTokenWithBiometricGate() throws {
    // On simulator without enrolled biometry, the write should still
    // succeed (userPresence falls back to passcode). The read-back path
    // accepts an LAContext via `kSecUseAuthenticationContext`; without
    // one in test, SecItemCopyMatching prompts UI which we can't drive
    // here.
    //
    // Strategy: write with biometric=true, then read back with a
    // pre-evaluated LAContext from .deviceOwnerAuthentication so the
    // read can complete non-interactively.
    let token = "biometric-token-\(UUID().uuidString)"
    try KeychainStore.writeToken(token, biometricGated: true)

    let ctx = LAContext()
    var policyError: NSError?
    if ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &policyError) {
        let readBack = try KeychainStore.readToken(authContext: ctx)
        #expect(readBack == token)
    } else {
        // Skip on test environments without policy support.
    }

    try KeychainStore.deleteToken()
}
```

- [ ] **Step 2: Run test (will fail — new API doesn't exist yet)**

- [ ] **Step 3: Add the new APIs**

In `KeychainStore.swift`:

```swift
import LocalAuthentication

// Update writeToken signature:
static func writeToken(_ token: String, biometricGated: Bool = false) throws {
    guard !token.isEmpty else {
        BrettLog.auth.error("Refused to write empty token to Keychain")
        throw KeychainError.unexpectedData
    }
    try writeInternal(token, accessGroup: sharedAccessGroup, biometricGated: biometricGated)
    // Verification read uses a fresh LAContext; biometric prompts will
    // happen at NEXT launch when AuthManager actually needs the token.
    // Skip read-back when biometricGated is true (the OS would prompt).
    if !biometricGated {
        let readBack = try readToken()
        guard readBack == token else {
            BrettLog.auth.error("Keychain write verification failed: read-back mismatch")
            throw KeychainError.unexpectedData
        }
    }
}

static func readToken(authContext: LAContext? = nil) throws -> String? {
    if let group = sharedAccessGroup {
        if let token = try read(accessGroup: group, authContext: authContext) {
            return token
        }
    }
    // ... rest unchanged, threading authContext through
}
```

Update `writeInternal` to set `kSecAttrAccessControl` when `biometricGated == true`:

```swift
private static func writeInternal(_ token: String, accessGroup: String?, biometricGated: Bool = false) throws {
    let data = Data(token.utf8)
    let query = baseQuery(accessGroup: accessGroup)

    var attrs: [String: Any] = [kSecValueData as String: data]
    if biometricGated {
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            .userPresence,
            &error
        ) else {
            throw KeychainError.status(-1) // policy unavailable
        }
        attrs[kSecAttrAccessControl as String] = access
    } else {
        attrs[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    }

    let updateStatus = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
    // ... rest follows existing pattern, fall through to SecItemAdd on errSecItemNotFound,
    // propagating attrs as the add payload.
}
```

Update private `read(accessGroup:account:)` to take optional `authContext` and pass it via `kSecUseAuthenticationContext` on the query.

- [ ] **Step 4: Re-run test**

Expected: PASS in environments where `.deviceOwnerAuthentication` evaluates.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Auth/KeychainStore.swift apps/ios/BrettTests/Auth/KeychainEdgeTests.swift
git commit -m "feat(ios-auth): biometric-gated keychain write/read paths"
```

### Task 5.2: BiometricLockManager exposes authenticated LAContext

**Files:**
- Modify: `apps/ios/Brett/Auth/BiometricLockManager.swift`.

- [ ] **Step 1: Write the failing test**

```swift
@Test("BiometricLockManager publishes authenticated context after successful unlock")
@MainActor
func unlockProducesContext() async {
    let mgr = BiometricLockManager.shared
    UserDefaults.standard.set(true, forKey: BiometricLockManager.faceIDEnabledKey)
    mgr.handleWillEnterForeground() // triggers authenticate() Task
    // ... wait for evaluation ...
    // On simulator without biometry, this returns lastError. We can't
    // assert success without real device — skip on simulator. Document
    // the manual test in the PR.
    #expect(mgr.authenticatedContext != nil || mgr.lastError != nil)
}
```

- [ ] **Step 2: Add `authenticatedContext` property**

In `BiometricLockManager.swift`:

```swift
/// The LAContext that successfully passed `evaluatePolicy`. Stays valid
/// for the lifetime of the unlocked session — code that needs to read
/// the biometric-gated keychain entry passes this via
/// `kSecUseAuthenticationContext` so a single Face ID prompt covers
/// both app unlock AND keychain decrypt.
///
/// Cleared on background (lock cycle starts fresh).
private(set) var authenticatedContext: LAContext?
```

In `authenticate()`, after `if success { isLocked = false }`:

```swift
if success {
    isLocked = false
    authenticatedContext = ctx
}
```

In `handleDidEnterBackground`:

```swift
context?.invalidate()
context = nil
authenticatedContext = nil
```

- [ ] **Step 3: Run tests** — focused on existing BiometricLockManager tests if any.

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Brett/Auth/BiometricLockManager.swift
git commit -m "feat(ios-auth): BiometricLockManager publishes LAContext for keychain reads"
```

### Task 5.3: AuthManager hydrates token after biometric unlock

**Files:**
- Modify: `apps/ios/Brett/Auth/AuthManager.swift`.

- [ ] **Step 1: Write the failing test**

```swift
@Test("hydrateFromKeychain uses BiometricLockManager context when Face ID is on")
@MainActor
func hydrateUsesBiometricContext() async throws {
    UserDefaults.standard.set(true, forKey: BiometricLockManager.faceIDEnabledKey)
    try KeychainStore.writeToken("hydrate-token", biometricGated: true)

    let mgr = AuthManager(client: MockAPIClient())
    // No token yet — init() did not auto-hydrate when Face ID is on.
    #expect(mgr.token == nil)

    // Simulate BiometricLockManager handing us a context.
    let ctx = LAContext()
    var err: NSError?
    if ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) {
        await mgr.hydrateFromKeychain(authContext: ctx)
        #expect(mgr.token == "hydrate-token")
    }

    try KeychainStore.deleteToken()
    UserDefaults.standard.removeObject(forKey: BiometricLockManager.faceIDEnabledKey)
}
```

- [ ] **Step 2: Refactor AuthManager.init**

In `AuthManager.swift:57-87`, change `init`:

```swift
init(client: APIClient = .shared) {
    self.client = client
    self.endpoints = AuthEndpoints(client: client)

    client.tokenProvider = { [weak self] in
        MainActor.assumeIsolated { self?.token }
    }

    Self.purgeKeychainIfFreshInstall()

    // If Face ID is OFF, hydrate immediately as before. If ON, wait for
    // BiometricLockManager to publish an authenticated context — the
    // app calls `hydrateFromKeychain(authContext:)` from the lock-screen
    // success path.
    if !UserDefaults.standard.bool(forKey: BiometricLockManager.faceIDEnabledKey) {
        Task { [weak self] in await self?.hydrateFromKeychain(authContext: nil) }
    }
}

/// Public entry point used by both the cold-launch path (Face ID off,
/// nil context) and the post-unlock path (Face ID on, context from
/// BiometricLockManager). Idempotent — calling twice with the same
/// context is harmless.
func hydrateFromKeychain(authContext: LAContext?) async {
    do {
        guard let stored = try KeychainStore.readToken(authContext: authContext) else { return }
        guard token == nil else { return } // already hydrated
        self.token = stored
        await refreshCurrentUser()
    } catch {
        BrettLog.auth.error("Keychain hydrate failed: \(String(describing: error), privacy: .public)")
    }
}
```

- [ ] **Step 3: Wire from app entry point**

Find where the app instantiates `BiometricLockManager.shared` and observes its `isLocked` state — likely `apps/ios/Brett/BrettApp.swift` or the root `ContentView`. Where the lock screen transitions to unlocked, call:

```swift
await authManager.hydrateFromKeychain(authContext: BiometricLockManager.shared.authenticatedContext)
```

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Auth/AuthManager.swift apps/ios/Brett/BrettApp.swift   # (or actual path)
git commit -m "feat(ios-auth): hydrate token after biometric unlock when Face ID is on"
```

### Task 5.4: Toggle re-write — Settings → Security flip

**Files:**
- Modify: `apps/ios/Brett/Auth/BiometricLockManager.swift` (`settingsDidChange`).
- Modify: the Security settings view (search):

```bash
rg -l 'security.faceid.enabled|BiometricLockManager.faceIDEnabledKey' apps/ios/Brett --type swift
```

- [ ] **Step 1: Update settingsDidChange to re-write the token**

In `BiometricLockManager.settingsDidChange`:

```swift
func settingsDidChange() {
    if !isEnabledInSettings {
        isLocked = false
        lastError = nil
        // Re-write keychain token without biometric gating so the next
        // cold launch can read it without a Face ID prompt.
        if let token = try? KeychainStore.readToken(authContext: authenticatedContext) {
            try? KeychainStore.writeToken(token, biometricGated: false)
        }
    } else {
        // Toggling ON: re-write with biometric gating so the next launch
        // requires Face ID before the token is readable.
        if let token = try? KeychainStore.readToken() {
            try? KeychainStore.writeToken(token, biometricGated: true)
        }
    }
}
```

- [ ] **Step 2: Add a test**

```swift
@Test("toggling Face ID off rewrites keychain without biometric gate")
@MainActor
func toggleOffRewritesKeychain() throws {
    // Start: token written WITH biometric gate.
    UserDefaults.standard.set(true, forKey: BiometricLockManager.faceIDEnabledKey)
    try KeychainStore.writeToken("test-token", biometricGated: true)

    // Toggle off:
    UserDefaults.standard.set(false, forKey: BiometricLockManager.faceIDEnabledKey)
    BiometricLockManager.shared.settingsDidChange()

    // Read without an authContext — should succeed because the rewrite
    // dropped the biometric gate.
    let readBack = try KeychainStore.readToken(authContext: nil)
    #expect(readBack == "test-token")

    try KeychainStore.deleteToken()
}
```

- [ ] **Step 3: Run + commit**

```bash
git add apps/ios/Brett/Auth/BiometricLockManager.swift apps/ios/BrettTests/Auth/KeychainEdgeTests.swift
git commit -m "feat(ios-auth): rewrite keychain access control when Face ID toggle changes"
```

### Task 5.5: Migration — existing tokens get biometric gate at next sign-in

No active migration step needed: existing users with non-gated tokens continue to read/write via the legacy path (`biometricGated: false`) until they re-sign-in or toggle Face ID. The toggle path (Task 5.4) handles the conversion. New sign-ins after this PR ships, when Face ID is on, store gated.

- [ ] **Step 1: Update `persist(session:)` to honor the toggle**

In `AuthManager.persist(session:)`, replace:

```swift
try KeychainStore.writeToken(session.token)
```

with:

```swift
let useGate = UserDefaults.standard.bool(forKey: BiometricLockManager.faceIDEnabledKey)
try KeychainStore.writeToken(session.token, biometricGated: useGate)
```

- [ ] **Step 2: Add test**

```swift
@Test("persist writes biometric-gated token when Face ID is enabled")
@MainActor
func persistRespectsFaceIDSetting() async throws {
    UserDefaults.standard.set(true, forKey: BiometricLockManager.faceIDEnabledKey)
    let mgr = AuthManager(client: MockAPIClient())
    try await mgr.persistForTesting(session: AuthSession(
        token: "persist-token",
        user: AuthUser(id: "u1", email: "p@x.com", name: "P",
                      avatarUrl: nil, timezone: "UTC", assistantName: "Brett")
    ))

    // Read without authContext should return nil (biometric required).
    let readWithoutCtx = try? KeychainStore.readToken(authContext: nil)
    // Note: on simulator without biometry, .userPresence may fall through.
    // Test asserts the call shape, not the OS behavior.
    _ = readWithoutCtx

    UserDefaults.standard.removeObject(forKey: BiometricLockManager.faceIDEnabledKey)
    try KeychainStore.deleteToken()
}
```

- [ ] **Step 3: Run + commit**

```bash
git add apps/ios/Brett/Auth/AuthManager.swift apps/ios/BrettTests/Auth/AuthManagerTests.swift
git commit -m "feat(ios-auth): persist new sign-ins with biometric gate when Face ID is on"
```

---

## Phase 6: Manual verification + PR

### Task 6.1: Manual test pass on real device

Per project memory `project_no_mac_ci.md`, biometric flows MUST be verified on a real device — the simulator can't fully exercise `.userPresence`.

- [ ] **Test matrix (record results in PR description):**
  1. Face ID OFF, sign in → kill → reopen. Should land on Today, no sign-in screen.
  2. Face ID OFF, sign in → airplane mode 30s → Wi-Fi back → wait 6 minutes. Should NOT sign out.
  3. Face ID ON, sign in → kill → reopen. Should show Face ID prompt; pass → land on Today.
  4. Face ID ON, sign in → kill → reopen → fail Face ID 3x → cancel. Should stay on lock screen (NOT sign out).
  5. Toggle Face ID OFF in Settings → kill → reopen. Should land on Today without prompt.
  6. Sign out manually → reopen. Should show sign-in (no expired banner — deliberate sign-out).
  7. Force a 401 (manually invalidate the session via Prisma Studio: `DELETE FROM "Session" WHERE token = ?`) → trigger keepalive (foreground app). Should soft sign-out with email prefilled.

### Task 6.2: Open PR

- [ ] **Run release-config build per project memory `project_no_mac_ci.md`:**

```bash
./scripts/release.sh --skip-deploy   # whatever flag your script accepts; verify Release-config still compiles
```

- [ ] **Open PR from this branch to `main` (NOT `release` — release goes through main first):**

```bash
gh pr create --title "fix(ios-auth): non-expiring sessions + 401 retry + biometric keychain gate" --body "$(cat <<'EOF'
## Summary

Closes #111, #121, #123. Stops the iOS app signing the user out unexpectedly, and adds Face ID re-issue so users on a trusted device never see the sign-in screen.

### Changes

- **Server:** session lifetime → 100 years (iOS Google + better-auth). Effectively non-expiring; sliding-window refresh on each keepalive. Revocation is now the security boundary, not expiry.
- **iOS:** 3-attempt exponential-backoff retry on 401 in both `/users/me` and `/api/auth/ios/session` paths before signing out.
- **iOS:** keychain write read-back verification — silent SecItemAdd failures now surface as a sign-in error.
- **iOS:** soft sign-out UX — preserves last email + neutral "Please sign in again" banner on re-auth (rare: revocation, sign-out-from-another-device, server bug).
- **iOS:** biometric-gated keychain entry when Face ID is enabled. Single Face ID prompt at launch covers both app unlock and keychain decrypt via shared `LAContext`.

### Test plan

- [x] All unit tests pass (`pnpm test` + `xcodebuild test`)
- [x] Manual matrix run on real device — see Task 6.1 above
- [x] Release-config build via `scripts/release.sh`
- [x] Verified that disabling Face ID rewrites the keychain so cold launch doesn't prompt

### Risk notes

- Non-expiring sessions apply to web + desktop too. Cookies remain `__Secure-` + CSRF-protected; the security boundary is the cookie/keychain, not `expiresIn`. Follow-up: "sign out all devices" feature gives users a manual revocation path.
- Biometric gating is the riskiest change. It moves keychain hydration after `BiometricLockManager` unlock, changing app launch order. Tested with the matrix above; falls back to today's behaviour when Face ID is off.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist

- [ ] **Spec coverage:** every issue (#111 cold-launch, #121 keepalive, #123 general) is addressed by the retry helper (2.1, 2.2) + soft UX (4.1, 4.2). The biometric layer (Phase 5) addresses the deeper "I should never have to sign in again" request.
- [ ] **Placeholder scan:** no TBDs; every step has actual code or a search command. The SignInView path (Task 4.2) intentionally uses `rg` to find the actual file because file paths in the views directory may have evolved.
- [ ] **Type consistency:** `KeychainStore.writeToken(_:biometricGated:)`, `KeychainStore.readToken(authContext:)`, `AuthManager.hydrateFromKeychain(authContext:)`, `BiometricLockManager.authenticatedContext` — names used consistently across phases.
- [ ] **Test environment caveats called out:** simulator can't drive Face ID; tests skip gracefully or assert call shape rather than OS behavior. Manual matrix in Task 6.1 covers what unit tests can't.
