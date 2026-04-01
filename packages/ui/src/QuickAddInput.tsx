import React, { useState, useRef, useImperativeHandle, forwardRef } from "react";
import { Plus, Link } from "lucide-react";
import { detectUrl } from "@brett/business";

export interface QuickAddInputHandle {
  focus: () => void;
}

interface QuickAddInputProps {
  placeholder?: string;
  onAdd: (title: string) => void;
  onAddContent?: (url: string) => void;
  onFocusChange?: (focused: boolean) => void;
}

export const QuickAddInput = forwardRef<QuickAddInputHandle, QuickAddInputProps>(
  function QuickAddInput({ placeholder = "Add a thing...", onAdd, onAddContent, onFocusChange }, ref) {
    const [value, setValue] = useState("");
    const [isFocused, setIsFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
    }));

    const handleSubmit = () => {
      if (!value.trim()) return;
      const detected = detectUrl(value.trim());
      if (detected.isUrl && onAddContent) {
        onAddContent(detected.url);
      } else {
        onAdd(value.trim());
      }
      setValue("");
      inputRef.current?.focus();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === "Escape") {
        setValue("");
        inputRef.current?.blur();
      }
    };

    const isUrlLike = value.trim().length > 0 && !value.trim().includes(" ") && detectUrl(value.trim()).isUrl;

    return (
      <div
        className={`
          flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all mb-3
          ${isFocused
            ? "bg-white/5 border border-blue-500/20"
            : "border border-transparent hover:bg-white/5"
          }
        `}
      >
        {isUrlLike ? (
          <Link size={15} className="text-amber-400" />
        ) : (
          <Plus size={15} className={isFocused ? "text-blue-400" : "text-white/20"} />
        )}
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { setIsFocused(true); onFocusChange?.(true); }}
          onBlur={() => {
            if (!value) setIsFocused(false);
            onFocusChange?.(false);
          }}
          className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/20 text-sm"
        />
        {isFocused && value.trim() && (
          <span className="text-[10px] text-white/20 font-mono">enter</span>
        )}
      </div>
    );
  }
);
