"use client";

import "./code-viewer.css";

import type { DiffEditorProps, DiffOnMount } from "@monaco-editor/react";
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

const MonacoDiffEditor = dynamic<DiffEditorProps>(
  () => import("@monaco-editor/react").then((mod) => mod.DiffEditor),
  { ssr: false, loading: () => <EditorSkeleton /> },
);

export type DiffViewerProps = {
  original: string;
  modified: string;
  language: Language;
  path: string;
  height?: string | number;
  className?: string;
};

type DiffOptions = NonNullable<DiffEditorProps["options"]>;

const DIFF_OPTIONS: DiffOptions = {
  readOnly: true,
  originalEditable: false,
  domReadOnly: true,
  renderSideBySide: true,
  useInlineViewWhenSpaceIsLimited: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontFamily: MONACO_FONT_FAMILY,
  fontSize: 13,
  lineHeight: 20,
  automaticLayout: true,
  renderValidationDecorations: "off",
  contextmenu: false,
  glyphMargin: false,
  lineNumbersMinChars: 3,
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, alwaysConsumeMouseWheel: false },
};

const handleDiffMount: DiffOnMount = (_editor, monaco) => remeasureWhenFontsReady(monaco);

/** Read-only side-by-side Monaco diff (original on the left, modified on the right). */
export function DiffViewer({
  original,
  modified,
  language,
  path,
  height = "100%",
  className,
}: DiffViewerProps): React.JSX.Element {
  const theme = useMonacoTheme();
  const originalUri = useModelUri(path, "-original");
  const modifiedUri = useModelUri(path, "-modified");

  return (
    <div className={cn("atlas-code-viewer relative w-full", className)} style={{ height }} data-path={path}>
      <MonacoDiffEditor
        original={original}
        modified={modified}
        language={language}
        originalModelPath={originalUri}
        modifiedModelPath={modifiedUri}
        theme={theme}
        options={DIFF_OPTIONS}
        beforeMount={defineAtlasThemes}
        onMount={handleDiffMount}
        loading={<EditorSkeleton />}
        height="100%"
        width="100%"
      />
    </div>
  );
}
