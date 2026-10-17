"use client";

import { ChevronRight, Info } from "lucide-react";
import * as React from "react";

import { CYCLE_COLOR, DEPTH_COLORS, ORIGIN_COLOR } from "@/components/graph/graph-style";
import { ROLE_META, ROLE_ORDER } from "@/components/graph/role-badge";
import { cn } from "@/lib/utils";

export type GraphLegendProps = {
  showImpact?: boolean;
  showCycles?: boolean;
  className?: string;
};

function EdgeSample({ color, dashed = false }: { color: string; dashed?: boolean }) {
  return (
    <svg width="28" height="8" aria-hidden className="shrink-0">
      <line
        x1="1"
        y1="4"
        x2="27"
        y2="4"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={dashed ? "4 3" : undefined}
      />
    </svg>
  );
}

/** Collapsible legend for role colours, edge styles and blast-radius depths. */
export function GraphLegend({ showImpact = false, showCycles = false, className }: GraphLegendProps) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();

  return (
    <div
      className={cn(
        "w-56 rounded-lg border bg-card/90 text-xs shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/75",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Info className="size-3.5" aria-hidden />
        Legend
        <ChevronRight
          className={cn("ml-auto size-3.5 transition-transform motion-reduce:transition-none", open && "rotate-90")}
          aria-hidden
        />
      </button>
      {open && (
        <div id={id} className="space-y-3 border-t px-2.5 py-2">
          {showImpact && (
            <section className="space-y-1">
              <h4 className="font-medium">Blast radius</h4>
              <ul className="space-y-1">
                {[
                  { label: "origin", text: "Selected file", color: ORIGIN_COLOR },
                  { label: "d1", text: "Direct dependents", color: DEPTH_COLORS[1] },
                  { label: "d2", text: "Depth 2", color: DEPTH_COLORS[2] },
                  { label: "d3+", text: "Depth 3 and beyond", color: DEPTH_COLORS[3] },
                ].map((item) => (
                  <li key={item.label} className="flex items-center gap-2">
                    <span
                      className="w-10 rounded px-1 text-center font-mono text-[10px] font-bold text-zinc-950"
                      style={{ backgroundColor: item.color }}
                    >
                      {item.label}
                    </span>
                    <span className="text-muted-foreground">{item.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="space-y-1">
            <h4 className="font-medium">Roles</h4>
            <ul className="grid grid-cols-2 gap-x-2 gap-y-1">
              {ROLE_ORDER.map((role) => (
                <li key={role} className="flex items-center gap-1.5 text-muted-foreground">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: ROLE_META[role].color }}
                  />
                  {ROLE_META[role].label}
                </li>
              ))}
            </ul>
          </section>
          <section className="space-y-1">
            <h4 className="font-medium">Imports</h4>
            <ul className="space-y-1 text-muted-foreground">
              <li className="flex items-center gap-2">
                <EdgeSample color="var(--muted-foreground)" /> Static import (A → B: A imports B)
              </li>
              <li className="flex items-center gap-2">
                <EdgeSample color="var(--muted-foreground)" dashed /> Dynamic or type-only
              </li>
              <li className={cn("flex items-center gap-2", !showCycles && "opacity-80")}>
                <EdgeSample color={CYCLE_COLOR} /> Circular dependency
              </li>
            </ul>
          </section>
          <p className="text-[11px] text-muted-foreground">
            The coloured left stripe groups files by top-level folder.
          </p>
        </div>
      )}
    </div>
  );
}
