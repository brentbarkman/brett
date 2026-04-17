import { Hono } from "hono";

/**
 * `.well-known` routes — served at fixed paths required by various Apple /
 * Android / Web platform conventions. Public, no auth.
 *
 * Currently handles:
 *  - `GET /.well-known/apple-app-site-association` — required for iOS
 *    platform passkeys (webcredentials) + any future Universal Links
 *    (applinks). iOS fetches this directly from the RP domain whenever
 *    the app registers its associated domains; the domain must serve it
 *    over HTTPS with no redirects and `Content-Type: application/json`.
 *
 *    The `apps` entries in the payload are `<TeamID>.<BundleID>` — the
 *    Team ID comes from `APPLE_TEAM_ID` (10-char Apple Developer identifier),
 *    the bundle IDs from `APPLE_BUNDLE_ID` + the share extension.
 *
 *    If `APPLE_TEAM_ID` isn't set, we still return a syntactically valid
 *    but empty-apps payload rather than 404 — that way operators can see
 *    the route is wired and diagnose the config gap, while passkey
 *    registration on device will surface the "setup required" UI we
 *    already render in SecuritySettingsView.
 */
export const wellKnown = new Hono();

wellKnown.get("/apple-app-site-association", (c) => {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const bundleId = process.env.APPLE_BUNDLE_ID?.trim() || "com.brett.app";

  // Only include apps when we have the Team ID. An empty array is
  // well-formed JSON that iOS tolerates (it just means no app-to-domain
  // association, so passkeys / universal links don't activate).
  const apps = teamId ? [`${teamId}.${bundleId}`] : [];

  // AASA schema (partial — we only use webcredentials today; applinks stub
  // is included so this is trivially extended when we add Universal Links).
  const body = {
    webcredentials: { apps },
    applinks: {
      apps: [],
      details: apps.length > 0 ? [{ appIDs: apps, paths: ["NOT /*"] }] : [],
    },
  };

  return c.json(body, 200, {
    // AASA historically used `application/pkcs7-mime` (when it was signed);
    // since iOS 14, `application/json` is the correct content type for
    // unsigned AASA served over HTTPS.
    "Content-Type": "application/json",
    // Cache briefly so iOS isn't hammering us on every app launch but we
    // can still iterate during setup. 1 hour is a reasonable middle ground.
    "Cache-Control": "public, max-age=3600",
  });
});
