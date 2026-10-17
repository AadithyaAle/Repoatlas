import type { Metadata } from "next";

import { AnalysisView } from "@/components/analysis/analysis-view";

export const metadata: Metadata = { title: "Analysis" };

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AnalysisView analysisId={id} />;
}
