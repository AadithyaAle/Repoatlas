"use client";

import { ArrowRight, ExternalLink, Route, Star } from "lucide-react";
import Link from "next/link";

import { AnalysisStatusBadge } from "@/components/analysis/analysis-status-badge";
import { TruncatedBadge } from "@/components/analysis/truncated-badge";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { RelativeTime } from "@/components/common/relative-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRepo, useTours } from "@/lib/api/hooks";
import type { TourSummary } from "@/lib/api/types";
import { formatNumber, shortSha } from "@/lib/utils";

function TourRow({ tour }: { tour: TourSummary }) {
  return (
    <li>
      <Link
        href={`/tours/${tour.id}`}
        className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
      >
        <div className="min-w-0">
          <p className="truncate font-medium">{tour.title}</p>
          <p className="truncate text-sm text-muted-foreground">
            {tour.step_count} steps
            {tour.owner_login ? ` · by ${tour.owner_login}` : null} · updated{" "}
            <RelativeTime iso={tour.updated_at} />
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {tour.visibility === "PRIVATE" && <Badge variant="outline">Private</Badge>}
          <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
        </div>
      </Link>
    </li>
  );
}

function ToursSection({ repositoryId }: { repositoryId: string }) {
  const tours = useTours({ repository_id: repositoryId });

  return (
    <section aria-labelledby="tours-heading" className="space-y-3">
      <h2 id="tours-heading" className="text-lg font-semibold tracking-tight">
        Onboarding tours
      </h2>
      {tours.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : tours.isError ? (
        <ErrorState error={tours.error} onRetry={() => void tours.refetch()} compact />
      ) : tours.data.length === 0 ? (
        <EmptyState
          icon={Route}
          title="No tours yet"
          description="Tours walk newcomers through the code step by step. Open the graph to start one."
        />
      ) : (
        <ul className="space-y-2">
          {tours.data.map((tour) => (
            <TourRow key={tour.id} tour={tour} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** `/repos/[owner]/[name]`: summary, latest analysis and tours (tour list is basic for now). */
export function RepoView({ owner, name }: { owner: string; name: string }) {
  const repo = useRepo(owner, name);

  if (repo.isPending) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-10 sm:px-6" aria-busy="true">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  if (repo.isError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <ErrorState error={repo.error} onRetry={() => void repo.refetch()} />
      </div>
    );
  }

  const { repository, latest_analysis: analysis } = repo.data;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow="Repository"
        title={
          <span className="font-mono">
            <span className="text-muted-foreground">{repository.owner}/</span>
            {repository.name}
          </span>
        }
        description={repository.description ?? undefined}
        actions={
          <>
            {repository.stars !== null && (
              <Badge variant="outline">
                <Star aria-hidden /> {formatNumber(repository.stars)}
              </Badge>
            )}
            <Button variant="outline" size="sm" asChild>
              <a href={repository.html_url} target="_blank" rel="noreferrer">
                GitHub <ExternalLink />
              </a>
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Latest analysis</CardTitle>
          <CardDescription>
            {analysis ? (
              <>
                {analysis.branch} @ <code className="text-xs">{shortSha(analysis.commit_sha)}</code> ·{" "}
                <RelativeTime iso={analysis.finished_at ?? analysis.created_at} />
              </>
            ) : (
              "This repository hasn't been analyzed yet."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          {analysis ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <AnalysisStatusBadge status={analysis.status} />
                <TruncatedBadge analysis={analysis} />
                <span>{formatNumber(analysis.analyzed_files)} files</span>
                <span>· {formatNumber(analysis.edge_count)} imports</span>
                <span>· {formatNumber(analysis.cycle_count)} cycles</span>
              </div>
              <Button asChild>
                <Link href={`/analyses/${analysis.id}`}>
                  {analysis.status === "COMPLETED" ? "Open graph" : "View progress"} <ArrowRight />
                </Link>
              </Button>
            </>
          ) : (
            <Button asChild>
              <Link href="/">Analyze it</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <ToursSection repositoryId={repository.id} />
    </div>
  );
}
