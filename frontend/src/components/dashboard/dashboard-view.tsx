"use client";

import { BookOpen, FolderGit2, GraduationCap, HeartPulse, Lock, Route } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { useSession } from "@/components/auth/auth-provider";
import { SignInPrompt } from "@/components/auth/login-card";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDashboard } from "@/lib/api/hooks";
import type { Dashboard } from "@/lib/api/types";

import { LearningList } from "./learning-list";
import { RepoAnalyticsCard } from "./repo-analytics-card";
import { TourHealthCard } from "./tour-health-card";

type TabValue = "repos" | "tours" | "learning";

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
      <Skeleton className="h-9 w-80 max-w-full rounded-lg" />
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}

function defaultTab(data: Dashboard): TabValue {
  if (data.repos.length > 0) return "repos";
  if (data.tours.length > 0) return "tours";
  return "learning";
}

function CountPill({ value }: { value: number }) {
  return (
    <span className="rounded-full bg-muted px-1.5 text-[11px] leading-4 font-medium tabular-nums text-muted-foreground">
      {value}
    </span>
  );
}

function ReposPanel({ data }: { data: Dashboard }) {
  if (data.repos.length === 0) {
    return (
      <EmptyState
        icon={FolderGit2}
        title="No analyzed repositories"
        description="Analyze a public GitHub repository to see its architecture metrics, file roles and riskiest files here."
        action={
          <Button asChild>
            <Link href="/">Analyze a repository</Link>
          </Button>
        }
      />
    );
  }
  return (
    <div className="space-y-6">
      {data.repos.map((repo) => (
        <RepoAnalyticsCard key={repo.analysis_id} analytics={repo} />
      ))}
    </div>
  );
}

function ToursPanel({ data }: { data: Dashboard }) {
  if (data.tours.length === 0) {
    const firstRepo = data.repos[0]?.repository;
    return (
      <EmptyState
        icon={Route}
        title="You don't own any tours yet"
        description="Tours walk newcomers through a codebase step by step — and RepoAtlas keeps them in sync as the code changes."
        action={
          firstRepo ? (
            <Button asChild>
              <Link
                href={`/repos/${encodeURIComponent(firstRepo.owner)}/${encodeURIComponent(firstRepo.name)}`}
              >
                Create a tour for {firstRepo.owner}/{firstRepo.name}
              </Link>
            </Button>
          ) : (
            <Button asChild>
              <Link href="/">Analyze a repository first</Link>
            </Button>
          )
        }
      />
    );
  }
  return (
    <div className="space-y-4">
      {data.tours.map((item) => (
        <TourHealthCard key={item.tour.id} item={item} />
      ))}
    </div>
  );
}

function LearningPanel({ data }: { data: Dashboard }) {
  if (data.learning.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="You're not taking any tours"
        description="Open a tour shared by your team (or any public tour) and your progress will show up here."
        action={
          <Button variant="outline" asChild>
            <Link href="/">Explore repositories</Link>
          </Button>
        }
      />
    );
  }
  return <LearningList items={data.learning} />;
}

function DashboardTabs({ data }: { data: Dashboard }) {
  return (
    <Tabs defaultValue={defaultTab(data)} className="gap-6">
      <TabsList className="max-w-full overflow-x-auto">
        <TabsTrigger value="repos">
          <FolderGit2 /> Repositories <CountPill value={data.repos.length} />
        </TabsTrigger>
        <TabsTrigger value="tours">
          <HeartPulse /> Tour health <CountPill value={data.tours.length} />
        </TabsTrigger>
        <TabsTrigger value="learning">
          <BookOpen /> My learning <CountPill value={data.learning.length} />
        </TabsTrigger>
      </TabsList>
      <TabsContent value="repos">
        <ReposPanel data={data} />
      </TabsContent>
      <TabsContent value="tours">
        <ToursPanel data={data} />
      </TabsContent>
      <TabsContent value="learning">
        <LearningPanel data={data} />
      </TabsContent>
    </Tabs>
  );
}

/** `/dashboard` (auth-gated): repo analytics, tour health + trainees, and the user's learning. */
export function DashboardView() {
  const { status, isSignedIn } = useSession();
  const dashboard = useDashboard({ enabled: isSignedIn });

  let body: ReactNode;
  if (status === "disabled") {
    body = (
      <EmptyState
        icon={Lock}
        title="Accounts aren't configured on this deployment"
        description={
          <>
            The dashboard needs a signed-in user, and this RepoAtlas instance has no Supabase
            credentials (<code className="text-xs">NEXT_PUBLIC_SUPABASE_URL</code> and a publishable
            key). Graph exploration and public tours still work anonymously.
          </>
        }
        action={
          <Button asChild>
            <Link href="/">Analyze a repository</Link>
          </Button>
        }
      />
    );
  } else if (status === "loading") {
    body = <DashboardSkeleton />;
  } else if (!isSignedIn) {
    body = (
      <SignInPrompt
        next="/dashboard"
        title="Sign in to see your dashboard"
        description="Your dashboard tracks the repositories you analyzed, the health of tours you own and the tours you're learning from."
      />
    );
  } else if (dashboard.isPending) {
    body = <DashboardSkeleton />;
  } else if (dashboard.isError) {
    body = <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  } else if (
    dashboard.data.repos.length === 0 &&
    dashboard.data.tours.length === 0 &&
    dashboard.data.learning.length === 0
  ) {
    body = (
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
    );
  } else {
    body = <DashboardTabs data={dashboard.data} />;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6">
      <PageHeader
        title="Dashboard"
        description="Repo analytics, tour health and trainee progress."
      />
      {body}
    </div>
  );
}
