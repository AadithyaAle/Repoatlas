"use client";

import { FileDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAnalysis } from "@/lib/api/hooks";
import type { Graph } from "@/lib/api/types";
import { buildArchitectureReport, reportFileName } from "@/lib/report/architecture-report";

/** Downloads an ARCHITECTURE.md summary of the analysis, built entirely in the browser. */
export function ExportReportButton({ graph }: { graph: Graph }) {
  const analysis = useAnalysis(graph.analysis_id);
  const repository = analysis.data?.repository;
  const repo = repository
    ? { owner: repository.owner, name: repository.name, htmlUrl: repository.html_url }
    : null;

  const download = () => {
    const markdown = buildArchitectureReport({ graph, repo, generatedAt: new Date() });
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = reportFileName(repo, graph.commit_sha);
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Architecture report downloaded", { description: link.download });
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={download}
      disabled={graph.nodes.length === 0}
      title="Download a Markdown architecture report (summary, Mermaid diagram, riskiest files, roles, cycles)"
    >
      <FileDown aria-hidden />
      <span className="hidden sm:inline">Export report</span>
      <span className="sr-only sm:hidden">Export architecture report</span>
    </Button>
  );
}
