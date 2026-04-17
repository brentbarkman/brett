import React from "react";
import { useNavigate } from "react-router-dom";

function getMessages(assistantName: string) {
  return [
    { title: "Nothing here", subtitle: "This page doesn't exist. Probably never did." },
    { title: "Dead end", subtitle: `${assistantName} doesn't know this place either.` },
    { title: "Page not found", subtitle: "Check the URL or head back to something real." },
  ];
}

interface NotFoundViewProps {
  assistantName?: string;
}

export function NotFoundView({ assistantName = "Brett" }: NotFoundViewProps) {
  const navigate = useNavigate();
  const messages = getMessages(assistantName);
  const msg = messages[Math.floor(Math.random() * messages.length)];

  return (
    <div className="flex-1 flex items-center justify-center min-h-[60vh]">
      <div className="bg-black/40 backdrop-blur-xl rounded-xl border border-white/10 p-8 text-center max-w-sm">
        <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-4">
          <span className="text-white/30 text-sm font-mono">404</span>
        </div>
        <h1 className="text-xl font-bold text-white mb-2">{msg.title}</h1>
        <p className="text-sm text-white/40 mb-6">{msg.subtitle}</p>
        <button
          onClick={() => navigate("/today")}
          className="px-4 py-2 rounded-lg bg-brett-gold/20 text-brett-gold hover:bg-brett-gold/30 hover:text-brett-gold-dark border border-brett-gold/20 text-sm font-medium transition-colors"
        >
          Back to Today
        </button>
      </div>
    </div>
  );
}
