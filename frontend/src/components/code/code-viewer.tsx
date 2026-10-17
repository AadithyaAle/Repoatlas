"use client";

import "./code-viewer.css";

import type { EditorProps, Monaco, OnMount } from "@monaco-editor/react";
import dynamic from "next/dynamic";
import * as React from "react";

import {
  EditorSkeleton,
  MONACO_FONT_FAMILY,
  defineAtlasThemes,
  remeasureWhenFontsReady,
  useModelUri,
  useMonacoTheme,
} from "@/components/code/monaco-shared";
import type { Language } from "@/lib/api/types";
import { cn } from "@/lib/utils";

// Monaco touches `window` — load it on the client only.
const MonacoEditor = dynamic<EditorProps>(
  () => import("@monaco-editor/react").then((mod) => mod.Editor),
  { ssr: false, loading: () => <EditorSkeleton /> },
);

export type LineRange = { start: number; end: number };

export type CodeViewerProps = {
  content: string;
  language: Language;
  /** Used for the Monaco model URI (lets Monaco detect tsx/jsx from the extension). */
  path: string;
  /** Whole-line highlight, revealed in the centre of the viewport. */
  highlight?: LineRange | null;
  /** When true, report the current selection via `onSelectionChange`. */
  selectable?: boolean;
  /** Full-line range of the current selection (`null` when the selection is empty). */
  onSelectionChange?: (range: LineRange | null) => void;
  height?: string | number;
  className?: string;
};

type StandaloneEditor = Parameters<OnMount>[0];
type EditorInstance = { editor: StandaloneEditor; monaco: Monaco };
type EditorOptions = NonNullable<EditorProps["options"]>;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Convert a Monaco selection to whole lines; a selection ending at column 1 excludes that line. */
function toLineRange(selection: {
  isEmpty(): boolean;
  startLineNumber: number;
  endLineNumber: number;
  endColumn: number;
}): LineRange | null {
  if (selection.isEmpty()) return null;
  const start = selection.startLineNumber;
  let end = selection.endLineNumber;
  if (end > start && selection.endColumn === 1) end -= 1;
  return { start, end };
}

/** Read-only Monaco code viewer with optional line highlight and line-range selection. */
export function CodeViewer({
  content,
  language,
  path,
  highlight = null,
  selectable = false,
  onSelectionChange,
  height = "100%",
  className,
}: CodeViewerProps): React.JSX.Element {
  const theme = useMonacoTheme();
  const modelUri = useModelUri(path);
  const [instance, setInstance] = React.useState<EditorInstance | null>(null);

  const options = React.useMemo<EditorOptions>(
    () => ({
      readOnly: true,
      domReadOnly: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontFamily: MONACO_FONT_FAMILY,
      fontSize: 13,
      lineHeight: 20,
      fontLigatures: true,
      renderLineHighlight: selectable ? "line" : "none",
      renderValidationDecorations: "off",
      automaticLayout: true,
      contextmenu: false,
      folding: true,
      glyphMargin: false,
      lineNumbersMinChars: 3,
      padding: { top: 8, bottom: 8 },
      stickyScroll: { enabled: false },
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, alwaysConsumeMouseWheel: false },
    }),
    [selectable],
  );

  const handleMount = React.useCallback<OnMount>((editor, monaco) => {
    remeasureWhenFontsReady(monaco);
    setInstance({ editor, monaco });
  }, []);

  // Keep the latest callback without re-subscribing to Monaco on every render.
  const onSelectionChangeRef = React.useRef(onSelectionChange);
  React.useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  });

  React.useEffect(() => {
    if (!instance || !selectable) return;
    const subscription = instance.editor.onDidChangeCursorSelection((event) => {
      onSelectionChangeRef.current?.(toLineRange(event.selection));
    });
    return () => subscription.dispose();
  }, [instance, selectable]);

  const highlightStart = highlight?.start ?? null;
  const highlightEnd = highlight?.end ?? null;

  React.useEffect(() => {
    if (!instance || highlightStart === null) return;
    const { editor, monaco } = instance;
    const lineCount = editor.getModel()?.getLineCount() ?? 1;
    const start = Math.min(Math.max(1, highlightStart), lineCount);
    const end = Math.min(Math.max(start, highlightEnd ?? start), lineCount);
    const collection = editor.createDecorationsCollection([
      {
        range: new monaco.Range(start, 1, end, 1),
        options: {
          isWholeLine: true,
          className: "atlas-line-highlight",
          linesDecorationsClassName: "atlas-line-highlight-gutter",
        },
      },
    ]);
    editor.revealLinesInCenter(
      start,
      end,
      prefersReducedMotion() ? monaco.editor.ScrollType.Immediate : monaco.editor.ScrollType.Smooth,
    );
    return () => collection.clear();
  }, [instance, highlightStart, highlightEnd, content, modelUri]);

  return (
    <div
      className={cn("atlas-code-viewer relative w-full", className)}
      style={{ height }}
      data-path={path}
    >
      <MonacoEditor
        value={content}
        language={language}
        path={modelUri}
        theme={theme}
        options={options}
        beforeMount={defineAtlasThemes}
        onMount={handleMount}
        loading={<EditorSkeleton />}
        height="100%"
        width="100%"
      />
    </div>
  );
}
