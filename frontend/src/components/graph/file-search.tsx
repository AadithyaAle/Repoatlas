"use client";

import { ListFilter, Search, X } from "lucide-react";
import * as React from "react";

import { ROLE_META } from "@/components/graph/role-badge";
import type { GraphNode } from "@/lib/api/types";
import { dirName, fileName } from "@/lib/graph/layout";
import { cn } from "@/lib/utils";

const MAX_RESULTS = 8;

/** Rank nodes for a query: exact name > name prefix > name substring > path substring. */
export function searchFiles(nodes: readonly GraphNode[], query: string, limit = MAX_RESULTS): GraphNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { node: GraphNode; score: number }[] = [];
  for (const node of nodes) {
    const path = node.path.toLowerCase();
    const name = fileName(path);
    let score: number;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(q)) score = 2;
    else if (path.includes(q)) score = 3;
    else continue;
    scored.push({ node, score });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.node.path.length - b.node.path.length ||
      (a.node.path < b.node.path ? -1 : a.node.path > b.node.path ? 1 : 0),
  );
  return scored.slice(0, limit).map((s) => s.node);
}

export type FileSearchProps = {
  nodes: readonly GraphNode[];
  /** Jump to a file (select + focus). */
  onPick: (path: string) => void;
  /** Filter the graph to paths containing the query. */
  onApplyFilter: (query: string) => void;
  className?: string;
};

type Option = { kind: "filter"; count: number } | { kind: "file"; node: GraphNode };

/** Accessible path autocomplete (ARIA combobox). Press `/` anywhere to focus it. */
export function FileSearch({ nodes, onPick, onApplyFilter, className }: FileSearchProps) {
  const [text, setText] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();
  const deferred = React.useDeferredValue(text);

  const results = React.useMemo(() => searchFiles(nodes, deferred), [nodes, deferred]);
  const matchCount = React.useMemo(() => {
    const terms = deferred.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return 0;
    return nodes.filter((n) => {
      const lower = n.path.toLowerCase();
      return terms.every((t) => lower.includes(t));
    }).length;
  }, [nodes, deferred]);

  const options = React.useMemo<Option[]>(() => {
    if (!deferred.trim()) return [];
    return [{ kind: "filter", count: matchCount }, ...results.map((node) => ({ kind: "file" as const, node }))];
  }, [deferred, matchCount, results]);

  const expanded = open && options.length > 0;
  const activeIndex = Math.min(active, Math.max(options.length - 1, 0));

  // "/" focuses the search box (unless typing somewhere else).
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true], .monaco-editor")) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const choose = (option: Option | undefined) => {
    if (!option) {
      if (text.trim()) onApplyFilter(text.trim());
    } else if (option.kind === "filter") {
      onApplyFilter(text.trim());
    } else {
      onPick(option.node.path);
    }
    setOpen(false);
    setText("");
    setActive(0);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setOpen(true);
        setActive((i) => Math.min(i + 1, Math.max(options.length - 1, 0)));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        event.preventDefault();
        choose(expanded ? options[activeIndex] : undefined);
        break;
      case "Escape":
        if (expanded) {
          event.preventDefault();
          setOpen(false);
        } else if (text) {
          event.preventDefault();
          setText("");
        }
        break;
    }
  };

  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div className={cn("relative min-w-0", className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Search files"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded ? optionId(activeIndex) : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search files…"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(e.target.value.trim() ? 1 : 0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="h-8 w-full min-w-0 rounded-md border border-input bg-transparent pr-14 pl-8 font-mono text-sm shadow-xs outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
      />
      {text ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setText("");
            inputRef.current?.focus();
          }}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
          /
        </kbd>
      )}
      <ul
        id={listId}
        role="listbox"
        aria-label="Matching files"
        hidden={!expanded}
        className="absolute top-full right-0 left-0 z-30 mt-1 max-h-80 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
      >
        {options.map((option, i) => (
          <li
            key={option.kind === "filter" ? "__filter" : option.node.path}
            id={optionId(i)}
            role="option"
            aria-selected={i === activeIndex}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => choose(option)}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm",
              i === activeIndex && "bg-accent text-accent-foreground",
            )}
          >
            {option.kind === "filter" ? (
              <>
                <ListFilter className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  Filter graph to <span className="font-mono">&ldquo;{deferred.trim()}&rdquo;</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {option.count} match{option.count === 1 ? "" : "es"}
                </span>
              </>
            ) : (
              <>
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: ROLE_META[option.node.role].color }}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                  <span className="font-semibold">{fileName(option.node.path)}</span>
                  {dirName(option.node.path) && (
                    <span className="ml-2 text-xs text-muted-foreground">{dirName(option.node.path)}</span>
                  )}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {ROLE_META[option.node.role].label}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
