import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api/client";
import { useAppConfig } from "../hooks/useAppConfig";
import { Image, Sparkles, Circle, Pin, RotateCcw } from "lucide-react";
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
        setTimeout(() => setError(null), 3000);
      }
    });
  }

  // Click "Smart Rotation" in a gallery → smart mode for that category
  function handleSmart(style: Style) {
    setPinned(null);
    setActiveStyle(style);
    saveBackground({ backgroundStyle: style, pinnedBackground: null });
  }

  // Click an image/solid → pin it
  function handlePin(id: string) {
    setPinned(id);
    setActiveStyle(viewingStyle);
    saveBackground({ backgroundStyle: viewingStyle, pinnedBackground: id });
  }

  return (
    <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6">
      <h3 className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-4">
        Background
      </h3>

      {error && <p className="text-xs text-red-400/80 mb-3">{error}</p>}

      {/* Style tabs — just gallery navigation, doesn't change background */}
      <div className="flex gap-2 mb-4">
        {([
          { key: "photography" as Style, icon: Image, label: "Photography" },
          { key: "abstract" as Style, icon: Sparkles, label: "Abstract" },
          { key: "solid" as Style, icon: Circle, label: "Solid" },
        ]).map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setViewingStyle(key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border transition-all duration-200 ${
              viewingStyle === key
                ? "bg-brett-gold/10 border-brett-gold/30 text-white"
                : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80"
            }`}
          >
            <Icon size={15} />
            <span className="text-sm font-medium">{label}</span>
          </button>
        ))}
      </div>

      {/* Gallery */}
      {viewingStyle === "photography" && baseUrl && (
        <ImageGallery baseUrl={baseUrl} setName="photography" pinned={pinned} activeStyle={activeStyle} onPin={handlePin} onSmart={() => handleSmart("photography")} />
      )}
      {viewingStyle === "photography" && !baseUrl && (
        <div className="text-xs text-white/30 py-4 text-center">Loading images...</div>
      )}
      {viewingStyle === "abstract" && baseUrl && (
        <ImageGallery baseUrl={baseUrl} setName="abstract" pinned={pinned} activeStyle={activeStyle} onPin={handlePin} onSmart={() => handleSmart("abstract")} />
      )}
      {viewingStyle === "abstract" && !baseUrl && (
        <div className="text-xs text-white/30 py-4 text-center">Loading images...</div>
      )}
      {viewingStyle === "solid" && (
        <SolidGallery pinned={pinned} activeStyle={activeStyle} onPin={handlePin} onSmart={() => handleSmart("solid")} />
      )}
    </div>
  );
}

interface GalleryProps {
  pinned: string | null;
  activeStyle: Style;
  onPin: (id: string) => void;
  onSmart: () => void;
}

function SmartOption({ style, activeStyle, pinned, onSmart }: { style: Style; activeStyle: Style; pinned: string | null; onSmart: () => void }) {
  const isActive = activeStyle === style && !pinned;
  return (
    <button
      onClick={onSmart}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all duration-200 mb-3 ${
        isActive
          ? "bg-brett-gold/10 border-brett-gold/30 text-white"
          : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80"
      }`}
    >
      <RotateCcw size={14} />
      <span className="text-xs font-medium">Smart Rotation</span>
      {isActive && <span className="text-[10px] text-white/40 ml-1">Active — shifts with time & busyness</span>}
    </button>
  );
}

function ImageGallery({ baseUrl, setName, pinned, activeStyle, onPin, onSmart }: GalleryProps & { baseUrl: string; setName: string }) {
  const imageSet = (manifest as BackgroundManifest).sets[setName];

  return (
    <div>
      <SmartOption style={setName as Style} activeStyle={activeStyle} pinned={pinned} onSmart={onSmart} />
      <div className="space-y-4 max-h-[600px] overflow-y-auto scrollbar-hide">
        {SEGMENTS.map((seg) => (
          <div key={seg}>
            <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-white/30 mb-2">
              {SEGMENT_LABELS[seg]}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {TIERS.flatMap((tier) =>
                (imageSet?.[seg]?.[tier] ?? []).map((path) => {
                  const isPinned = pinned === path;
                  return (
                    <button
                      key={path}
                      onClick={() => onPin(path)}
                      className={`relative group rounded-lg overflow-hidden border transition-all duration-200 aspect-video ${
                        isPinned
                          ? "border-brett-gold/50 ring-1 ring-brett-gold/30"
                          : "border-white/10 hover:border-white/20"
                      }`}
                    >
                      <img
                        src={`${baseUrl}/backgrounds/${path}`}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="eager"
                      />
                      {isPinned && (
                        <div className="absolute top-1 right-1 p-1 rounded-full bg-brett-gold/80">
                          <Pin size={10} className="text-white" />
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
    </div>
  );
}

function SolidGallery({ pinned, activeStyle, onPin, onSmart }: GalleryProps) {
  return (
    <div>
      <SmartOption style="solid" activeStyle={activeStyle} pinned={pinned} onSmart={onSmart} />
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
                  ? "border-brett-gold/50 ring-1 ring-brett-gold/30 bg-white/5"
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
    </div>
  );
}
