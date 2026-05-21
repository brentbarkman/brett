// apps/desktop/src/components/StatusBanner.tsx
import React, { useEffect, useRef, useState } from "react";
import { useApiHealth } from "../api/health";
import { useAuth } from "../auth/AuthContext";

/**
 * Slim top banner that surfaces an API-outage state.
 *
 * Design parity with iOS:
 *  - Same copy: "Can't reach Brett — showing cached data."
 *  - Same "Retry" affordance with cooldown (10s) so a user mashing
 *    the button can't hammer the API.
 *  - Neutral glass treatment — calm-hero language. We don't render
 *    a loud red "ERROR" bar because the user can still work with
 *    cached data; the banner is a status indicator, not an alarm.
 *
 * Differences vs. iOS:
 *  - No "you're offline" state. The desktop has no native
 *    reachability API; we don't try to fake one. If the user pulls
 *    their wifi, `/health` starts failing and we show the same
 *    "Can't reach Brett" copy — the user's fix is identical
 *    whether it's their network or our gateway.
 *  - No pending-mutation count. Desktop is request-driven (no
 *    mutation queue), so the count is always zero — would be
 *    misleading to surface.
 *
 * Mounting: sits as a fixed-position slim bar between the window
 * drag region (z-50) and the main content (z-10), at z-20. Below
 * the cold-launch cover (z-30) so it doesn't flash during the
 * awakening fade. Overlaps the top of LeftNav by ~36px during
 * outage — acceptable cost for not having to restructure the
 * layout when the banner is otherwise hidden 100% of the time.
 *
 * Auth gating: the health hook runs only when the user is signed
 * in. Pre-auth (LoginPage) the banner is silent.
 */
export function StatusBanner(): React.ReactElement | null {
  const { user } = useAuth();
  const { status, retry } = useApiHealth({ enabled: !!user });

  // Explicit boolean (NOT a `deadline > Date.now()` check at render
  // time) because React only re-renders on state changes — a derived
  // "are we past the deadline" check wouldn't re-render itself when
  // the deadline passes, leaving the button disabled until some
  // unrelated state change happens to trigger a redraw. A setTimeout
  // that flips this back to false IS a state change React observes.
  const [isInCooldown, setIsInCooldown] = useState(false);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending cooldown on unmount so an unmount mid-cooldown
  // doesn't leak the timer (which would then no-op against a torn-
  // down setState, but kept clean for the linter and for parity with
  // the iOS modifier's onDisappear cleanup).
  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    };
  }, []);

  if (status === "ok") return null;
  if (!user) return null; // defensive — hook is already gated

  const handleRetry = () => {
    if (isInCooldown) return;
    setIsInCooldown(true);
    retry();
    if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    cooldownTimer.current = setTimeout(() => {
      setIsInCooldown(false);
      cooldownTimer.current = null;
    }, 10_000); // 10s cooldown — matches iOS
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={"Can't reach Brett. Showing cached data. Retry button available."}
      className="fixed left-0 right-0 top-[52px] z-20 flex items-center justify-center pointer-events-none"
    >
      <div
        className={[
          "pointer-events-auto",
          "flex items-center gap-3",
          "rounded-xl border",
          "bg-white/5 backdrop-blur-xl",
          "border-white/15",
          "px-4 py-2",
          "shadow-lg shadow-black/30",
          "text-[13px] text-white/85",
          "transition-opacity duration-200",
        ].join(" ")}
      >
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* exclamationmark.icloud-ish — same visual register as iOS */}
          <path
            d="M19 12a7 7 0 1 0-13.9 1.1A4 4 0 0 0 6 21h12a4 4 0 0 0 1.7-7.6c.2-.4.3-.9.3-1.4z"
            stroke="rgba(255,255,255,0.7)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M12 9v4.5M12 16.25v.01"
            stroke="rgba(255,255,255,0.85)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>

        <span>Can't reach Brett — showing cached data</span>

        <button
          type="button"
          onClick={handleRetry}
          disabled={isInCooldown}
          className={[
            "ml-2",
            "rounded-full px-3 py-1",
            "text-[12px] font-semibold",
            "transition-colors",
            isInCooldown
              ? "bg-white/5 text-white/40 cursor-not-allowed"
              : "bg-white/10 text-white/85 hover:bg-white/15 cursor-pointer",
          ].join(" ")}
          aria-label="Retry connection"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
