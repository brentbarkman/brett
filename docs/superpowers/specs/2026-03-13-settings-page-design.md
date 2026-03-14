# Settings Page — Design Spec

## Problem

The app has no settings page. Users cannot edit their profile, change their password, sign out, or delete their account. The only way to sign out is to clear app data.

## Solution

A single-page settings view accessible by clicking the user avatar in the LeftNav footer. Replaces the main content area (LeftNav stays visible). Four sections: Profile, Security, Sign Out, Danger Zone.

## Scope

**In scope:**
- Edit display name
- Display avatar (read-only) and email (read-only)
- Change password (email/password users only)
- Google OAuth detection — show "Signed in with Google" badge
- Sign out
- Delete account with confirmation dialog

**Deferred:**
- Avatar upload (requires S3 endpoint)
- Email change (requires verification flow, tricky in Electron)

## Architecture

### View Routing

Add `activeView` state to `App.tsx` (`"today" | "settings"`). Conditional rendering — no router library needed.

```
App.tsx
├── LeftNav (onAvatarClick → setActiveView("settings"))
├── activeView === "today"
│   ├── center column (Omnibar, Briefing, ThingsList)
│   └── right column (CalendarTimeline)
└── activeView === "settings"
    └── SettingsPage (onBack → setActiveView("today"))
        ├── ProfileSection
        ├── SecuritySection
        ├── SignOutSection
        └── DangerZoneSection → DeleteAccountDialog
```

When settings is active, both center and right columns are replaced by the settings view (centered, max-width ~600px).

### Auth Method Detection

Use better-auth's `listAccounts` endpoint to get linked accounts. Each account has a `providerId` — `"credential"` for email/password, `"google"` for Google OAuth.

A user could have both. Show password change if they have a credential account. Show Google badge if they have a Google account.

### API Endpoints (all built into better-auth)

No custom API routes needed:

| Action | Endpoint | Client Method |
|--------|----------|---------------|
| Update name | `POST /api/auth/update-user` | `authClient.updateUser({ name })` |
| Change password | `POST /api/auth/change-password` | `authClient.changePassword({ currentPassword, newPassword })` |
| List accounts | `GET /api/auth/list-accounts` | `authClient.listAccounts()` |
| Delete account | `POST /api/auth/delete-user` | `authClient.deleteUser()` |

**Note:** `deleteUser` may need to be explicitly enabled in the better-auth server config (`apps/api/src/lib/auth.ts`).

## Files to Create

All new files in `apps/desktop/src/settings/`:

| File | Purpose |
|------|---------|
| `SettingsPage.tsx` | Top-level view: back button, "Settings" heading, renders sections |
| `ProfileSection.tsx` | Avatar display, name input (editable), email (read-only), save button |
| `SecuritySection.tsx` | Google badge OR password change form, based on account type |
| `SignOutSection.tsx` | Card with sign out button |
| `DangerZoneSection.tsx` | Red-bordered card, delete account button |
| `DeleteAccountDialog.tsx` | Confirmation modal: type "DELETE" to confirm |
| `useAccountType.ts` | Hook: calls `listAccounts`, returns `{ isGoogle, isEmailPassword, loading }` |

## Files to Modify

| File | Change |
|------|--------|
| `apps/desktop/src/App.tsx` | Add `activeView` state, conditional rendering, pass `onAvatarClick` to LeftNav |
| `packages/ui/src/LeftNav.tsx` | Add `onAvatarClick` prop, make avatar footer clickable with hover state |
| `apps/desktop/src/auth/AuthContext.tsx` | Expose `refetchUser` from session so settings can refresh after profile updates |
| `apps/api/src/lib/auth.ts` | Enable `deleteUser` if not already supported by default |

## UI Sections

### Profile Card
- Large avatar (56px, read-only display)
- "Change photo" link (disabled/coming soon)
- Name: text input, pre-populated, editable
- Email: text input, pre-populated, read-only (greyed out)
- Save button (blue, only enabled when name changed)

### Security Card
**Google OAuth user:**
- Google icon + "Signed in with Google" + email
- Italic note: "Password management is not available for Google accounts."

**Email/password user:**
- Current password input
- New password input
- "Update password" button
- Validation: surface API errors inline (better-auth enforces password rules server-side)

**Both accounts linked:**
- Show Google badge AND password change form

### Sign Out Card
- Text: "Sign out" + "Sign out of your account on this device"
- Ghost button: "Sign out"
- Calls `signOut()` from `useAuth()`

### Danger Zone Card
- Red border (`border-red-500/30`)
- "Delete account" title in red + description
- Red outline button → opens DeleteAccountDialog

### Delete Account Dialog
- Modal overlay (React portal)
- Warning text about permanent deletion
- Text input: "Type DELETE to confirm"
- Cancel button (ghost) + Delete button (red, disabled until input = "DELETE")
- Loading state during API call
- On success: sign out
- On error: show inline error message (e.g., network failure)

## Styling

All cards use the existing glass-morphism pattern:
```
bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6
```

Inputs:
```
bg-white/5 border border-white/10 rounded-lg text-white
focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50
```

Section headings: `text-xs uppercase tracking-wider text-white/40 font-semibold`

## Testing

**Automated (Vitest + React Testing Library):**
- `useAccountType`: mock `authClient.listAccounts()`, verify Google/credential detection
- `DeleteAccountDialog`: verify button disabled until "DELETE" typed, verify `onConfirm` called
- `SecuritySection`: verify correct UI for Google vs email users
- `ProfileSection`: verify save calls `authClient.updateUser()`

**Manual verification:**
- Google user sees badge, no password fields
- Email user sees password change form
- Name change persists after save + page refresh
- Delete account: type DELETE → confirm → signed out
- Back button returns to Today view
- Avatar click works in both expanded and collapsed LeftNav
