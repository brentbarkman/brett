import React, { useEffect, useCallback, useRef } from "react";
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
  Code2,
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
          ? "text-blue-400 bg-blue-500/20"
          : "text-white/50 hover:text-white hover:bg-white/10"
      }`}
    >
      {icon}
    </button>
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
        codeBlock: {
          HTMLAttributes: {
            class: "not-prose",
          },
        },
      }),
      Placeholder.configure({ placeholder }),
      Markdown.configure({ html: false, transformCopiedText: true }),
    ],
    content,
    editorProps: {
      attributes: {
        class:
          "tiptap-editor prose prose-invert prose-sm max-w-none focus:outline-none min-h-[80px] text-white/80 p-3",
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

  const toggleCodeBlock = useCallback(() => {
    editor?.chain().focus().toggleCodeBlock().run();
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
        <ToolbarButton
          icon={<Code2 size={14} />}
          isActive={editor.isActive("codeBlock")}
          onClick={toggleCodeBlock}
          label="Code Block"
        />
      </div>

      {/* Editor — max 50vh then scroll */}
      <div className="max-h-[50vh] overflow-y-auto scrollbar-hide">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
