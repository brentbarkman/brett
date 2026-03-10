import React, { useEffect, useState, useRef } from "react";
import { Cloud, Send, Bot } from "lucide-react";

export function Omnibar() {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`
        relative w-full bg-black/40 backdrop-blur-xl border rounded-2xl transition-all duration-300 ease-in-out
        ${isOpen ? "border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.15)]" : "border-white/10"}
      `}
    >
      {/* Top Pill Area */}
      <div
        className="flex items-center h-12 px-4 cursor-text"
        onClick={() => setIsOpen(true)}
      >
        <Bot
          size={18}
          className={isOpen ? "text-blue-400" : "text-white/40"}
        />
        <input
          type="text"
          placeholder="Ask Brett anything..."
          className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 px-3 text-sm"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onFocus={() => setIsOpen(true)}
        />
        <div className="flex items-center gap-2 text-white/50 text-xs font-medium pl-3 border-l border-white/10">
          <span>48°F · Overcast</span>
          <Cloud size={14} />
        </div>
      </div>

      {/* Expandable Chat Area */}
      <div
        className={`
          overflow-hidden transition-all duration-300 ease-in-out
          ${isOpen ? "max-h-[300px] opacity-100 border-t border-white/10" : "max-h-0 opacity-0"}
        `}
      >
        <div className="p-4 flex flex-col gap-4 h-[250px]">
          <div className="flex-1 overflow-y-auto space-y-4 scrollbar-hide">
            {/* Sample Messages */}
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot size={12} className="text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-white/90">
                  Good morning. I've prepared your briefing for the board sync.
                  I also noticed Sarah pushed a new design system RFC late last
                  night.
                </p>
              </div>
            </div>
            <div className="flex gap-3 flex-row-reverse">
              <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-[10px] text-white/70">ME</span>
              </div>
              <div>
                <p className="text-sm text-white/90 bg-white/5 px-3 py-2 rounded-lg rounded-tr-none">
                  Can you summarize the RFC?
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot size={12} className="text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-white/90">
                  It proposes moving from styled-components to Tailwind CSS.
                  Main benefits cited are performance and consistency. I've added
                  it to your 'Brett app' list to review this week.
                </p>
              </div>
            </div>
          </div>

          {/* Input Row */}
          <div className="flex items-center gap-2 mt-auto">
            <button className="p-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors ml-auto">
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
