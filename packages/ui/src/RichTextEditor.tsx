import React, { useEffect, useCallback, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import "./rich-text-editor.css";
import {
  Bold,
  Italic,
  Heading2,
  List,
  ListOrdered,
} from "lucide-react";

interface RichTextEditorProps {
  content: string; // markdown
  onChange: (markdown: string) => void;
  placeholder?: string;
}

interface ToolbarButtonProps {
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
  label: string;
}

function ToolbarButton({ icon, isActive, onClick, label }: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`p-1.5 rounded transition-colors ${
        isActive
          ? "text-brett-gold bg-brett-gold/20"
          : "text-white/50 hover:text-white hover:bg-white/10"
      }`}
    >
      {icon}
    </button>
  );
}

function EditorScrollArea({ editor }: { editor: any }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [canScrollUp, setCanScrollUp] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    setCanScrollUp(scrollTop > 4);
    setCanScrollDown(scrollTop + clientHeight < scrollHeight - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll, { passive: true });
    // Check on mount and when content changes
    const observer = new ResizeObserver(checkScroll);
    observer.observe(el);
    checkScroll();
    return () => {
      el.removeEventListener("scroll", checkScroll);
      observer.disconnect();
    };
  }, [checkScroll]);

  return (
    <div className="relative">
      {canScrollUp && (
        <div className="pointer-events-none absolute top-0 left-0 right-0 h-10 bg-gradient-to-b from-white/10 to-transparent z-10" />
      )}
      <div ref={scrollRef} className="max-h-[35vh] overflow-y-auto scrollbar-hide">
        <EditorContent editor={editor} />
      </div>
      {canScrollDown && (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-white/10 to-transparent z-10" />
      )}
    </div>
  );
}

export function RichTextEditor({
  content,
  onChange,
  placeholder = "Add notes\u2026",
}: RichTextEditorProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const debouncedSave = useCallback((ed: any) => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const storage = ed.storage as Record<string, any>;
      const md = storage.markdown.getMarkdown() as string;
      onChange(md);
    }, 500);
  }, [onChange]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2] },
        codeBlock: false,
        code: false,
      }),
      Placeholder.configure({ placeholder }),
      Markdown.configure({ html: false, transformCopiedText: true }),
    ],
    content,
    editorProps: {
      attributes: {
        class:
          "tiptap-editor focus:outline-none min-h-[80px] text-white/80 text-sm leading-relaxed p-3",
      },
    },
    onUpdate: ({ editor: ed }) => {
      debouncedSave(ed);
    },
    onBlur: ({ editor: ed }) => {
      clearTimeout(debounceRef.current);
      const storage = ed.storage as Record<string, any>;
      const md = storage.markdown.getMarkdown() as string;
      onChange(md);
    },
  });

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  // Sync external content changes (but not while focused)
  useEffect(() => {
    if (editor && !editor.isFocused) {
      const storage = editor.storage as Record<string, any>;
      const current = storage.markdown.getMarkdown() as string;
      if (current !== content) {
        editor.commands.setContent(content);
      }
    }
  }, [content, editor]);

  const toggleBold = useCallback(() => {
    editor?.chain().focus().toggleBold().run();
  }, [editor]);

  const toggleItalic = useCallback(() => {
    editor?.chain().focus().toggleItalic().run();
  }, [editor]);

  const toggleHeading = useCallback(() => {
    editor?.chain().focus().toggleHeading({ level: 2 }).run();
  }, [editor]);

  const toggleBulletList = useCallback(() => {
    editor?.chain().focus().toggleBulletList().run();
  }, [editor]);

  const toggleOrderedList = useCallback(() => {
    editor?.chain().focus().toggleOrderedList().run();
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-white/10">
        <ToolbarButton
          icon={<Bold size={14} />}
          isActive={editor.isActive("bold")}
          onClick={toggleBold}
          label="Bold"
        />
        <ToolbarButton
          icon={<Italic size={14} />}
          isActive={editor.isActive("italic")}
          onClick={toggleItalic}
          label="Italic"
        />
        <ToolbarButton
          icon={<Heading2 size={14} />}
          isActive={editor.isActive("heading", { level: 2 })}
          onClick={toggleHeading}
          label="Heading"
        />
        <ToolbarButton
          icon={<List size={14} />}
          isActive={editor.isActive("bulletList")}
          onClick={toggleBulletList}
          label="Bullet List"
        />
        <ToolbarButton
          icon={<ListOrdered size={14} />}
          isActive={editor.isActive("orderedList")}
          onClick={toggleOrderedList}
          label="Ordered List"
        />
      </div>

      {/* Editor — max 50vh then scroll with fade hints */}
      <EditorScrollArea editor={editor} />
    </div>
  );
}
