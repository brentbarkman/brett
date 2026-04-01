import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api/client";
import { useLocationSettings } from "../api/location";
import { Image, Sparkles } from "lucide-react";

export function BackgroundSection() {
  const queryClient = useQueryClient();
  const { data: user } = useQuery({
    queryKey: ["user-me"],
    queryFn: () => apiFetch<{ backgroundStyle: string }>("/users/me"),
  });
  const { updateLocation } = useLocationSettings();
  const [style, setStyle] = useState<"photography" | "abstract">("photography");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.backgroundStyle) {
      setStyle(user.backgroundStyle as "photography" | "abstract");
    }
  }, [user]);

  function handleChange(newStyle: "photography" | "abstract") {
    const oldStyle = style;
    setStyle(newStyle);

    // Optimistic update — App.tsx sees the change instantly via cache
    queryClient.setQueryData(["user-me"], (old: any) =>
      old ? { ...old, backgroundStyle: newStyle } : old
    );

    // Persist in background, revert on failure
    updateLocation({ backgroundStyle: newStyle }).catch(() => {
      setStyle(oldStyle);
      queryClient.setQueryData(["user-me"], (old: any) =>
        old ? { ...old, backgroundStyle: oldStyle } : old
      );
      setError("Failed to save. Try again.");
      setTimeout(() => setError(null), 4000);
    });
  }

  return (
    <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6">
      <h3 className="font-mono text-[11px] uppercase tracking-wider text-white/40 font-semibold mb-4">
        Background
      </h3>

      {error && <p className="text-xs text-red-400/80 mb-3">{error}</p>}

      <div className="flex gap-3">
        <button
          onClick={() => handleChange("photography")}
          className={`flex-1 flex items-center gap-3 p-4 rounded-lg border transition-all duration-200 ${
            style === "photography"
              ? "bg-blue-500/10 border-blue-500/30 text-white"
              : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80"
          }`}
        >
          <Image size={18} />
          <div className="text-left">
            <div className="text-sm font-medium">Photography</div>
            <div className="text-xs text-white/40 mt-0.5">Landscapes that shift with your day</div>
          </div>
        </button>

        <button
          onClick={() => handleChange("abstract")}
          className={`flex-1 flex items-center gap-3 p-4 rounded-lg border transition-all duration-200 ${
            style === "abstract"
              ? "bg-blue-500/10 border-blue-500/30 text-white"
              : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80"
          }`}
        >
          <Sparkles size={18} />
          <div className="text-left">
            <div className="text-sm font-medium">Abstract</div>
            <div className="text-xs text-white/40 mt-0.5">Gradients and shapes</div>
          </div>
        </button>
      </div>
    </div>
  );
}
