import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api/client";
import { useLocationSettings } from "../api/location";
import { useAppConfig } from "../hooks/useAppConfig";
import { Image, Sparkles, Circle, Pin, PinOff, ChevronDown, ChevronUp } from "lucide-react";
import type { BackgroundManifest, TimeSegment, BusynessTier } from "@brett/business";
import manifest from "../data/background-manifest.json";
import { gradients } from "../data/abstract-gradients";
import { solidColors } from "../data/solid-colors";

type Style = "photography" | "abstract" | "solid";

const SEGMENTS: TimeSegment[] = ["dawn", "morning", "afternoon", "goldenHour", "evening", "night"];
const TIERS: BusynessTier[] = ["light", "moderate", "packed"];
const SEGMENT_LABELS: Record<TimeSegment, string> = {
  dawn: "Dawn", morning: "Morning", afternoon: "Afternoon",
  goldenHour: "Golden Hour", evening: "Evening", night: "Night",
};
const TIER_LABELS: Record<BusynessTier, string> = {
  light: "Light", moderate: "Moderate", packed: "Packed",
};

export function BackgroundSection() {
  const queryClient = useQueryClient();
  const { data: user } = useQuery({
    queryKey: ["user-me"],
    queryFn: () => apiFetch<{ backgroundStyle: string; pinnedBackground: string | null }>("/users/me"),
  });
  const { data: config } = useAppConfig();
  const baseUrl = config?.storageBaseUrl ?? "";
  const { updateLocation } = useLocationSettings();

  const [style, setStyle] = useState<Style>("photography");
  const [pinned, setPinned] = useState<string | null>(null);
  const [showGallery, setShowGallery] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setStyle(user.backgroundStyle as Style);
      setPinned(user.pinnedBackground ?? null);
    }
  }, [user]);

  // Optimistic update helper
  function optimisticUpdate(patch: Record<string, unknown>) {
    queryClient.setQueryData(["user-me"], (old: any) =>
      old ? { ...old, ...patch } : old
    );
  }

  function handleStyleChange(newStyle: Style) {
    const oldStyle = style;
    const oldPinned = pinned;
    setStyle(newStyle);
    setPinned(null); // Clear pin when switching styles

    optimisticUpdate({ backgroundStyle: newStyle, pinnedBackground: null });
    updateLocation({ backgroundStyle: newStyle, pinnedBackground: null } as any).catch(() => {
      setStyle(oldStyle);
      setPinned(oldPinned);
      optimisticUpdate({ backgroundStyle: oldStyle, pinnedBackground: oldPinned });
      setError("Failed to save. Try again.");
      setTimeout(() => setError(null), 4000);
    });
  }

  function handlePin(id: string) {
    const newPinned = pinned === id ? null : id; // Toggle
    const oldPinned = pinned;
    setPinned(newPinned);

    optimisticUpdate({ pinnedBackground: newPinned });
    updateLocation({ pinnedBackground: newPinned } as any).catch(() => {
      setPinned(oldPinned);
      optimisticUpdate({ pinnedBackground: oldPinned });
      setError("Failed to save.");
      setTimeout(() => setError(null), 4000);
    });
  }

  return (
    <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6">
      <h3 className="font-mono text-[11px] uppercase tracking-wider text-white/40 font-semibold mb-4">
        Background
      </h3>

      {error && <p className="text-xs text-red-400/80 mb-3">{error}</p>}

      {/* Style selector */}
      <div className="flex gap-2 mb-4">
        {([
          { key: "photography" as Style, icon: Image, label: "Photography" },
          { key: "abstract" as Style, icon: Sparkles, label: "Abstract" },
          { key: "solid" as Style, icon: Circle, label: "Solid" },
        ]).map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => handleStyleChange(key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border transition-all duration-200 ${
              style === key
                ? "bg-blue-500/10 border-blue-500/30 text-white"
                : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80"
            }`}
          >
            <Icon size={15} />
            <span className="text-sm font-medium">{label}</span>
          </button>
        ))}
      </div>

      {/* Smart mode indicator */}
      {!pinned && style !== "solid" && (
        <p className="text-xs text-white/40 mb-3">
          Smart mode — shifts with time of day and busyness
        </p>
      )}
      {pinned && (
        <button
          onClick={() => handlePin(pinned)}
          className="flex items-center gap-1.5 text-xs text-blue-400/80 hover:text-blue-400 mb-3 transition-colors"
        >
          <PinOff size={12} />
          Unpin — return to smart rotation
        </button>
      )}

      {/* Gallery toggle */}
      <button
        onClick={() => setShowGallery(!showGallery)}
        className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/60 transition-colors mb-3"
      >
        {showGallery ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {showGallery ? "Hide gallery" : "Browse & pin a background"}
      </button>

      {/* Gallery */}
      {showGallery && style === "photography" && (
        <PhotoGallery baseUrl={baseUrl} pinned={pinned} onPin={handlePin} />
      )}
      {showGallery && style === "abstract" && (
        <GradientGallery pinned={pinned} onPin={handlePin} />
      )}
      {showGallery && style === "solid" && (
        <SolidGallery pinned={pinned} onPin={handlePin} />
      )}
    </div>
  );
}

function PhotoGallery({ baseUrl, pinned, onPin }: { baseUrl: string; pinned: string | null; onPin: (id: string) => void }) {
  const photoSet = (manifest as BackgroundManifest).sets.photography;

  return (
    <div className="space-y-4 max-h-[400px] overflow-y-auto scrollbar-hide">
      {SEGMENTS.map((seg) => (
        <div key={seg}>
          <div className="font-mono text-[10px] uppercase tracking-wider text-white/30 mb-2">
            {SEGMENT_LABELS[seg]}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {TIERS.flatMap((tier) =>
              (photoSet?.[seg]?.[tier] ?? []).map((path) => {
                const id = path;
                const isPinned = pinned === id;
                return (
                  <button
                    key={path}
                    onClick={() => onPin(id)}
                    className={`relative group rounded-lg overflow-hidden border transition-all duration-200 aspect-video ${
                      isPinned
                        ? "border-blue-500/50 ring-1 ring-blue-500/30"
                        : "border-white/10 hover:border-white/20"
                    }`}
                  >
                    <img
                      src={`${baseUrl}/backgrounds/${path}`}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    {isPinned && (
                      <div className="absolute top-1 right-1 p-1 rounded-full bg-blue-500/80">
                        <Pin size={10} className="text-white" />
                      </div>
                    )}
                    <div className="absolute bottom-0 inset-x-0 p-1 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-[9px] text-white/60 font-mono">{TIER_LABELS[tier]}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function GradientGallery({ pinned, onPin }: { pinned: string | null; onPin: (id: string) => void }) {
  return (
    <div className="space-y-4 max-h-[400px] overflow-y-auto scrollbar-hide">
      {SEGMENTS.map((seg) => (
        <div key={seg}>
          <div className="font-mono text-[10px] uppercase tracking-wider text-white/30 mb-2">
            {SEGMENT_LABELS[seg]}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {TIERS.flatMap((tier) =>
              (gradients[seg]?.[tier] ?? []).map((def, idx) => {
                const id = `abstract:${seg}:${tier}:${idx}`;
                const isPinned = pinned === id;
                return (
                  <button
                    key={id}
                    onClick={() => onPin(id)}
                    className={`relative group rounded-lg overflow-hidden border transition-all duration-200 aspect-video ${
                      isPinned
                        ? "border-blue-500/50 ring-1 ring-blue-500/30"
                        : "border-white/10 hover:border-white/20"
                    }`}
                  >
                    <div className="w-full h-full" style={{ background: def.background }} />
                    {isPinned && (
                      <div className="absolute top-1 right-1 p-1 rounded-full bg-blue-500/80">
                        <Pin size={10} className="text-white" />
                      </div>
                    )}
                    <div className="absolute bottom-0 inset-x-0 p-1 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-[9px] text-white/60 font-mono">{TIER_LABELS[tier]}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SolidGallery({ pinned, onPin }: { pinned: string | null; onPin: (id: string) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {solidColors.map((sc) => {
        const id = `solid:${sc.color}`;
        const isPinned = pinned === id;
        return (
          <button
            key={sc.id}
            onClick={() => onPin(id)}
            className={`relative group flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all duration-200 ${
              isPinned
                ? "border-blue-500/50 ring-1 ring-blue-500/30 bg-white/5"
                : "border-white/10 hover:border-white/20 hover:bg-white/5"
            }`}
          >
            <div
              className="w-8 h-8 rounded-full border border-white/10"
              style={{ background: sc.color }}
            />
            <span className="text-[10px] text-white/40">{sc.label}</span>
            {isPinned && (
              <div className="absolute top-1 right-1 p-0.5 rounded-full bg-blue-500/80">
                <Pin size={8} className="text-white" />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
