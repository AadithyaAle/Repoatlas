"use client";

import {
  ArrowRight,
  ArrowUpRight,
  Crown,
  FileCode,
  GitFork,
  LogIn,
  RefreshCcw,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { ProgressBar } from "@/components/charts/progress-bar";
import { StackedBar, type StackedBarSegment } from "@/components/charts/stacked-bar";
import { ROLE_META } from "@/components/graph/role-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { BlastRadius, RepoAnalytics } from "@/lib/api/types";
import {
  ROLE_COLOR_CLASSES,
  languageColorClass,
  languageLabel,
  orderLanguageBreakdown,
  orderRoleBreakdown,
} from "@/lib/dashboard/breakdown";
import { RISK_LEVEL_META } from "@/lib/dashboard/health";
import { cn, formatNumber, shortSha } from "@/lib/utils";

import { RiskLevelBadge } from "./risk-level-badge";

export function fileLink(analysisId: string, path: string): string {
  return `/analyses/${analysisId}?file=${encodeURIComponent(path)}`;
}

function KpiTile({
  icon: Icon,
  label,
  value,
  hint,
  warn = false,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-background/40 p-3" title={hint}>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{label}</span>
        <Icon
          className={cn("size-3.5 shrink-0", warn && "text-amber-500 dark:text-amber-400")}
          aria-hidden
        />
      </div>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          warn && "text-amber-600 dark:text-amber-400",
        )}
      >
        {formatNumber(value)}
      </p>
    </div>
  );
}

function RiskiestFilesTable({
  analysisId,
  files,
}: {
  analysisId: string;
  files: readonly BlastRadius[];
}) {
  if (files.length === 0) {
    return <p className="text-sm text-muted-foreground">No dependents found — nothing is risky yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[36rem] text-sm">
        <caption className="sr-only">
          Riskiest files by blast radius. Select a file to open it in the graph.
        </caption>
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              File
            </th>
            <th scope="col" className="w-40 px-3 py-2 text-left font-medium">
              Risk score
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Level
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Direct
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Transitive
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {files.map((file) => (
            <tr key={file.target} className="transition-colors hover:bg-accent/40">
              <td className="max-w-0 px-3 py-2">
                <Link
                  href={fileLink(analysisId, file.target)}
                  className="group inline-flex max-w-full items-center gap-1 rounded-sm font-mono text-xs hover:text-primary"
                  title={`Open ${file.target} in the graph`}
                >
                  <span className="truncate" dir="rtl">
                    <bdi>{file.target}</bdi>
                  </span>
                  <ArrowUpRight
                    className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                    aria-hidden
                  />
                </Link>
              </td>
              <td className="px-3 py-2">
                <ProgressBar
                  layout="inline"
                  label={`Risk score of ${file.target}`}
                  value={file.risk_score}
                  max={100}
                  valueLabel={file.risk_score.toFixed(1)}
                  indicatorClassName={RISK_LEVEL_META[file.risk_level].bar}
                />
              </td>
              <td className="px-3 py-2">
                <RiskLevelBadge level={file.risk_level} />
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatNumber(file.direct_dependents.length)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatNumber(file.transitive_dependents.length)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Analytics for one repository's latest analysis (dashboard "Repositories" tab). */
export function RepoAnalyticsCard({ analytics }: { analytics: RepoAnalytics }) {
  const { repository: repo } = analytics;

  const roleSegments: StackedBarSegment[] = orderRoleBreakdown(analytics.role_breakdown).map(
    (item) => ({
      key: item.key,
      label: ROLE_META[item.key].label,
      description: ROLE_META[item.key].description,
      value: item.count,
      colorClass: ROLE_COLOR_CLASSES[item.key],
    }),
  );
  const languageSegments: StackedBarSegment[] = orderLanguageBreakdown(
    analytics.language_breakdown,
  ).map((item) => ({
    key: item.key,
    label: languageLabel(item.key),
    value: item.count,
    colorClass: languageColorClass(item.key),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="min-w-0 truncate font-mono text-base">
          <Link
            href={`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`}
            className="rounded-sm hover:text-primary"
          >
            <span className="text-muted-foreground">{repo.owner}/</span>
            {repo.name}
          </Link>
        </CardTitle>
        <CardDescription>
          Latest analysis @{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{shortSha(analytics.commit_sha)}</code>
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/analyses/${analytics.analysis_id}`}>
              Open graph <ArrowRight />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <KpiTile icon={FileCode} label="Files" value={analytics.analyzed_files} />
          <KpiTile icon={GitFork} label="Import edges" value={analytics.edge_count} />
          <KpiTile
            icon={RefreshCcw}
            label="Cycles"
            value={analytics.cycle_count}
            warn={analytics.cycle_count > 0}
            hint="Circular import chains"
          />
          <KpiTile
            icon={Crown}
            label="God modules"
            value={analytics.god_modules}
            warn={analytics.god_modules > 0}
            hint="Files with both many dependents and many dependencies"
          />
          <KpiTile
            icon={LogIn}
            label="Entry points"
            value={analytics.entry_points}
            hint="Files nothing else imports"
          />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="space-y-2" aria-label="Role breakdown">
            <h3 className="text-sm font-medium">File roles</h3>
            <StackedBar label="File roles" segments={roleSegments} />
          </section>
          <section className="space-y-2" aria-label="Language breakdown">
            <h3 className="text-sm font-medium">Languages</h3>
            <StackedBar label="Languages" segments={languageSegments} />
          </section>
        </div>

        <section className="space-y-2" aria-label="Riskiest files">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">Riskiest files</h3>
            <p className="text-xs text-muted-foreground">Ranked by depth-weighted blast radius</p>
          </div>
          <RiskiestFilesTable analysisId={analytics.analysis_id} files={analytics.riskiest_files} />
        </section>
      </CardContent>
    </Card>
  );
}
