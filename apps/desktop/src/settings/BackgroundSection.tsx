import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api/client";
import { useAppConfig } from "../hooks/useAppConfig";
import { Image, Sparkles, Circle, Pin } from "lucide-react";
import type { BackgroundManifest, TimeSegment, BusynessTier } from "@brett/business";
import manifest from "../data/background-manifest.json";
import { solidColors } from "../data/solid-colors";

type Style = "photography" | "abstract" | "solid";

const SEGMENTS: TimeSegment[] = ["dawn", "morning", "afternoon", "goldenHour", "evening", "night"];
const TIERS: BusynessTier[] = ["light", "moderate", "packed"];
const SEGMENT_LABELS: Record<TimeSegment, string> = {
  dawn: "Dawn", morning: "Morning", afternoon: "Afternoon",
  goldenHour: "Golden Hour", evening: "Evening", night: "Night",
};

export function BackgroundSection() {
  const queryClient = useQueryClient();
  const { data: user } = useQuery({
    queryKey: ["user-me"],
    queryFn: () => apiFetch<{ backgroundStyle: string; pinnedBackground: string | null }>("/users/me"),
  });
  const { data: config } = useAppConfig();
  const baseUrl = config?.storageBaseUrl ?? "";

  // activeStyle = what's actually rendering as your background (saved to DB)
  // viewingStyle = which gallery tab you're browsing (local UI state only)
  const [activeStyle, setActiveStyle] = useState<Style>("photography");
  const [viewingStyle, setViewingStyle] = useState<Style>("photography");
  const [pinned, setPinned] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveVersionRef = useRef(0);

  useEffect(() => {
    if (user) {
      const s = user.backgroundStyle as Style;
      setActiveStyle(s);
      setViewingStyle(s);
      setPinned(user.pinnedBackground ?? null);
    }
  }, [user]);

  function saveBackground(patch: Record<string, unknown>) {
    const version = ++saveVersionRef.current;
    queryClient.setQueryData(["user-me"], (old: any) =>
      old ? { ...old, ...patch } : old
    );
    apiFetch("/users/location", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }).catch(() => {
      if (saveVersionRef.current === version) {
        setError("Failed to save.");
        setTimeout(() => setError(null), 4000);
      }
    });
  }

  function handlePin(id: string) {
    if (pinned === id) {
      // Unpin → return to smart rotation on the current viewing style
      setPinned(null);
      setActiveStyle(viewingStyle);
      saveBackground({ backgroundStyle: viewingStyle, pinnedBackground: null });
    } else {
      // Pin this background — also set the active style to match what we're viewing
      setPinned(id);
      setActiveStyle(viewingStyle);
      saveBackground({ backgroundStyle: viewingStyle, pinnedBackground: id });
    }
  }

  return (
    <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6">
      <h3 className="font-mono text-[11px] uppercase tracking-wider text-white/40 font-semibold mb-4">
        Background
      </h3>

      {error && <p className="text-xs text-red-400/80 mb-3">{error}</p>}

      {/* Style tabs — just gallery navigation, doesn't change background */}
      <div className="flex gap-2 mb-4">
        {([
          { key: "photography" as Style, icon: Image, label: "Photography" },
          { key: "abstract" as Style, icon: Sparkles, label: "Abstract" },
          { key: "solid" as Style, icon: Circle, label: "Solid" },
        ]).map(({ key, icon: Icon, label }) => {
          const isViewing = viewingStyle === key;
          const isActive = activeStyle === key && !pinned;
          return (
            <button
              key={key}
              onClick={() => setViewingStyle(key)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border transition-all duration-200 ${
                isViewing
                  ? "bg-blue-500/10 border-blue-500/30 text-white"
                  : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80"
              }`}
            >
              <Icon size={15} />
              <span className="text-sm font-medium">{label}</span>
              {isActive && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-white/40 mb-3">
        {pinned
          ? "Pinned. Click it again to unpin and return to smart rotation."
          : "Click any background to pin it, or leave on smart rotation."}
      </p>

      {/* Gallery */}
      {viewingStyle === "photography" && baseUrl && (
        <PhotoGallery baseUrl={baseUrl} pinned={pinned} onPin={handlePin} />
      )}
      {viewingStyle === "photography" && !baseUrl && (
        <div className="text-xs text-white/30 py-4 text-center">Loading images...</div>
      )}
      {viewingStyle === "abstract" && baseUrl && (
        <AbstractGallery baseUrl={baseUrl} pinned={pinned} onPin={handlePin} />
      )}
      {viewingStyle === "abstract" && !baseUrl && (
        <div className="text-xs text-white/30 py-4 text-center">Loading images...</div>
      )}
      {viewingStyle === "solid" && (
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
                const isPinned = pinned === path;
                return (
                  <button
                    key={path}
                    onClick={() => onPin(path)}
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
                      loading="eager"
                    />
                    {isPinned ? (
                      <div className="absolute top-1 right-1 p-1 rounded-full bg-blue-500/80">
                        <Pin size={10} className="text-white" />
                      </div>
                    ) : (
                      <div className="absolute top-1 right-1 p-1 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Pin size={10} className="text-white/60" />
                      </div>
                    )}
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

function AbstractGallery({ baseUrl, pinned, onPin }: { baseUrl: string; pinned: string | null; onPin: (id: string) => void }) {
  const abstractSet = (manifest as BackgroundManifest).sets.abstract;

  return (
    <div className="space-y-4 max-h-[400px] overflow-y-auto scrollbar-hide">
      {SEGMENTS.map((seg) => (
        <div key={seg}>
          <div className="font-mono text-[10px] uppercase tracking-wider text-white/30 mb-2">
            {SEGMENT_LABELS[seg]}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {TIERS.flatMap((tier) =>
              (abstractSet?.[seg]?.[tier] ?? []).map((path) => {
                const isPinned = pinned === path;
                return (
                  <button
                    key={path}
                    onClick={() => onPin(path)}
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
                      loading="eager"
                    />
                    {isPinned ? (
                      <div className="absolute top-1 right-1 p-1 rounded-full bg-blue-500/80">
                        <Pin size={10} className="text-white" />
                      </div>
                    ) : (
                      <div className="absolute top-1 right-1 p-1 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Pin size={10} className="text-white/60" />
                      </div>
                    )}
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
    <div className="grid grid-cols-6 gap-2">
      {solidColors.map((sc) => {
        const id = `solid:${sc.color}`;
        const isPinned = pinned === id;
        return (
          <button
            key={sc.id}
            onClick={() => onPin(id)}
            className={`relative flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all duration-200 ${
              isPinned
                ? "border-blue-500/50 ring-1 ring-blue-500/30 bg-white/5"
                : "border-white/10 hover:border-white/20 hover:bg-white/5"
            }`}
          >
            <div
              className="w-8 h-8 rounded-full border border-white/10 flex-shrink-0"
              style={{ background: sc.color }}
            />
            <span className="text-[10px] text-white/40 leading-tight">{sc.label}</span>
          </button>
        );
      })}
    </div>
  );
}
