import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { api, unwrap } from "./client";
import type {
  AIStepDraftInput,
  Analysis,
  AnalyzeInput,
  AnswerInput,
  ReposListParams,
  ResolveDriftInput,
  StepCreateInput,
  StepUpdateInput,
  ToursListParams,
  Tour,
  TourCreateInput,
  TourUpdateInput,
} from "./types";

/** Statuses after which an analysis never changes again. */
export const TERMINAL_ANALYSIS_STATUSES = ["COMPLETED", "FAILED"] as const;
export const ANALYSIS_POLL_INTERVAL_MS = 1500;

export function isAnalysisTerminal(status: Analysis["status"] | undefined): boolean {
  return status === "COMPLETED" || status === "FAILED";
}

// ---------------------------------------------------------------------------
// Query-key factory — use these everywhere (invalidations, prefetching, tests).
// ---------------------------------------------------------------------------

export const queryKeys = {
  all: ["repoatlas"] as const,
  meta: () => [...queryKeys.all, "meta"] as const,
  rateLimit: () => [...queryKeys.all, "rate-limit"] as const,
  repos: {
    all: () => [...queryKeys.all, "repos"] as const,
    list: (params: ReposListParams = {}) => [...queryKeys.repos.all(), "list", params] as const,
    detail: (owner: string, name: string) =>
      [...queryKeys.repos.all(), "detail", owner, name] as const,
  },
  analyses: {
    all: () => [...queryKeys.all, "analyses"] as const,
    detail: (id: string) => [...queryKeys.analyses.all(), id] as const,
    graph: (id: string) => [...queryKeys.analyses.detail(id), "graph"] as const,
    file: (id: string, path: string) => [...queryKeys.analyses.detail(id), "file", path] as const,
    blastRadius: (id: string, path: string) =>
      [...queryKeys.analyses.detail(id), "blast-radius", path] as const,
  },
  tours: {
    all: () => [...queryKeys.all, "tours"] as const,
    list: (params: ToursListParams = {}) => [...queryKeys.tours.all(), "list", params] as const,
    detail: (id: string) => [...queryKeys.tours.all(), "detail", id] as const,
    progress: (id: string) => [...queryKeys.tours.detail(id), "progress"] as const,
  },
  dashboard: () => [...queryKeys.all, "dashboard"] as const,
};

type QueryToggle = { enabled?: boolean };

// ---------------------------------------------------------------------------
// Query options (reusable for prefetching) + hooks
// ---------------------------------------------------------------------------

export const metaQuery = () =>
  queryOptions({
    queryKey: queryKeys.meta(),
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/meta", { signal })),
    staleTime: 5 * 60_000,
  });

export function useMeta() {
  return useQuery(metaQuery());
}

export const rateLimitQuery = () =>
  queryOptions({
    queryKey: queryKeys.rateLimit(),
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/github/rate-limit", { signal })),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

export function useRateLimit(options: QueryToggle = {}) {
  return useQuery({ ...rateLimitQuery(), enabled: options.enabled ?? true });
}

export const reposQuery = (params: ReposListParams = {}) =>
  queryOptions({
    queryKey: queryKeys.repos.list(params),
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/repos", { params: { query: params }, signal })),
    placeholderData: keepPreviousData,
  });

export function useRepos(params: ReposListParams = {}) {
  return useQuery(reposQuery(params));
}

export const repoQuery = (owner: string, name: string) =>
  queryOptions({
    queryKey: queryKeys.repos.detail(owner, name),
    queryFn: ({ signal }) =>
      unwrap(api.GET("/api/v1/repos/{owner}/{name}", { params: { path: { owner, name } }, signal })),
  });

export function useRepo(owner: string, name: string) {
  return useQuery(repoQuery(owner, name));
}

export const analysisQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.analyses.detail(id),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/api/v1/analyses/{analysis_id}", { params: { path: { analysis_id: id } }, signal }),
      ),
    // Poll every 1.5s until the analysis reaches a terminal state.
    refetchInterval: (query) =>
      isAnalysisTerminal(query.state.data?.status) ? false : ANALYSIS_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

export function useAnalysis(id: string) {
  return useQuery(analysisQuery(id));
}

export const graphQuery = (analysisId: string) =>
  queryOptions({
    queryKey: queryKeys.analyses.graph(analysisId),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/api/v1/analyses/{analysis_id}/graph", {
          params: { path: { analysis_id: analysisId } },
          signal,
        }),
      ),
    // Graphs are immutable per analysis.
    staleTime: Infinity,
  });

