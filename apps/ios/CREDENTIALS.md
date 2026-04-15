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

## 2. Google OAuth (iOS client)

Google policy requires a dedicated iOS OAuth Client ID — you cannot reuse the web client used by the desktop app.

1. Visit <https://console.cloud.google.com/apis/credentials>.
2. **Create Credentials → OAuth client ID → iOS**.
3. **Bundle ID:** `com.brett.app`.
4. Copy the **iOS client ID** (format: `123-abc.apps.googleusercontent.com`).
5. Also copy the **reversed client ID** (format: `com.googleusercontent.apps.123-abc`).
6. In `Brett/Info.plist`:
   - Set `GoogleiOSClientID` to the iOS client ID from step 4.
   - Add the reversed client ID as an additional URL scheme under `CFBundleURLTypes`. The existing entry already contains `brett` (for the OAuth callback); add the reversed client ID as a second `CFBundleURLSchemes` entry or a second dict under `CFBundleURLTypes`.
7. The provider at `Brett/Auth/GoogleSignInProvider.swift` uses `ASWebAuthenticationSession` to open `{BrettAPIURL}/api/auth/sign-in/social?provider=google&callbackURL=brett://oauth-callback` and extracts the session token from the callback URL query parameter.

**Note:** The API side may need a `/api/auth/ios/google` GET shim (mirroring the existing `/api/auth/desktop/google`) so the POST-only `/sign-in/social` endpoint can be hit via browser redirect. If Google sign-in fails with a `method_not_allowed` error, add that shim on the API.

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
