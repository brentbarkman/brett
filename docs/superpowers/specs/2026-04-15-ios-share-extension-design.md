# iOS Share Extension Design

## Overview

An iOS share extension that lets users capture URLs and text from any app (Safari, Messages, Mail, Notes, etc.) directly into Brett's Inbox. No UI in the share sheet — tap Brett, the share sheet dismisses, the item lands in Inbox. Mirrors the desktop's URL classification pipeline: URLs become `type: content` with auto-detected `contentType` (tweet/video/article/podcast/pdf/web_page); text becomes `type: task`.

Target: ship alongside the next TestFlight. Small target, no server changes.

## Product decisions (from brainstorm)

| Decision | Value |
|---|---|
| UX pattern | Silent save — no custom UI in share sheet, dismisses instantly |
| Content types accepted | URLs + plain text only (no images / files / PDFs in v1) |
| URL handling | Mirrors desktop: server-side `detectContentType` auto-classifies, content extraction runs asynchronously |
| Text handling | Always becomes `type: task` with `status: active`, no SmartParser |
| Destination | Always Inbox (`listId: nil`), `source: "ios_share"` |
| Push flow | Hybrid: write to App Group queue first (durable), attempt POST, main app reconciles leftovers on foreground |

## Architecture

### New Xcode target: `BrettShareExtension`

- Type: `app-extension` with extension point `com.apple.share-services`
- Bundle ID: `com.brett.app.ShareExtension` (sibling of main app `com.brett.app`)
- Declared in [apps/ios/project.yml](apps/ios/project.yml); regenerated via `xcodegen`
- Deployment target: iOS 18.0 (matches main app)
- Swift 6.0, minimal strict concurrency (matches main app)
- Dependencies: **none beyond Foundation + UIKit + Security + MobileCoreServices/UniformTypeIdentifiers** — no SwiftData, no GoogleSignIn, no shared packages. Extension memory cap is real (120MB on older devices).

### Two shared entitlements (main app + extension)

1. **App Group**: `group.com.brett.app`
   - Used for: queue directory + shared `UserDefaults` for API URL + any future cross-process IPC
   - Requires registration in Apple Developer portal when shipping (flagged below)
2. **Keychain access group**: `$(AppIdentifierPrefix)com.brett.app.auth`
   - Uses the Apple Team ID prefix so it's team-scoped (not app-id scoped)
   - Main app's `KeychainStore` already uses service `com.brett.app.auth` — we keep the service name, just add the access group

### Activation rule

Extension's `Info.plist`:
```xml
<key>NSExtension</key>
<dict>
  <key>NSExtensionAttributes</key>
  <dict>
    <key>NSExtensionActivationRule</key>
    <dict>
      <key>NSExtensionActivationSupportsWebURLWithMaxCount</key><integer>1</integer>
      <key>NSExtensionActivationSupportsText</key><true/>
    </dict>
  </dict>
  <key>NSExtensionPointIdentifier</key>
  <string>com.apple.share-services</string>
  <key>NSExtensionPrincipalClass</key>
  <string>$(PRODUCT_MODULE_NAME).ShareViewController</string>
</dict>
```

Extension only appears in the share sheet when a URL or text is being shared. Not when sharing images, files, PDFs, etc.

### No-UI controller

