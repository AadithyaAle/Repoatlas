"use client";

import { Handle, Position, useStore, type Node, type NodeProps, type ReactFlowState } from "@xyflow/react";
import { TriangleAlert } from "lucide-react";
import * as React from "react";

import { CYCLE_COLOR, LANGUAGE_META, depthColor } from "@/components/graph/graph-style";
import { ROLE_META, RoleBadge } from "@/components/graph/role-badge";
import type { GraphNode } from "@/lib/api/types";
import { dirName, fileName, type LayoutDirection } from "@/lib/graph/layout";
import { cn } from "@/lib/utils";

export type FileNodeData = {
  file: GraphNode;
  folderColor: string;
  direction: LayoutDirection;
  isSelected: boolean;
  /** Faded out (unrelated to the current selection / impact). */
  isDimmed: boolean;
  /** Blast-radius depth: `null` = not impacted, `0` = origin. */
  depth: number | null;
  /** Extra emphasis ring (tour steps). */
  isHighlighted: boolean;
  /** Paint circular nodes in the cycle colour. */
  showCycle: boolean;
};

export type FileFlowNode = Node<FileNodeData, "file">;

/** Below this zoom level nodes render as compact blocks (far fewer DOM nodes to paint). */
const LOD_ZOOM = 0.4;
const zoomedOutSelector = (s: ReactFlowState) => s.transform[2] < LOD_ZOOM;

const HANDLE_STYLE: React.CSSProperties = {
  opacity: 0,
  width: 6,
  height: 6,
  minWidth: 0,
  minHeight: 0,
  border: 0,
  pointerEvents: "none",
};

function FileNodeComponent({ data }: NodeProps<FileFlowNode>) {
  const { file, folderColor, direction, isSelected, isDimmed, depth, isHighlighted, showCycle } = data;
  const zoomedOut = useStore(zoomedOutSelector);
  const name = fileName(file.path);
  const dir = dirName(file.path);
  const impacted = depth !== null;
  const cycleActive = showCycle && file.is_circular;
  const accent = impacted ? depthColor(depth) : cycleActive ? CYCLE_COLOR : null;

  const style: React.CSSProperties = {
    borderLeftColor: folderColor,
    ...(accent ? { borderColor: accent, borderLeftColor: folderColor } : null),
    ...(accent && impacted
      ? { backgroundColor: `color-mix(in oklab, ${accent} 14%, var(--card))` }
      : cycleActive
        ? { backgroundColor: `color-mix(in oklab, ${CYCLE_COLOR} 10%, var(--card))` }
        : null),
  };

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col justify-center overflow-hidden rounded-lg border border-l-4 bg-card text-card-foreground shadow-sm transition-[opacity,box-shadow] duration-200 motion-reduce:transition-none",
        file.is_circular && !accent && "border-red-500/50",
        isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        isHighlighted && !isSelected && "ring-2 ring-brand ring-offset-2 ring-offset-background",
        isHighlighted && "shadow-[0_0_24px_-4px_var(--brand)]",
        isDimmed && "opacity-20",
        zoomedOut ? "px-3" : "gap-1 px-2.5 py-1.5",
      )}
      style={style}
    >
      <Handle
        type="target"
        position={direction === "LR" ? Position.Left : Position.Top}
        isConnectable={false}
        style={HANDLE_STYLE}
      />

      {zoomedOut ? (
        <div className="truncate text-lg font-semibold">{name}</div>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden
              title={LANGUAGE_META[file.language].label}
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: LANGUAGE_META[file.language].color }}
            />
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold">{name}</span>
            {file.parse_warning && (
              <span title={`Parse warning: ${file.parse_warning}`} className="shrink-0 text-amber-500">
                <TriangleAlert className="size-3.5" aria-hidden />
                <span className="sr-only">Parse warning</span>
              </span>
            )}
            {impacted && (
              <span
                className="shrink-0 rounded px-1 font-mono text-[10px] leading-4 font-bold text-zinc-950"
                style={{ backgroundColor: depth === 0 ? "var(--primary)" : accent ?? undefined }}
                title={depth === 0 ? "Blast radius origin" : `Impacted at depth ${depth}`}
              >
                {depth === 0 ? "origin" : `d${depth}`}
              </span>
            )}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">{dir || "/"}</div>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <RoleBadge role={file.role} withTitle={false} />
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
              <span title={`Imported by ${file.in_degree} file(s)`}>{file.in_degree} in</span>
              <span aria-hidden> · </span>
              <span title={`Imports ${file.out_degree} file(s)`}>{file.out_degree} out</span>
            </span>
          </div>
        </>
      )}

      <Handle
        type="source"
        position={direction === "LR" ? Position.Right : Position.Bottom}
        isConnectable={false}
        style={HANDLE_STYLE}
      />
    </div>
  );
}

function sameData(prev: NodeProps<FileFlowNode>, next: NodeProps<FileFlowNode>): boolean {
  const a = prev.data;
  const b = next.data;
  return (
    a === b ||
    (a.file === b.file &&
      a.folderColor === b.folderColor &&
      a.direction === b.direction &&
      a.isSelected === b.isSelected &&
      a.isDimmed === b.isDimmed &&
      a.depth === b.depth &&
      a.isHighlighted === b.isHighlighted &&
      a.showCycle === b.showCycle)
  );
}

/** Custom React Flow node for a source file. Memoised on its visual inputs only. */
export const FileNode = React.memo(FileNodeComponent, sameData);
FileNode.displayName = "FileNode";

/** Accessible label for a file node (read by screen readers when the node is focused). */
export function fileNodeAriaLabel(file: GraphNode, depth: number | null): string {
  const parts = [
    file.path,
    ROLE_META[file.role].label,
    `imported by ${file.in_degree}`,
    `imports ${file.out_degree}`,
  ];
  if (file.is_circular) parts.push("in a circular dependency");
  if (file.parse_warning) parts.push("has parse warning");
  if (depth !== null) parts.push(depth === 0 ? "blast radius origin" : `impacted at depth ${depth}`);
  return parts.join(", ");
}
