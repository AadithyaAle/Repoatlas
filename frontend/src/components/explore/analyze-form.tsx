"use client";

import { ArrowRight, GitBranch, Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { DEMO_REPOS } from "@/components/explore/demo-repos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toApiError } from "@/lib/api/errors";
import { useAnalyzeRepo } from "@/lib/api/hooks";
import { BRANCH_MAX_LENGTH, REPO_URL_MAX_LENGTH, parseRepoUrl, validateBranch } from "@/lib/repo-url";
import { cn } from "@/lib/utils";

type FieldErrors = { repoUrl?: string; branch?: string };

export function AnalyzeForm({ className }: { className?: string }) {
  const router = useRouter();
  const analyze = useAnalyzeRepo();
  const repoId = React.useId();
  const branchId = React.useId();
  const errorId = React.useId();

  const [repoUrl, setRepoUrl] = React.useState("");
  const [branch, setBranch] = React.useState("");
  const [showBranch, setShowBranch] = React.useState(false);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [pendingDemo, setPendingDemo] = React.useState<string | null>(null);

  const submit = (url: string, branchValue: string) => {
    const parsed = parseRepoUrl(url);
    const branchError = validateBranch(branchValue);
    const nextErrors: FieldErrors = {
      repoUrl: parsed.ok ? undefined : parsed.error,
      branch: branchError ?? undefined,
    };
    setErrors(nextErrors);
    if (!parsed.ok || branchError) return;

    const trimmedBranch = branchValue.trim();
    analyze.mutate(
      { repo_url: url.trim(), branch: trimmedBranch === "" ? null : trimmedBranch },
      {
        onSuccess: (analysis) => router.push(`/analyses/${analysis.id}`),
        onError: (error) => {
          const apiError = toApiError(error);
          setErrors({ repoUrl: apiError.message });
        },
        onSettled: () => setPendingDemo(null),
      },
    );
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit(repoUrl, branch);
  };

  const onDemo = (slug: string) => {
    setRepoUrl(slug);
    setBranch("");
    setPendingDemo(slug);
    submit(slug, "");
  };

  const busy = analyze.isPending;

  return (
    <div className={cn("space-y-4", className)}>
      <form onSubmit={onSubmit} noValidate className="space-y-3" aria-label="Analyze a repository">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <label htmlFor={repoId} className="sr-only">
              GitHub repository URL
            </label>
            <Input
              id={repoId}
              name="repo_url"
              value={repoUrl}
              onChange={(e) => {
                setRepoUrl(e.target.value);
                if (errors.repoUrl) setErrors((prev) => ({ ...prev, repoUrl: undefined }));
              }}
              onBlur={() => {
                if (repoUrl.trim() === "") return;
                const parsed = parseRepoUrl(repoUrl);
                setErrors((prev) => ({ ...prev, repoUrl: parsed.ok ? undefined : parsed.error }));
              }}
              placeholder="https://github.com/owner/repo  or  owner/repo"
              autoComplete="off"
              spellCheck={false}
              maxLength={REPO_URL_MAX_LENGTH}
              aria-invalid={errors.repoUrl ? true : undefined}
              aria-describedby={errors.repoUrl ? errorId : undefined}
              className="h-11 font-mono text-sm"
              disabled={busy}
            />
          </div>
          <Button type="submit" size="lg" className="h-11" disabled={busy}>
            {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <ArrowRight />}
            {busy ? "Queuing…" : "Analyze"}
          </Button>
        </div>

        {showBranch ? (
          <div className="flex items-center gap-2">
            <label htmlFor={branchId} className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <GitBranch className="size-4" aria-hidden /> Branch
            </label>
            <Input
              id={branchId}
              name="branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="default branch"
              maxLength={BRANCH_MAX_LENGTH}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={errors.branch ? true : undefined}
              className="h-9 max-w-xs font-mono text-sm"
              disabled={busy}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowBranch(true)}
            className="inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground"
          >
            <GitBranch className="size-4" aria-hidden /> Choose a branch (optional)
          </button>
        )}

        {(errors.repoUrl || errors.branch) && (
          <p id={errorId} role="alert" className="text-sm text-destructive">
            {errors.repoUrl ?? errors.branch}
          </p>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Sparkles className="size-4 text-brand" aria-hidden /> Try a demo:
        </span>
        {DEMO_REPOS.map((demo) => (
          <button
            key={demo.slug}
            type="button"
            disabled={busy}
            onClick={() => onDemo(demo.slug)}
            title={`${demo.blurb} · ${demo.language}`}
            className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 font-mono text-xs transition-colors hover:border-primary/50 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
          >
            {pendingDemo === demo.slug && busy ? (
              <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <span
                aria-hidden
                className={cn(
                  "size-2 rounded-full",
                  demo.language === "TypeScript" ? "bg-sky-500" : "bg-amber-500",
                )}
              />
            )}
            {demo.slug}
          </button>
        ))}
      </div>
    </div>
  );
}
