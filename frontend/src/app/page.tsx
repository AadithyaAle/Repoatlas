import { Clock, FileWarning, GitGraph, Radar, Route } from "lucide-react";

import { RateLimitBanner } from "@/components/common/rate-limit-banner";
import { AnalyzeForm } from "@/components/explore/analyze-form";
import { RecentRepos } from "@/components/explore/recent-repos";

const FEATURES = [
  {
    icon: GitGraph,
    title: "Dependency atlas",
    body: "AST-accurate import graph for Python, JavaScript and TypeScript — entry points, god modules and circular dependencies highlighted.",
  },
  {
    icon: Radar,
    title: "Blast-radius simulator",
    body: "Pick any file and see every module that transitively depends on it, with a risk score before you touch it.",
  },
  {
    icon: Route,
    title: "Self-healing tours",
    body: "Pin onboarding steps to real code. When the code moves, tours re-anchor themselves — or flag exactly what needs review.",
  },
] as const;

export default function ExplorePage() {
  return (
    <div className="relative">
      <div className="bg-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      <div className="mx-auto max-w-7xl space-y-16 px-4 pt-16 pb-20 sm:px-6 sm:pt-24">
        <section className="mx-auto max-w-3xl space-y-8 text-center">
          <div className="space-y-5">
            <p className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-brand" aria-hidden />
              Codebase onboarding, mapped
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Understand any codebase{" "}
              <span className="bg-gradient-to-r from-primary to-brand bg-clip-text text-transparent">
                in minutes, not weeks
              </span>
            </h1>
            <p className="mx-auto max-w-2xl text-base text-pretty text-muted-foreground sm:text-lg">
              Onboarding onto an unfamiliar repository means days of grepping and guessing — and the
              docs that should help are usually stale. RepoAtlas parses the code itself into an
              interactive dependency map, shows what breaks when a file changes, and keeps guided
              tours in sync with the code.
            </p>
          </div>
          <AnalyzeForm className="mx-auto max-w-2xl text-left" />
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" aria-hidden /> Most repos map in under a minute
            </span>
            <span className="inline-flex items-center gap-1.5">
              <FileWarning className="size-3.5" aria-hidden /> Public GitHub repos · Python, JS, TS
            </span>
          </div>
        </section>

        <RateLimitBanner className="mx-auto max-w-3xl" />

        <section aria-label="Features" className="grid gap-4 md:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border bg-card/50 p-5">
              <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden />
              </div>
              <h2 className="font-medium">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>

        <RecentRepos />
      </div>
    </div>
  );
}
