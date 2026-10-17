"use client";

import { FileCode2, GitFork, Network, RefreshCcw, Search, Star } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { AnalysisStatusBadge } from "@/components/analysis/analysis-status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { RelativeTime } from "@/components/common/relative-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useRepos } from "@/lib/api/hooks";
import type { RepositorySummary } from "@/lib/api/types";
import { cn, formatNumber } from "@/lib/utils";

function Stat({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5", className)} title={label}>
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{label}:</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export function RepoCard({ summary }: { summary: RepositorySummary }) {
  const { repository: repo, latest_analysis: analysis, tour_count } = summary;
  const cycles = analysis?.cycle_count ?? null;

  return (
    <Card className="gap-4 py-5 transition-colors hover:border-primary/40">
      <CardHeader className="px-5">
        <CardTitle className="flex min-w-0 items-center gap-2 font-mono text-sm">
          <Link
            href={`/repos/${repo.owner}/${repo.name}`}
            className="truncate hover:text-primary hover:underline underline-offset-4"
          >
            <span className="text-muted-foreground">{repo.owner}/</span>
            {repo.name}
          </Link>
        </CardTitle>
        <CardDescription className="line-clamp-2 min-h-10">
          {repo.description ?? "No description."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {analysis && <AnalysisStatusBadge status={analysis.status} />}
          {repo.stars !== null && <Stat icon={Star} label="Stars" value={formatNumber(repo.stars)} />}
          {analysis && (
            <Stat
              icon={FileCode2}
              label="Analyzed files"
              value={
                analysis.analyzed_files === null
                  ? "—"
                  : analysis.truncated && analysis.total_source_files !== null
                    ? `${formatNumber(analysis.analyzed_files)}/${formatNumber(analysis.total_source_files)}`
                    : formatNumber(analysis.analyzed_files)
              }
            />
          )}
          {analysis?.edge_count !== null && analysis?.edge_count !== undefined && (
            <Stat icon={Network} label="Import edges" value={formatNumber(analysis.edge_count)} />
          )}
          {cycles !== null && (
            <Stat
              icon={RefreshCcw}
              label="Circular dependency cycles"
              value={`${cycles} ${cycles === 1 ? "cycle" : "cycles"}`}
              className={cycles > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
            />
          )}
          {tour_count > 0 && (
            <Stat icon={GitFork} label="Tours" value={`${tour_count} ${tour_count === 1 ? "tour" : "tours"}`} />
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {analysis ? (
              <>
                {analysis.branch} · <RelativeTime iso={analysis.finished_at ?? analysis.created_at} />
              </>
            ) : (
              "Not analyzed yet"
            )}
          </span>
          {analysis && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/analyses/${analysis.id}`}>
                {analysis.status === "COMPLETED" ? "Open graph" : "View progress"}
              </Link>
            </Button>
          )}
        </div>
        {analysis?.language_breakdown && (
          <div className="flex flex-wrap gap-1">
            {Object.entries(analysis.language_breakdown)
              .sort(([, a], [, b]) => b - a)
              .map(([lang, count]) => (
                <Badge key={lang} variant="outline" className="font-mono text-[11px] font-normal">
                  {lang} {formatNumber(count)}
                </Badge>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RepoGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-48 rounded-xl" />
      ))}
    </div>
  );
}

export function RecentRepos() {
  const [query, setQuery] = React.useState("");
  const deferredQuery = React.useDeferredValue(query.trim());
  const repos = useRepos({ q: deferredQuery === "" ? null : deferredQuery, limit: 24 });

  return (
    <section aria-labelledby="recent-repos-heading" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="recent-repos-heading" className="text-lg font-semibold tracking-tight">
            Recently analyzed
          </h2>
          <p className="text-sm text-muted-foreground">
            Public repositories other people have mapped. Analyses are cached per commit.
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by owner/name"
            aria-label="Filter repositories"
            maxLength={100}
            className="pl-8"
          />
        </div>
      </div>

      {repos.isPending ? (
        <RepoGridSkeleton />
      ) : repos.isError ? (
        <ErrorState error={repos.error} onRetry={() => void repos.refetch()} />
      ) : repos.data.length === 0 ? (
        <EmptyState
          icon={Search}
          title={deferredQuery ? "No matching repositories" : "No repositories analyzed yet"}
          description={
            deferredQuery
              ? "Try a different filter — or analyze it above."
              : "Paste a GitHub URL above or pick a demo to create the first map."
          }
        />
      ) : (
        <div
          className={cn(
            "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 transition-opacity",
            repos.isPlaceholderData && "opacity-60",
          )}
        >
          {repos.data.map((summary) => (
            <RepoCard key={summary.repository.id} summary={summary} />
          ))}
        </div>
      )}
    </section>
  );
}