`ShareViewController` is a `UIViewController` subclass (not `SLComposeServiceViewController` — that shows a compose form we don't want). It:

1. Loads, runs processing in `viewDidLoad`
2. Calls `extensionContext.completeRequest(returningItems:completionHandler:)` when done
3. Never renders any visible view

The share sheet dismisses as soon as `completeRequest` fires. The only perceptible feedback is a brief checkmark from iOS itself.

## Data flow

### At share time (in extension process)

```
User taps Brett in share sheet
  ↓
ShareViewController.viewDidLoad
  ↓
extensionContext.inputItems → [NSExtensionItem]
for each item → item.attachments → [NSItemProvider]
  ↓
Pick providers in priority:
  1. public.url (Safari links, Messages shared URLs)
  2. public.plain-text (Notes selection, Mail body selection)
Both present? URL wins; text becomes the `notes` field.
  ↓
Validate URL with URLComponents: scheme ∈ { "http", "https" }, host non-empty.
  ↓
Build SharePayload {
  id: UUID().uuidString         // becomes the Item.id
  idempotencyKey: UUID().uuidString  // per /sync/push contract
  type: url != nil ? "content" : "task"
  title: url?.absoluteString ?? text.truncate(500)
  sourceUrl: url?.absoluteString
  notes: url != nil ? text : nil
  source: "ios_share"
  createdAt: Date()
}
  ↓
Write JSON to App Group:
  group.com.brett.app/ShareQueue/{id}.pending.json
  (atomic write via Data.write(to:, options: [.atomic, .completeFileProtection]))
  ↓
Call extensionContext.completeRequest(returningItems: [], completionHandler: nil)
  ↓  (share sheet dismisses — remaining work is best-effort in the grace period)
  ↓
Read token from shared keychain
  ↓
If token present:
  Build /sync/push mutation envelope:
  {
    protocolVersion: 1,
    mutations: [{
      idempotencyKey: payload.idempotencyKey,
      entityType: "item",
      entityId: payload.id,
      action: "CREATE",
      payload: { type, title, source, sourceUrl, notes, status: "active", listId: null }
    }]
  }
  ↓
  POST <baseURL>/sync/push
    Authorization: Bearer <token>
    URLRequest.timeoutInterval = 3.0
    URLSessionConfiguration.default
  ↓
  On 2xx → rename file to {id}.posted.json
  On any failure → leave {id}.pending.json as-is
Else:
  Skip POST
```

**Why `/sync/push` instead of `POST /things`:** `/sync/push` accepts client-generated `entityId` and carries its own idempotency via `idempotencyKey`. `POST /things` auto-generates the id server-side, which means we couldn't correlate the extension's server-side Item back to the queue file when the main app reconciles. The `/sync/push` path is also what the offline-first mobile sync engine already uses — battle-tested, idempotent, same wire format as normal mutations.

**Why `completeRequest` before the POST finishes:** iOS kills the extension process soon after `completeRequest`, but grants a short grace period (usually 5-10s). Calling it first means the share sheet dismisses immediately; the POST is best-effort in the grace window. If it doesn't finish, main-app reconciliation catches the `.pending.json` file on next foreground — no UX degradation, just a slightly longer delay before multi-device visibility.

Extension wall-clock budget until `completeRequest`: **parse ≤500ms, write ≤50ms → ~600ms total**. After that the share sheet is already gone.

### At reconciliation time (main app)

`ShareIngestor` runs on every `scenePhase` transition to `.active`:

```
For each file in App Group/ShareQueue/ matching *.pending.json or *.posted.json:
  if file age < 2 seconds:
    skip — might still be racing the extension's POST/rename
    continue

  decode SharePayload
  if malformed:
    move to ShareQueue/failed/{name}
    log in DEBUG
    continue

  if Item with id == payload.id already exists in SwiftData:
    delete queue file (pull or previous reconciliation already handled it)
    continue

  Insert Item into SwiftData with:
    id          = payload.id
    userId      = current user's id
    type        = payload.type
    title       = payload.title
    status      = "active"
    source      = payload.source
    sourceUrl   = payload.sourceUrl
    notes       = payload.notes
    listId      = nil
    createdAt   = payload.createdAt
    updatedAt   = payload.createdAt

  If file is *.posted.json:
    _syncStatus = .synced
    _baseUpdatedAt = payload.createdAt ISO string
    (no mutation enqueued — extension already POSTed, server will echo on next pull)
  Else (*.pending.json):
    _syncStatus = .pendingCreate
    Enqueue mutation in MutationQueue with idempotencyKey = payload.idempotencyKey
    (REUSE the extension's key — if the extension's POST actually succeeded
     but died before renaming the file, the server recognizes the retry and
     returns the cached response, preventing duplicate items)

  delete queue file

Files older than 7 days that still exist → move to ShareQueue/failed/
```

The 2-second age filter prevents the main app from racing the extension's rename-on-success (.pending.json → .posted.json).

**Why `.posted.json` files still get reconciled rather than silently ignored:** if the extension POSTed successfully but the main app's next pull hasn't happened yet, reconciling from the file lets the Item appear in the UI *immediately* when the user opens Brett — without waiting for a sync round-trip. When the eventual pull arrives, the server's echo is an upsert on the same id, not a duplicate.

### Server-side

**Small, additive change** to `processCreate` in [apps/api/src/routes/sync.ts](apps/api/src/routes/sync.ts): when handling an `item` CREATE whose payload has `type: "content"` and a `sourceUrl`, auto-detect `contentType`, set `contentStatus: "pending"`, and trigger `runExtraction`. This makes `/sync/push` content-creates behavioraly equivalent to `POST /things` for content items.

```ts
// In processCreate, after building `data` and before model.create:
let shouldExtract = false;
if (
  mutation.entityType === "item" &&
  data.type === "content" &&
  typeof data.sourceUrl === "string"
) {
  data.contentType ??= detectContentType(data.sourceUrl);
  data.contentStatus = "pending";
  shouldExtract = true;
}

const record = await model.create({ data });

if (shouldExtract && record.sourceUrl) {
  runExtraction(record.id, record.sourceUrl, userId).catch((err) =>
    logger.error({ err, itemId: record.id }, "sync.push extraction failed")
  );
}
```

**Why this is the right fix (vs. client-side detection):** keeping a single source of truth for `detectContentType` prevents desktop/iOS drift when we add a new URL pattern. It also closes a latent gap for mobile offline-first creates, which have the same issue today — a user creating a content item while offline never gets extraction triggered. Both wins are worth the ~10 lines.

What `/sync/push` already handles correctly (no change needed):
- Accepts `entityType: "item"` mutations with client-generated `entityId`
- Stores idempotency keys — a duplicate mutation from the extension + main-app mutation queue is safe (returns the cached response)

## Key files

### New (extension target)

```
apps/ios/Brett-ShareExtension/
├── Info.plist                         # NSExtension config + activation rule
├── BrettShareExtension.entitlements   # App Group + keychain access group
├── ShareViewController.swift          # No-UI entry, ~40 lines
├── SharePayload.swift                 # Codable struct (also used by main app)
├── ShareService.swift                 # Parse providers → build payload → queue → POST
├── SharedKeychain.swift               # Minimal keychain read (service + account + access group)
└── SharedConfig.swift                 # App Group UserDefaults reader, API URL fallback
```

### New (main app)

- `apps/ios/Brett/Sync/ShareIngestor.swift` — reconciliation loop (~120 lines)
- `apps/ios/Brett/Brett.entitlements` — new file for App Group + keychain access group

### Modified (main app)

- [apps/ios/Brett/Auth/KeychainStore.swift](apps/ios/Brett/Auth/KeychainStore.swift) — add optional `accessGroup` parameter (defaults to the shared group), add one-time migration from legacy-no-group to shared-group
- [apps/ios/Brett/BrettApp.swift](apps/ios/Brett/BrettApp.swift) — call `ShareIngestor.shared.drain()` on scenePhase `.active`
- [apps/ios/Brett/Networking/APIClient.swift](apps/ios/Brett/Networking/APIClient.swift) — on init, write resolved `baseURL.absoluteString` to App Group UserDefaults so the extension reads the same URL (critical for dev where IP changes per network)
- [apps/ios/project.yml](apps/ios/project.yml) — new `BrettShareExtension` target, embed in main app, wire entitlements

## Edge cases

| Case | Behavior |
|---|---|
| User not signed in | Extension writes queue file, skips POST, dismisses silently. Main app drains on next sign-in. |
| Token expired (401) | Extension leaves queue file. Main app's `MutationQueue` hits the same 401 on next drain, which triggers normal sign-out/refresh UX. |
| Offline | Queue file written, POST throws `.notConnectedToInternet`, file preserved. Main app drains when online. |
| User shares same URL twice | Two separate UUIDs, two separate payloads, server creates two Items. Expected — user intent was to share twice. |
| Non-http URL (e.g., `javascript:`, `data:`, `file:`) | `SharePayload` builder rejects. Falls back to text if provider also has text, otherwise extension calls `completeRequest` without doing anything. |
| Huge text selection (>50KB) | Truncated to 500 chars for title; if paired with URL, truncated to 10KB for `notes`. |
| Extension killed mid-POST | Queue file remains (written first). Main app's reconciliation picks it up. Worst-case: slight duplicate risk if server accepted the POST but extension died before response — mitigated because we use stable client-generated UUIDs; server-side upsert on id prevents duplicates (this already works via the existing mutation queue's idempotency). |
| Queue file corruption | Decoder throws, file moved to `failed/` subdir, logged in DEBUG, no crash. |
| App Group / keychain missing (misconfigured entitlements) | Extension fails gracefully: keychain read returns nil → skip POST. Queue write fails → log and dismiss. Real symptom in dev: the developer sees no items landing — flagged via assert in DEBUG. |

