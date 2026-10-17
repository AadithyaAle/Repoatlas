"use client";

import { BookOpen, FolderGit2, HeartPulse } from "lucide-react";
import Link from "next/link";

import { useSession } from "@/components/auth/auth-provider";
import { SignInPrompt } from "@/components/auth/login-card";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboard } from "@/lib/api/hooks";

function DashboardSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3" aria-busy="true">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-40 rounded-xl" />
      ))}
    </div>
  );
}

/**
 * Dashboard (auth-gated). PLACEHOLDER body — a later feature renders repo analytics, tour health
 * and trainee progress from `useDashboard()`.
 */
export function DashboardView() {
  const { status, isSignedIn } = useSession();
  const dashboard = useDashboard({ enabled: isSignedIn });

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6">
      <PageHeader
        title="Dashboard"
        description="Repo analytics, tour health and trainee progress."
      />

      {status === "loading" ? (
        <DashboardSkeleton />
      ) : !isSignedIn ? (
        <SignInPrompt
          next="/dashboard"
          title={status === "disabled" ? "Sign-in not configured" : "Sign in to see your dashboard"}
          description={
            status === "disabled"
              ? "The dashboard needs an account, and this deployment has no Supabase credentials. Graph exploration still works anonymously."
              : "Your dashboard tracks the repositories you analyzed, the health of tours you own and the tours you're learning from."
          }
        />
      ) : dashboard.isPending ? (
        <DashboardSkeleton />
      ) : dashboard.isError ? (
        <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : dashboard.data.repos.length === 0 &&
        dashboard.data.tours.length === 0 &&
        dashboard.data.learning.length === 0 ? (
        <EmptyState
          icon={FolderGit2}
          title="Nothing here yet"
          description="Analyze a repository and create your first onboarding tour to populate your dashboard."
          action={
            <Button asChild>
              <Link href="/">Analyze a repository</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <SummaryCard icon={FolderGit2} title="Repositories" value={dashboard.data.repos.length} />
          <SummaryCard icon={HeartPulse} title="Tours you own" value={dashboard.data.tours.length} />
          <SummaryCard icon={BookOpen} title="Tours you're taking" value={dashboard.data.learning.length} />
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  title,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: number;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
