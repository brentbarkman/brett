# iOS Credentials & Configuration

This document describes what must be configured **before TestFlight** for the Brett iOS app. The codebase ships with safe defaults for local dev, but every section below must be reviewed before a production build.

## 1. Sign in with Apple

Xcode capability, per-target:

1. Open `Brett.xcodeproj` (regenerate via `xcodegen` if needed).
2. Select the `Brett` target → **Signing & Capabilities** tab.
3. Click **+ Capability** → add **Sign In with Apple**.
4. Make sure the target's **Team** is set to your Apple Developer team.
5. Bundle ID must be `com.brett.app`. This must match an App ID in the Apple Developer portal that has the *Sign In with Apple* capability enabled.

The provider at `Brett/Auth/AppleSignInProvider.swift` requests `.fullName` and `.email` scopes and POSTs the identity token to `/api/auth/sign-in/social` with `provider: "apple"`.

## 2. Google OAuth (iOS client) — native GoogleSignIn-iOS SDK

The iOS app uses the native [GoogleSignIn-iOS SDK](https://github.com/google/GoogleSignIn-iOS) so users get the system Google account chooser (one-tap if Gmail/YouTube/Drive are signed in on the device). This requires a **dedicated iOS OAuth Client ID** — different from the web client used by desktop.

### 2a. Create the iOS OAuth Client

1. Visit <https://console.cloud.google.com/apis/credentials> — use the **same Google Cloud project** as your existing web client so both clients share the OAuth consent screen and emit identical `sub` values for a given user.
2. **Create Credentials → OAuth client ID → iOS**.
3. **Bundle ID:** `com.brett.app`.
4. Copy the **iOS client ID** (format: `123456789-abcdefg.apps.googleusercontent.com`).
5. Copy the **reversed client ID** (format: `com.googleusercontent.apps.123456789-abcdefg`).

### 2b. Configure the iOS app

In `Brett/Info.plist`:
- Set `GIDClientID` to the iOS client ID from step 4.
- Under `CFBundleURLTypes`, replace `com.googleusercontent.apps.REPLACE_WITH_REVERSED_IOS_CLIENT_ID` with the reversed client ID from step 5 (the scaffold has the slot pre-wired alongside the existing `brett` scheme).

`BrettApp.swift` forwards every inbound URL to `GIDSignIn.sharedInstance.handle(url)` via `.onOpenURL`, so the SDK's OAuth callback returns to the app correctly.

### 2c. Configure the API server

Set `GOOGLE_IOS_CLIENT_ID` in `apps/api/.env` (and in Railway env vars for prod) to the **same** iOS client ID from step 4. The server verifies incoming idTokens against this audience in [`apps/api/src/lib/ios-google-verifier.ts`](../api/src/lib/ios-google-verifier.ts). Without it, the iOS sign-in endpoint returns `503 ios_google_not_configured`.

### 2d. Flow recap

1. iOS app calls `GIDSignIn.sharedInstance.signIn(withPresenting:)`.
2. Native chooser returns a `GIDSignInResult` containing `user.idToken.tokenString`.
3. App POSTs `{ idToken }` to `/api/auth/ios/google/token`.
4. Server verifies the token against Google's public JWKS with audience = `GOOGLE_IOS_CLIENT_ID`, extracts `sub` + `email`, then upserts:
   - **existing** — Google account row already exists → reuse user.
   - **linked** — no Google row but a user exists with this email AND `email_verified=true` → link and reuse.
   - **created** — brand-new Brett user.
5. Server returns `{ token, user, outcome }`; app stores the bearer token in Keychain via `AuthManager`.

### 2e. User unification

Both the desktop web client and the iOS client live in the same Google Cloud project, so Google returns the same stable `sub` for a given Google account across both. Better-auth's `Account` table is keyed on `(providerId, accountId=sub)`, so a user who signs up on desktop and later installs the iOS app sees the same Brett workspace — no manual linking step.

## 3. API URL (`BrettAPIURL`)

Set in `Brett/Info.plist`:

- **Dev (default):** `http://localhost:3001` — Xcode runs the API locally.
- **Staging / TestFlight / Production:** point to Railway, e.g. `https://api.brett.brentbarkman.com`.

To ship to TestFlight, either bake the production URL into Info.plist in a release-only build configuration, or update the literal string before archiving.

`APIClient.swift` reads this at init, so changes require an app relaunch.

## 4. App Transport Security

`Info.plist` currently has `NSAllowsArbitraryLoads = true` so the simulator/device can hit `http://localhost:3001` during development. **This must be tightened before a production release.**

Recommended production posture:
- Remove `NSAllowsArbitraryLoads`.
- All production API traffic should be HTTPS (Railway's `api.brett.brentbarkman.com` is).
- If any non-HTTPS hosts are still needed, whitelist them explicitly under `NSExceptionDomains`.

Simplest approach: set the flag only in the `Debug` configuration via `xcodegen` settings, clear it in `Release`.

## 5. Session tokens — how they flow

- Email/password and Apple sign-in POST directly to `/api/auth/sign-in/*` or `/api/auth/sign-up/email`. The API returns the session token via `Set-Cookie: better-auth.session_token=...` and/or in the JSON response body.
- Google sign-in uses `ASWebAuthenticationSession`. The final redirect lands on `brett://oauth-callback?token=...`; the provider parses `token` out of the URL.
- The token is stored in the iOS Keychain (service=`com.brett.app.auth`, account=`sessionToken`, accessibility=`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`).
- `APIClient` injects `Authorization: Bearer <token>` on every outgoing request. better-auth's bearer plugin (already configured on the API) accepts that header.

## 6. Testing checklist before TestFlight

- [ ] Sign In with Apple capability enabled in Xcode, provisioning profile refreshed.
- [ ] Google OAuth iOS client created, bundle ID matches, reversed client ID added as URL scheme.
- [ ] `BrettAPIURL` pointed at production API.
- [ ] `NSAllowsArbitraryLoads` removed (or scoped to Debug only).
- [ ] Real device test: sign in with each of the three providers, force-quit and relaunch → session should persist (Keychain read succeeds).
- [ ] Sign out → Keychain cleared, app returns to SignInView.
- [ ] Airplane mode test: sign-in surfaces `APIError.offline` → user-facing "You're offline" banner.