## Security

### Threat model boundaries

- **Trusted**: main app, extension, shared keychain, App Group container. All signed with same team ID, share same entitlements.
- **Untrusted**: content shared by other apps (URLs, text). Treated as arbitrary input.
- **Out of scope**: jailbroken devices, physical device seizure with unlocked state, compromised Apple Team ID.

### Specific protections

1. **URL scheme allowlist** — `SharePayload` builder accepts only `http` / `https` URLs. `javascript:`, `data:`, `file:`, `mailto:` etc. are rejected at the boundary.
2. **Bearer token handling** — Token stays in Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, device-scoped, no iCloud sync). Extension reads at share time, uses once, does not persist to disk or log. No token material in queue files.
3. **Queue file names** — UUIDs only, no user-controlled strings. Prevents path traversal via shared content.
4. **File protection class** — `NSFileProtectionComplete` on queue files. If the user shares while device is unlocked, then locks the phone, the files are encrypted at rest and unreadable by any other process.
5. **Size caps** — text ≤500 chars for title, ≤10KB for notes, URL ≤2048 chars. Prevents a malicious or malfunctioning source app from bloating queue files.
6. **HTTPS only in production** — main app currently has `NSAllowsArbitraryLoads: true` for dev (LAN IPs). Extension's Info.plist sets `NSAllowsArbitraryLoads: true` **in DEBUG only** via an Info.plist preprocessed value; Release builds have no ATS exception.
7. **No third-party SDKs in extension** — not importing GoogleSignIn, Firebase, analytics, etc. Smaller attack surface + smaller binary.
8. **No logging of shared content in Release** — `os_log` calls gated on `#if DEBUG`. Shared URLs and text are user-private.

