import React from "react";
import { useNavigate } from "react-router-dom";

const messages = [
  { emoji: "🕳️", title: "You found the void", subtitle: "It's not as exciting as it sounds." },
  { emoji: "🗺️", title: "Here be dragons", subtitle: "Just kidding. There's nothing here at all." },
  { emoji: "👻", title: "This page is a ghost", subtitle: "It doesn't exist and it never did." },
  { emoji: "🧭", title: "Lost?", subtitle: "Even GPS can't help you here." },
  { emoji: "🪐", title: "You've reached the edge of the universe", subtitle: "Brett doesn't go this far. Yet." },
  { emoji: "🐛", title: "404: Bug or feature?", subtitle: "Definitely not a feature." },
];

export function NotFoundView() {
  const navigate = useNavigate();
  const msg = messages[Math.floor(Math.random() * messages.length)];

  return (
    <div className="flex-1 flex items-center justify-center min-h-[60vh]">
      <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-8 text-center max-w-sm">
        <div className="text-4xl mb-4">{msg.emoji}</div>
        <h1 className="text-xl font-bold text-white mb-2">{msg.title}</h1>
        <p className="text-sm text-white/40 mb-6">{msg.subtitle}</p>
        <button
          onClick={() => navigate("/today")}
          className="px-4 py-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 hover:text-blue-300 border border-blue-500/20 text-sm font-medium transition-colors"
        >
          Take me home
        </button>
      </div>
    </div>
  );
}