export function useGraph(analysisId: string, options: QueryToggle = {}) {
  return useQuery({ ...graphQuery(analysisId), enabled: options.enabled ?? true });
}

export const fileQuery = (analysisId: string, path: string) =>
  queryOptions({
    queryKey: queryKeys.analyses.file(analysisId, path),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/api/v1/analyses/{analysis_id}/file", {
          params: { path: { analysis_id: analysisId }, query: { path } },
          signal,
        }),
      ),
    staleTime: Infinity,
  });

/** Pass `path = null` to disable (e.g. nothing selected yet). */
export function useFile(analysisId: string, path: string | null, options: QueryToggle = {}) {
  return useQuery({
    ...fileQuery(analysisId, path ?? ""),
    enabled: path !== null && path !== "" && (options.enabled ?? true),
  });
}

export const blastRadiusQuery = (analysisId: string, path: string) =>
  queryOptions({
    queryKey: queryKeys.analyses.blastRadius(analysisId, path),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/api/v1/analyses/{analysis_id}/blast-radius", {
          params: { path: { analysis_id: analysisId }, query: { path } },
          signal,
        }),
      ),
    staleTime: Infinity,
  });

/** Pass `path = null` to disable. */
export function useBlastRadius(
  analysisId: string,
  path: string | null,
  options: QueryToggle = {},
) {
  return useQuery({
    ...blastRadiusQuery(analysisId, path ?? ""),
    enabled: path !== null && path !== "" && (options.enabled ?? true),
  });
}

export const toursQuery = (params: ToursListParams = {}) =>
  queryOptions({
    queryKey: queryKeys.tours.list(params),
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/tours", { params: { query: params }, signal })),
  });

export function useTours(params: ToursListParams = {}, options: QueryToggle = {}) {
  return useQuery({ ...toursQuery(params), enabled: options.enabled ?? true });
}

export const tourQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.tours.detail(id),
    queryFn: ({ signal }) =>
      unwrap(api.GET("/api/v1/tours/{tour_id}", { params: { path: { tour_id: id } }, signal })),
  });

export function useTour(id: string) {
  return useQuery(tourQuery(id));
}

export const progressQuery = (tourId: string) =>
  queryOptions({
    queryKey: queryKeys.tours.progress(tourId),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/api/v1/tours/{tour_id}/progress", {
          params: { path: { tour_id: tourId } },
          signal,
        }),
      ),
  });

/** Requires auth — pass `enabled: isSignedIn`. */
export function useProgress(tourId: string, options: QueryToggle = {}) {
  return useQuery({ ...progressQuery(tourId), enabled: options.enabled ?? true });
}

export const dashboardQuery = () =>
  queryOptions({
    queryKey: queryKeys.dashboard(),
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/dashboard", { signal })),
  });

/** Requires auth — pass `enabled: isSignedIn`. */
export function useDashboard(options: QueryToggle = {}) {
  return useQuery({ ...dashboardQuery(), enabled: options.enabled ?? true });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useAnalyzeRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AnalyzeInput) => unwrap(api.POST("/api/v1/repos/analyze", { body })),
    // The analyze form renders errors inline; skip the global error toast.
    meta: { silent: true },
    onSuccess: (analysis) => {
      qc.setQueryData(queryKeys.analyses.detail(analysis.id), analysis);
      void qc.invalidateQueries({ queryKey: queryKeys.repos.all() });
      void qc.invalidateQueries({ queryKey: queryKeys.rateLimit() });
    },
  });
}

export function useCreateTour() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TourCreateInput) => unwrap(api.POST("/api/v1/tours", { body })),
    onSuccess: (tour) => {
      qc.setQueryData(queryKeys.tours.detail(tour.id), tour);
      void qc.invalidateQueries({ queryKey: queryKeys.tours.all() });
      void qc.invalidateQueries({ queryKey: queryKeys.repos.all() });
    },
  });
}

