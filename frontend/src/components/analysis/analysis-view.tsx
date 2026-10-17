"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  Network,
  RefreshCcw,
  RotateCw,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { AnalysisStatusBadge } from "@/components/analysis/analysis-status-badge";
import { AnalysisStepper } from "@/components/analysis/analysis-stepper";
import { TruncatedBadge } from "@/components/analysis/truncated-badge";
import { useSession } from "@/components/auth/auth-provider";
import { ErrorState } from "@/components/common/error-state";
import { RateLimitBanner } from "@/components/common/rate-limit-banner";
import { RelativeTime } from "@/components/common/relative-time";
import { DEMO_REPOS } from "@/components/explore/demo-repos";
import { GraphWorkspace } from "@/components/graph/graph-workspace";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PIPELINE,
  describeFailure,
  getProgressPercent,
  inferFailedStep,
  type PipelineStatus,
} from "@/lib/analysis-steps";
import { toApiError } from "@/lib/api/errors";
import { queryKeys, useAnalysis, useAnalyzeRepo } from "@/lib/api/hooks";
import type { Analysis } from "@/lib/api/types";
import { formatNumber, shortSha } from "@/lib/utils";

function AnalysisHeader({ analysis }: { analysis: Analysis }) {
  const repo = analysis.repository;
  return (
    <div className="flex flex-col gap-3 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 space-y-2">
        <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Analysis
        </div>
        <h1 className="flex flex-wrap items-center gap-x-3 gap-y-2 text-2xl font-semibold tracking-tight">
          <Link
            href={`/repos/${repo.owner}/${repo.name}`}
            className="truncate font-mono hover:text-primary"
          >
            <span className="text-muted-foreground">{repo.owner}/</span>
            {repo.name}
          </Link>
          <AnalysisStatusBadge status={analysis.status} />
          <TruncatedBadge analysis={analysis} />
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <GitBranch className="size-4" aria-hidden /> {analysis.branch}
          </span>
          <a
            href={`${repo.html_url}/tree/${analysis.commit_sha}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 font-mono hover:text-foreground"
          >
            <GitCommitHorizontal className="size-4" aria-hidden /> {shortSha(analysis.commit_sha)}
          </a>
          <span>
            Started <RelativeTime iso={analysis.created_at} />
          </span>
        </div>
      </div>
      <Button variant="outline" size="sm" asChild>
        <a href={repo.html_url} target="_blank" rel="noreferrer">
          View on GitHub <ExternalLink />
        </a>
      </Button>
    </div>
  );
}

function CompletedStats({ analysis }: { analysis: Analysis }) {
  const stats = [
    { icon: FileCode2, label: "Files", value: formatNumber(analysis.analyzed_files) },
    { icon: Network, label: "Imports", value: formatNumber(analysis.edge_count) },
    { icon: RefreshCcw, label: "Cycles", value: formatNumber(analysis.cycle_count) },
    { icon: ExternalLink, label: "External imports", value: formatNumber(analysis.external_imports) },
  ];
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      {stats.map(({ icon: Icon, label, value }) => (
        <div key={label} className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="size-4" aria-hidden />
          <dt>{label}</dt>
          <dd className="font-medium text-foreground tabular-nums">{value}</dd>
        </div>
      ))}
      {analysis.parse_warning_count ? (
        <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
          <dt>Parse warnings</dt>
          <dd className="font-medium tabular-nums">{analysis.parse_warning_count}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function FailurePanel({
  analysis,
  failedAt,
}: {
  analysis: Analysis;
  failedAt: PipelineStatus;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const analyze = useAnalyzeRepo();
  const { isConfigured, isSignedIn, signInWithGitHub } = useSession();
  const info = describeFailure(analysis.error_code, analysis.error_message);
  const failedLabel = PIPELINE.find((s) => s.status === failedAt)?.label;

  const retry = () => {
    analyze.mutate(
      {
        repo_url: `${analysis.repository.owner}/${analysis.repository.name}`,
        branch: analysis.branch,
        force: true,
      },
      {
        onSuccess: (next) => {
          if (next.id === analysis.id) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.analyses.detail(next.id) });
          } else {
            router.push(`/analyses/${next.id}`);
          }
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <Alert variant="destructive">
        <AlertTitle>{info.title}</AlertTitle>
        <AlertDescription>
          <p>{info.description}</p>
          {info.hint && <p>{info.hint}</p>}
          {failedLabel && (
            <p className="font-mono text-xs opacity-80">
              Failed during: {failedLabel}
              {analysis.error_code ? ` · ${analysis.error_code}` : null}
            </p>
          )}
        </AlertDescription>
      </Alert>
      {analyze.isError && <ErrorState error={analyze.error} compact />}
      <div className="flex flex-wrap items-center gap-2">
        {info.retryable && (
          <Button onClick={retry} disabled={analyze.isPending}>
            <RotateCw className={analyze.isPending ? "animate-spin motion-reduce:animate-none" : undefined} />
            {analyze.isPending ? "Retrying…" : "Retry analysis"}
          </Button>
        )}
        {info.suggestSignIn && isConfigured && !isSignedIn && (
          <Button variant="outline" onClick={() => void signInWithGitHub(`/analyses/${analysis.id}`)}>
            Sign in with GitHub
          </Button>
        )}
        <Button variant={info.retryable ? "ghost" : "default"} asChild>
          <Link href="/">Analyze another repository</Link>
        </Button>
      </div>
      {info.suggestSignIn && (
        <p className="text-sm text-muted-foreground">
          Demo repositories are usually cached:{" "}
          {DEMO_REPOS.slice(0, 3).map((d, i) => (
            <React.Fragment key={d.slug}>
              {i > 0 && ", "}
              <code className="text-xs">{d.slug}</code>
            </React.Fragment>
          ))}
          .
        </p>
      )}
    </div>
  );
}

function ProgressPanel({
  analysis,
  lastActive,
}: {
  analysis: Analysis;
  lastActive: PipelineStatus | null;
}) {
  const failed = analysis.status === "FAILED";
  const failedAt = inferFailedStep({
    lastActiveStatus: lastActive,
    errorCode: analysis.error_code,
    startedAt: analysis.started_at,
  });
  const percent = getProgressPercent(analysis.status);
  const current = PIPELINE.find((s) => s.status === analysis.status);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Card>
        <CardHeader>
          <CardTitle>{failed ? "Analysis failed" : "Mapping the repository…"}</CardTitle>
          <CardDescription>
            {failed
              ? "The pipeline stopped before the graph was ready."
              : "This page updates live. Most repositories take under a minute."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!failed && (
            <div className="space-y-2">
              <Progress value={percent} aria-label="Overall progress" />
              <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                {current?.label ?? analysis.status} · {percent}%
              </p>
            </div>
          )}
          <AnalysisStepper status={analysis.status} failedAt={failedAt} />
        </CardContent>
      </Card>
      <div className="space-y-4">
        {failed ? (
          <FailurePanel analysis={analysis} failedAt={failedAt} />
        ) : (
          <>
            <Card className="bg-card/50">
              <CardHeader>
                <CardTitle className="text-base">What happens next</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>
                  RepoAtlas fetches the file tree at commit{" "}
                  <code className="text-xs">{shortSha(analysis.commit_sha)}</code>, parses every
                  Python/JS/TS file into an AST, resolves imports into a dependency graph, then
                  ranks files and detects circular dependencies.
                </p>
                <p>When it&apos;s done the interactive graph opens right here.</p>
              </CardContent>
            </Card>
            <RateLimitBanner />
          </>
        )}
      </div>
    </div>
  );
}

function AnalysisSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only">Loading analysis…</span>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-80 max-w-full" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-[420px] rounded-xl" />
    </div>
  );
}

/** `/analyses/[id]`: live progress view; renders the graph workspace once COMPLETED. */
export function AnalysisView({ analysisId }: { analysisId: string }) {
  const analysis = useAnalysis(analysisId);

  // Remember the last in-flight status seen while polling, so a FAILED analysis can show the
  // step it died in. ("Adjust state during render" pattern — no effect needed.)
  const status = analysis.data?.status;
  const [lastActive, setLastActive] = React.useState<PipelineStatus | null>(null);
  if (status && status !== "FAILED" && status !== "COMPLETED" && status !== lastActive) {
    setLastActive(status);
  }

  if (analysis.isPending) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <AnalysisSkeleton />
      </div>
    );
  }

  if (analysis.isError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <ErrorState
          error={analysis.error}
          onRetry={() => void analysis.refetch()}
          title={toApiError(analysis.error).status === 404 ? "Analysis not found" : undefined}
        />
      </div>
    );
  }

  const data = analysis.data;
  const completed = data.status === "COMPLETED";

  return (
    <div className={completed ? "mx-auto max-w-[1600px] px-4 py-6 sm:px-6" : "mx-auto max-w-7xl px-4 py-8 sm:px-6"}>
      <div className="space-y-6">
        <AnalysisHeader analysis={data} />
        {completed ? (
          <>
            <CompletedStats analysis={data} />
            <GraphWorkspace analysisId={data.id} className="min-h-[70vh]" />
          </>
        ) : (
          <ProgressPanel analysis={data} lastActive={lastActive} />
        )}
      </div>
    </div>
  );
}
