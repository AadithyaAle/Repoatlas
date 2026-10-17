"use client";

import {
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  FolderSearch,
  GitBranch,
  Loader2,
  RotateCw,
  Route,
  Star,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";

import { AnalysisStatusBadge } from "@/components/analysis/analysis-status-badge";
import { TruncatedBadge } from "@/components/analysis/truncated-badge";
import { useSession } from "@/components/auth/auth-provider";
import { DonutGauge } from "@/components/charts/donut-gauge";
import { StackedBar, type StackedBarSegment } from "@/components/charts/stacked-bar";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { RelativeTime } from "@/components/common/relative-time";
import { DriftCountList } from "@/components/dashboard/drift-count-list";
import { CreateTourDialog } from "@/components/tours/create-tour-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { isApiError, toApiError } from "@/lib/api/errors";
import { isAnalysisTerminal, useAnalysis, useAnalyzeRepo, useRepo, useTours } from "@/lib/api/hooks";
import type { Analysis, Repository, RepositorySummary, TourSummary } from "@/lib/api/types";
import {
  languageColorClass,
  languageLabel,
  orderLanguageBreakdown,
} from "@/lib/dashboard/breakdown";
import { formatPercent } from "@/lib/dashboard/format";
import { HEALTH_TONE_META, healthTone, healthyShare } from "@/lib/dashboard/health";
import { cn, formatNumber, shortSha } from "@/lib/utils";

function repoSlug(repository: Pick<Repository, "owner" | "name">): string {
  return `${repository.owner}/${repository.name}`;
}

/** Queue an analysis (optionally forced) and navigate to its progress page. */
function useAnalyzeAndOpen() {
  const router = useRouter();
  const analyze = useAnalyzeRepo();
  const run = (input: { slug: string; branch?: string | null; force?: boolean }) =>
    analyze.mutate(
      { repo_url: input.slug, branch: input.branch ?? null, force: input.force ?? false },
      {
        onSuccess: (analysis) => router.push(`/analyses/${analysis.id}`),
        onError: (error) => toast.error(toApiError(error).message),
      },
    );
  return { run, isPending: analyze.isPending };
}

// ---------------------------------------------------------------------------
// Tours
// ---------------------------------------------------------------------------

function TourRow({ tour }: { tour: TourSummary }) {
  const share = tour.step_count > 0 ? healthyShare(tour.health) : null;
  const toneMeta = HEALTH_TONE_META[healthTone(share)];

  return (
    <li>
      <Link
        href={`/tours/${tour.id}`}
        className="flex items-center gap-4 rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
      >
        <DonutGauge
          value={share}
          label={`Health of ${tour.title}`}
          size={44}
          strokeWidth={5}
          indicatorClassName={toneMeta.stroke}
        >
          <span className={cn("text-[11px] font-semibold tabular-nums", toneMeta.text)}>
            {share === null ? "—" : formatPercent(share)}
          </span>
        </DonutGauge>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium">{tour.title}</p>
            {tour.visibility === "PRIVATE" && <Badge variant="outline">Private</Badge>}
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {tour.step_count} {tour.step_count === 1 ? "step" : "steps"}
            {tour.owner_login ? ` · by @${tour.owner_login}` : null} · updated{" "}
            <RelativeTime iso={tour.updated_at} />
          </p>
          <DriftCountList counts={tour.health} noTooltip />
        </div>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}

function CreateTourAction({ analysis, repositoryLabel }: { analysis: Analysis | null; repositoryLabel: string }) {
  const { status, isSignedIn } = useSession();
  const pathname = usePathname();
  if (!analysis || analysis.status !== "COMPLETED" || status === "disabled" || status === "loading") {
    return null;
  }
  if (!isSignedIn) {
    return (
      <Button variant="outline" size="sm" asChild>
        <Link href={`/login?next=${encodeURIComponent(pathname)}`}>Sign in to create a tour</Link>
      </Button>
    );
  }
  return <CreateTourDialog analysisId={analysis.id} repositoryLabel={repositoryLabel} />;
}

function ToursSection({
  repository,
  analysis,
}: {
  repository: Repository;
  analysis: Analysis | null;
}) {
  const tours = useTours({ repository_id: repository.id });
  const canCreate = analysis?.status === "COMPLETED";

  return (
    <section aria-labelledby="tours-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="tours-heading" className="text-lg font-semibold tracking-tight">
          Onboarding tours
          {tours.data && tours.data.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
              {tours.data.length}
            </span>
          )}
        </h2>
        <CreateTourAction analysis={analysis} repositoryLabel={repoSlug(repository)} />
      </div>
      {tours.isPending ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : tours.isError ? (
        <ErrorState error={tours.error} onRetry={() => void tours.refetch()} compact />
      ) : tours.data.length === 0 ? (
        <EmptyState
          icon={Route}
          title="No tours yet"
          description={
            canCreate
              ? "Tours walk newcomers through the code step by step. Create the first one for this repository."
              : "Tours walk newcomers through the code step by step. They can be created once an analysis has completed."
          }
          action={
            canCreate && analysis ? (
              <Button variant="outline" asChild>
                <Link href={`/analyses/${analysis.id}`}>Explore the graph first</Link>
              </Button>
            ) : undefined
          }
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

// ---------------------------------------------------------------------------
// Latest analysis
// ---------------------------------------------------------------------------

function AnalysisStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{formatNumber(value)}</dd>
    </div>
  );
}

function LatestAnalysisCard({
  repository,
  analysis,
}: {
  repository: Repository;
  analysis: Analysis | null;
}) {
  const analyze = useAnalyzeAndOpen();

  if (!analysis) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Latest analysis</CardTitle>
          <CardDescription>This repository hasn&apos;t been analyzed yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            disabled={analyze.isPending}
            onClick={() => analyze.run({ slug: repoSlug(repository) })}
          >
            {analyze.isPending ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" />
            ) : (
              <ArrowRight />
            )}
            Analyze it
          </Button>
        </CardContent>
      </Card>
    );
  }

  const completed = analysis.status === "COMPLETED";
  const languages: StackedBarSegment[] = orderLanguageBreakdown(analysis.language_breakdown).map(
    (item) => ({
      key: item.key,
      label: languageLabel(item.key),
      value: item.count,
      colorClass: languageColorClass(item.key),
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Latest analysis
          <AnalysisStatusBadge status={analysis.status} />
          <TruncatedBadge analysis={analysis} />
        </CardTitle>
        <CardDescription>
          <span className="inline-flex items-center gap-1">
            <GitBranch className="size-3.5" aria-hidden /> {analysis.branch}
          </span>{" "}
          @ <code className="text-xs">{shortSha(analysis.commit_sha)}</code> ·{" "}
          <RelativeTime iso={analysis.finished_at ?? analysis.created_at} />
        </CardDescription>
        <CardAction className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={analyze.isPending || !isAnalysisTerminal(analysis.status)}
            onClick={() =>
              analyze.run({ slug: repoSlug(repository), branch: analysis.branch, force: true })
            }
            title="Re-run the analysis against the latest commit"
          >
            {analyze.isPending ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" />
            ) : (
              <RotateCw />
            )}
            Re-analyze
          </Button>
          <Button size="sm" asChild>
            <Link href={`/analyses/${analysis.id}`}>
              {completed ? "Open graph" : "View progress"} <ArrowRight />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        {analysis.status === "FAILED" && (
          <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {analysis.error_message ?? "The analysis failed."}
              {analysis.error_code && (
                <span className="ml-1 font-mono text-xs opacity-70">({analysis.error_code})</span>
              )}
            </span>
          </p>
        )}
        {completed && (
          <>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <AnalysisStat label="Files analyzed" value={analysis.analyzed_files} />
              <AnalysisStat label="Import edges" value={analysis.edge_count} />
              <AnalysisStat label="Cycles" value={analysis.cycle_count} />
              <AnalysisStat label="External imports" value={analysis.external_imports} />
            </dl>
            {languages.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Languages</h3>
                <StackedBar label="Languages" segments={languages} />
              </div>
            )}
          </>
        )}
        {!completed && analysis.status !== "FAILED" && (
          <p className="text-sm text-muted-foreground">
            The analysis is still running — open it to follow progress live.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function RepoContent({ repository, analysis }: { repository: Repository; analysis: Analysis | null }) {
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
            {repository.default_branch && (
              <Badge variant="outline" title="Default branch">
                <GitBranch aria-hidden /> {repository.default_branch}
              </Badge>
            )}
            {repository.stars !== null && (
              <Badge variant="outline" title={`${repository.stars.toLocaleString("en")} stars`}>
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
      <LatestAnalysisCard repository={repository} analysis={analysis} />
      <ToursSection repository={repository} analysis={analysis} />
    </div>
  );
}

/** Keeps the latest analysis fresh (polls while it's still running). */
function RepoWithLiveAnalysis({
  repository,
  initial,
}: {
  repository: Repository;
  initial: Analysis;
}) {
  const live = useAnalysis(initial.id);
  return <RepoContent repository={repository} analysis={live.data ?? initial} />;
}

function RepoBody({ summary }: { summary: RepositorySummary }) {
  const { repository, latest_analysis: analysis } = summary;
  if (!analysis) return <RepoContent repository={repository} analysis={null} />;
  return <RepoWithLiveAnalysis repository={repository} initial={analysis} />;
}

function RepoNotFound({ owner, name }: { owner: string; name: string }) {
  const analyze = useAnalyzeAndOpen();
  const slug = `${owner}/${name}`;
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <EmptyState
        icon={FolderSearch}
        title={`${slug} hasn't been analyzed yet`}
        description="RepoAtlas only knows about repositories someone has analyzed. If it's a public GitHub repository, you can analyze it now."
        action={
          <>
            <Button disabled={analyze.isPending} onClick={() => analyze.run({ slug })}>
              {analyze.isPending ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" />
              ) : (
                <ArrowRight />
              )}
              Analyze {slug}
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/">Back to Explore</Link>
            </Button>
          </>
        }
      />
    </div>
  );
}

/** `/repos/[owner]/[name]`: repository header, latest analysis and its onboarding tours. */
export function RepoView({ owner, name }: { owner: string; name: string }) {
  const repo = useRepo(owner, name);

  if (repo.isPending) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-10 sm:px-6" aria-busy="true">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    );
  }

  if (repo.isError) {
    const error = repo.error;
    if (isApiError(error) && (error.code === "NOT_FOUND" || error.isNotFound)) {
      return <RepoNotFound owner={owner} name={name} />;
    }
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <ErrorState error={error} onRetry={() => void repo.refetch()} />
      </div>
    );
  }

  return <RepoBody summary={repo.data} />;
}
