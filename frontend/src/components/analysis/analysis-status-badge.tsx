import { CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { AnalysisStatus } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const LABELS: Record<AnalysisStatus, string> = {
  PENDING: "Queued",
  FETCHING_TREE: "Fetching tree",
  PARSING_AST: "Parsing",
  COMPUTING_GRAPH: "Computing graph",
  COMPLETED: "Ready",
  FAILED: "Failed",
};

export function analysisStatusLabel(status: AnalysisStatus): string {
  return LABELS[status];
}

export function AnalysisStatusBadge({
  status,
  className,
}: {
  status: AnalysisStatus;
  className?: string;
}) {
  if (status === "COMPLETED") {
    return (
      <Badge variant="success" className={className}>
        <CheckCircle2 aria-hidden /> {LABELS[status]}
      </Badge>
    );
  }
  if (status === "FAILED") {
    return (
      <Badge variant="destructive" className={className}>
        <XCircle aria-hidden /> {LABELS[status]}
      </Badge>
    );
  }
  if (status === "PENDING") {
    return (
      <Badge variant="secondary" className={className}>
        <CircleDashed aria-hidden /> {LABELS[status]}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className={cn("text-primary", className)}>
      <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> {LABELS[status]}
    </Badge>
  );
}