### What we're NOT doing (and why)

- **Certificate pinning** — not done in the main app today; adding it only in the extension creates an asymmetry. Out of scope for this spec.
- **Per-extension token scoping** — better-auth doesn't issue scoped tokens. The extension holds the same Bearer token as the main app. Mitigated by device-local keychain + access group scoping.
- **User confirmation** — by design ("silent save"). A malicious source app could technically shove content through, but the user affirmatively tapped Brett in the share sheet, which is an explicit grant of intent.

## Testing

### Unit tests (new — `apps/ios/BrettTests/` targeting main app; extension logic is pure and importable)

- `SharePayloadBuilderTests`:
  - URL-only input → `type = "content"`, `sourceUrl` set, `title` = URL
  - Text-only input → `type = "task"`, `sourceUrl = nil`, `title` = text
  - URL + text input → URL wins for type, `notes` = text
  - Non-http URL → rejected (nil payload)
  - Whitespace-only text → rejected
  - Title longer than 500 chars → truncated with ellipsis
  - Notes longer than 10KB → truncated
- `SharedKeychainTests`:
  - Read missing item → `nil`, no throw
  - Read with wrong access group → `nil`, no throw
- `ShareIngestorTests`:
  - Valid payload in temp queue dir → `Item` inserted with matching fields, file deleted
  - Payload with existing `id` → file deleted, no duplicate
  - Malformed JSON → file moved to `failed/`, no crash, no `Item` inserted
  - Empty queue dir → no-op, no throw
  - File younger than 2s → left alone (re-run still sees it)

