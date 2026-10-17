"use client";

import type * as React from "react";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

const REMARK_PLUGINS = [remarkGfm];

function MarkdownLink({ node, ...props }: React.ComponentProps<"a"> & ExtraProps) {
  void node;
  return (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary underline underline-offset-4"
    />
  );
}

const COMPONENTS: Components = { a: MarkdownLink };

/**
 * Renders step Markdown (GFM) safely — raw HTML is skipped. Styled with arbitrary child
 * selectors since the project doesn't ship the typography plugin.
 */
export function MarkdownContent({
  children,
  className,
  emptyText,
}: {
  children: string;
  className?: string;
  /** Rendered (muted) when `children` is blank. */
  emptyText?: string;
}) {
  if (children.trim() === "") {
    return emptyText ? (
      <p className={cn("text-sm text-muted-foreground italic", className)}>{emptyText}</p>
    ) : null;
  }
  return (
    <div
      className={cn(
        "text-sm leading-relaxed break-words",
        "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold",
        "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
        "[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-semibold",
        "[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5",
        "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
        "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
        "[&_hr]:my-4 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
    >
      <Markdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS} skipHtml>
        {children}
      </Markdown>
    </div>
  );
}