export function useUpdateTour(tourId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TourUpdateInput) =>
      unwrap(api.PATCH("/api/v1/tours/{tour_id}", { params: { path: { tour_id: tourId } }, body })),
    onSuccess: (tour) => {
      qc.setQueryData(queryKeys.tours.detail(tourId), tour);
      void qc.invalidateQueries({ queryKey: [...queryKeys.tours.all(), "list"] });
    },
  });
}

export function useDeleteTour() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tourId: string) =>
      unwrap(api.DELETE("/api/v1/tours/{tour_id}", { params: { path: { tour_id: tourId } } })),
    onSuccess: (_data, tourId) => {
      qc.removeQueries({ queryKey: queryKeys.tours.detail(tourId) });
      void qc.invalidateQueries({ queryKey: queryKeys.tours.all() });
      void qc.invalidateQueries({ queryKey: queryKeys.repos.all() });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard() });
    },
  });
}

function useInvalidateTour(tourId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.tours.detail(tourId) });
    void qc.invalidateQueries({ queryKey: [...queryKeys.tours.all(), "list"] });
  };
}

export function useCreateStep(tourId: string) {
  const invalidate = useInvalidateTour(tourId);
  return useMutation({
    mutationFn: (body: StepCreateInput) =>
      unwrap(
        api.POST("/api/v1/tours/{tour_id}/steps", { params: { path: { tour_id: tourId } }, body }),
      ),
    onSuccess: invalidate,
  });
}

export function useUpdateStep(tourId: string) {
  const invalidate = useInvalidateTour(tourId);
  return useMutation({
    mutationFn: ({ stepId, body }: { stepId: string; body: StepUpdateInput }) =>
      unwrap(
        api.PATCH("/api/v1/tours/{tour_id}/steps/{step_id}", {
          params: { path: { tour_id: tourId, step_id: stepId } },
          body,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteStep(tourId: string) {
  const invalidate = useInvalidateTour(tourId);
  return useMutation({
    mutationFn: (stepId: string) =>
      unwrap(
        api.DELETE("/api/v1/tours/{tour_id}/steps/{step_id}", {
          params: { path: { tour_id: tourId, step_id: stepId } },
        }),
      ),
    onSuccess: invalidate,
  });
}

/** Optimistically reorders `tour.steps`, rolling back on error. */
export function useReorderSteps(tourId: string) {
  const qc = useQueryClient();
  const key = queryKeys.tours.detail(tourId);
  return useMutation({
    mutationFn: (stepIds: string[]) =>
      unwrap(
        api.PUT("/api/v1/tours/{tour_id}/steps/order", {
          params: { path: { tour_id: tourId } },
          body: { step_ids: stepIds },
        }),
      ),
    onMutate: async (stepIds) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Tour>(key);
      if (previous) {
        const byId = new Map(previous.steps.map((s) => [s.id, s]));
        const steps = stepIds.flatMap((id, position) => {
          const step = byId.get(id);
          return step ? [{ ...step, position }] : [];
        });
        qc.setQueryData<Tour>(key, { ...previous, steps });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous);
    },
    onSuccess: (steps) => {
      const current = qc.getQueryData<Tour>(key);
      if (current) qc.setQueryData<Tour>(key, { ...current, steps });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}

export function useSyncTour(tourId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/tours/{tour_id}/sync", { params: { path: { tour_id: tourId } } }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.tours.detail(tourId) });
      void qc.invalidateQueries({ queryKey: [...queryKeys.tours.all(), "list"] });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard() });
    },
  });
}

export function useResolveStep(tourId: string) {
  const invalidate = useInvalidateTour(tourId);
  return useMutation({
    mutationFn: ({ stepId, body }: { stepId: string; body: ResolveDriftInput }) =>
      unwrap(
        api.POST("/api/v1/tours/{tour_id}/steps/{step_id}/resolve", {
          params: { path: { tour_id: tourId, step_id: stepId } },
          body,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useAnswerStep(tourId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ stepId, body }: { stepId: string; body: AnswerInput }) =>
      unwrap(
        api.POST("/api/v1/tours/{tour_id}/steps/{step_id}/answer", {
          params: { path: { tour_id: tourId, step_id: stepId } },
          body,
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.tours.progress(tourId) });
    },
  });
}

export function useAIStepDraft() {
  return useMutation({
    mutationFn: (body: AIStepDraftInput) => unwrap(api.POST("/api/v1/ai/step-draft", { body })),
  });
}