### Manual UAT (before merging to `release`)

- [ ] Share URL from Safari (online, signed in) → item appears in Inbox with `contentType: article`/`video`/etc.
- [ ] Share selected text from Messages → item appears in Inbox as task with the text as title
- [ ] Share URL + text from Mail → content item with URL, text in notes
- [ ] Airplane mode → share URL → open Brett → item appears in Inbox after foreground
- [ ] Signed out → share → sign in → item appears
- [ ] Kill Brett from app switcher → share → relaunch → item appears
- [ ] Share same URL twice rapidly → two items
- [ ] Share from private Safari browsing → item still appears (URL is still http/https, just ephemeral in Safari)
- [ ] Share while Brett is in background (not killed) → foreground → item appears (drains on scenePhase .active)
- [ ] Share with a URL containing auth tokens (e.g., a password reset link) → item saves with the full URL (user consent is implicit — they tapped share)
- [ ] Cross-device: share from iOS → desktop shows the item after sync

## Deployment checklist

Before this can ship to TestFlight:

**Server (must deploy first, since client POSTs will reference this contract):**
- [ ] Merge the `processCreate` enrichment for item content creates
- [ ] Add regression test asserting `/sync/push` CREATE for `type: content` with `sourceUrl` sets `contentStatus: "pending"` and triggers `runExtraction`
- [ ] Deploy API to Railway (merge `main → release`), verify `/sync/push` is live

**Apple Developer portal:**
- [ ] Register App Group `group.com.brett.app`
- [ ] Enable App Groups capability for both bundle IDs (main + extension)
- [ ] Enable Keychain Sharing with group `com.brett.app.auth` for both bundle IDs
- [ ] Register new bundle ID `com.brett.app.ShareExtension` in App Store Connect
- [ ] Generate new provisioning profiles for both bundle IDs including the App Group and Keychain Sharing

**Xcode / project config:**
- [ ] Set `DEVELOPMENT_TEAM` in `project.yml` (currently `""`) — App Groups require a real team for on-device signing; they work in simulator without, but TestFlight/App Store deploys will fail without it
- [ ] Confirm entitlements files are referenced by the correct targets in `project.yml`
- [ ] Regenerate Xcode project with `xcodegen --spec apps/ios/project.yml`
- [ ] Verify Release config has no `NSAllowsArbitraryLoads` in the extension's Info.plist
- [ ] Build + sign both targets, verify extension is embedded in main app's `.app` bundle under `PlugIns/`

## Out of scope (future work)

- Image / file attachments from the share sheet (requires the attachment pipeline on iOS, which isn't built yet)
- Smart list picker in share sheet (silent save was the explicit choice)
- Shared credentials / multi-account (Brett is single-account)
- Background URLSession for reliable post-dismissal upload (our 3s timeout + main-app reconciliation is sufficient; the complexity isn't justified)
- Share extension for macOS (separate effort, probably piggybacks on Safari extension if we build one)
