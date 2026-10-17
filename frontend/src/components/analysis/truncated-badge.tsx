"use client";

import { Scissors } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Analysis } from "@/lib/api/types";
import { formatNumber } from "@/lib/utils";

/** "Scoped to top N source files" — shown when the backend capped the analysis. */
export function TruncatedBadge({
  analysis,
}: {
  analysis: Pick<Analysis, "truncated" | "analyzed_files" | "total_source_files">;
}) {
  if (!analysis.truncated || analysis.analyzed_files === null) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="warning" tabIndex={0}>
          <Scissors aria-hidden /> Scoped to top {formatNumber(analysis.analyzed_files)} source files
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        This repository has {formatNumber(analysis.total_source_files)} source files; the analysis
        was limited to the {formatNumber(analysis.analyzed_files)} most relevant ones.
      </TooltipContent>
    </Tooltip>
  );
}
