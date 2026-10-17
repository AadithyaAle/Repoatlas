import type { AnalysisStatus } from "@/lib/api/types";

export type PipelineStatus = Exclude<AnalysisStatus, "FAILED">;
export type StepState = "complete" | "current" | "upcoming" | "failed";

export const PIPELINE: readonly { status: PipelineStatus; label: string; description: string }[] = [
  { status: "PENDING", label: "Queued", description: "Waiting for a worker to pick up the job" },
  {
    status: "FETCHING_TREE",
    label: "Fetching tree",
    description: "Resolving the commit and listing source files via the GitHub API",
  },
  {
    status: "PARSING_AST",
    label: "Parsing ASTs",
    description: "Extracting imports, exports, functions and classes",
  },
  {
    status: "COMPUTING_GRAPH",
    label: "Computing graph",
    description: "Resolving imports, detecting cycles, ranking files",
  },
  { status: "COMPLETED", label: "Ready", description: "Dependency graph is ready to explore" },
];

const ORDER: Record<PipelineStatus, number> = {
  PENDING: 0,
  FETCHING_TREE: 1,
  PARSING_AST: 2,
  COMPUTING_GRAPH: 3,
  COMPLETED: 4,
};

/** Error codes that can only happen while talking to GitHub (i.e. while fetching the tree). */
const FETCH_PHASE_ERRORS = new Set([
  "GITHUB_REPO_NOT_FOUND",
  "GITHUB_RATE_LIMITED",
  "GITHUB_UNAVAILABLE",
  "REPO_TOO_LARGE",
  "NO_SOURCE_FILES",
]);

/**
 * Best guess of the step a FAILED analysis died in: the last status observed while polling
 * wins; otherwise infer from the error code / whether a worker ever started it.
 */
export function inferFailedStep(opts: {
  lastActiveStatus?: PipelineStatus | null;
  errorCode?: string | null;
  startedAt?: string | null;
}): PipelineStatus {
  if (opts.lastActiveStatus && opts.lastActiveStatus !== "COMPLETED") {
    return opts.lastActiveStatus;
  }
  if (opts.errorCode && FETCH_PHASE_ERRORS.has(opts.errorCode)) return "FETCHING_TREE";
  if (!opts.startedAt) return "PENDING";
  return "PARSING_AST";
}

/** Map an analysis status onto per-step visual states for the stepper. */
export function getStepStates(
  status: AnalysisStatus,
  failedAt: PipelineStatus = "PENDING",
): { status: PipelineStatus; state: StepState }[] {
  if (status === "FAILED") {
    const failedIndex = ORDER[failedAt];
    return PIPELINE.map(({ status: s }) => ({
      status: s,
      state: ORDER[s] < failedIndex ? "complete" : ORDER[s] === failedIndex ? "failed" : "upcoming",
    }));
  }
  const current = ORDER[status];
  return PIPELINE.map(({ status: s }) => ({
    status: s,
    state:
      status === "COMPLETED" || ORDER[s] < current
        ? "complete"
        : ORDER[s] === current
          ? "current"
          : "upcoming",
  }));
}

/** 0–100 progress for a progress bar. */
export function getProgressPercent(status: AnalysisStatus): number {
  if (status === "FAILED") return 100;
  return Math.round((ORDER[status] / (PIPELINE.length - 1)) * 100);
}

export type FailureInfo = {
  title: string;
  description: string;
  hint?: string;
  retryable: boolean;
  /** Suggest signing in (raises the GitHub quota for the user). */
  suggestSignIn?: boolean;
};

export function describeFailure(code: string | null | undefined, message?: string | null): FailureInfo {
  switch (code) {
    case "GITHUB_RATE_LIMITED":
      return {
        title: "GitHub rate limit reached",
        description:
          message ?? "The server ran out of GitHub API quota while fetching this repository.",
        hint: "Wait for the quota to reset, sign in, or try one of the demo repositories (often cached).",
        retryable: true,
        suggestSignIn: true,
      };
    case "GITHUB_REPO_NOT_FOUND":
      return {
        title: "Repository not found",
        description: message ?? "The repository or branch doesn't exist, or it isn't public.",
        hint: "Check the owner/name and branch spelling. Private repositories aren't supported.",
        retryable: false,
      };
    case "REPO_TOO_LARGE":
      return {
        title: "Repository too large",
        description: message ?? "This repository exceeds the analysis size limits.",
        hint: "Try a smaller repository or a branch with fewer source files.",
        retryable: false,
      };
    case "NO_SOURCE_FILES":
      return {
        title: "No supported source files",
        description:
          message ?? "We couldn't find any Python, JavaScript or TypeScript files to analyze.",
        retryable: false,
      };
    case "GITHUB_UNAVAILABLE":
      return {
        title: "GitHub is unavailable",
        description: message ?? "GitHub's API didn't respond. This is usually temporary.",
        retryable: true,
      };
    default:
      return {
        title: "Analysis failed",
        description: message ?? "Something went wrong while analyzing this repository.",
        retryable: true,
      };
  }
}
