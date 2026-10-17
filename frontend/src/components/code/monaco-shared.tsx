"use client";

import type { Monaco } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const ATLAS_DARK_THEME = "repoatlas-dark";
export const ATLAS_LIGHT_THEME = "repoatlas-light";

export const MONACO_FONT_FAMILY =
  "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

let themesDefined = false;

/** `beforeMount` hook: register RepoAtlas themes (zinc backgrounds matching the app). */
export function defineAtlasThemes(monaco: Monaco): void {
  if (themesDefined) return;
  themesDefined = true;
  monaco.editor.defineTheme(ATLAS_DARK_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#111114",
      "editorGutter.background": "#111114",
      "editorLineNumber.foreground": "#52525b",
      "editorLineNumber.activeForeground": "#a1a1aa",
      "editor.lineHighlightBackground": "#ffffff08",
      "editor.lineHighlightBorder": "#00000000",
    },
  });
  monaco.editor.defineTheme(ATLAS_LIGHT_THEME, {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#ffffff",
      "editorLineNumber.foreground": "#a1a1aa",
      "editor.lineHighlightBorder": "#00000000",
    },
  });
}

/** After web fonts load, Monaco must re-measure glyph widths or the cursor drifts. */
export function remeasureWhenFontsReady(monaco: Monaco): void {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  void document.fonts.ready.then(() => monaco.editor.remeasureFonts());
}

/** Monaco theme name following next-themes' resolved theme (dark by default). */
export function useMonacoTheme(): string {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "light" ? ATLAS_LIGHT_THEME : ATLAS_DARK_THEME;
}

/** Unique, URI-safe id for Monaco model paths (two viewers of one file must not share a model). */
export function useModelUri(path: string, suffix = ""): string {
  const id = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const encoded = path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `file:///repoatlas/${id}${suffix}/${encoded}`;
}

export function EditorSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-full w-full flex-col gap-2 p-4", className)} aria-busy="true">
      <span className="sr-only">Loading editor…</span>
      {[72, 54, 88, 40, 66, 80, 35, 58].map((w, i) => (
        <Skeleton key={i} className="h-3.5" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}
