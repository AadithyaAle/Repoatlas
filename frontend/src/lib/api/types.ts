/**
 * Friendly aliases over the generated OpenAPI types. Never hand-write API shapes — derive them
 * from `components["schemas"]` (models) or `paths` (request bodies / query params).
 */
import type { components, paths } from "./schema";

type Schemas = components["schemas"];

// ---- Models ----
export type Meta = Schemas["MetaOut"];
export type RateLimit = Schemas["RateLimitOut"];
export type Repository = Schemas["RepositoryOut"];
export type RepositorySummary = Schemas["RepositorySummaryOut"];
export type Analysis = Schemas["AnalysisOut"];
export type AnalysisStatus = Schemas["AnalysisStatus"];
export type Graph = Schemas["GraphOut"];
export type GraphNode = Schemas["GraphNodeOut"];
export type GraphEdge = Schemas["GraphEdgeOut"];
export type FileContent = Schemas["FileContentOut"];
export type BlastRadius = Schemas["BlastRadiusOut"];
export type RiskLevel = BlastRadius["risk_level"];
export type Language = Schemas["Language"];
export type FileRole = Schemas["FileRole"];
export type ImportKind = Schemas["ImportKind"];
export type DriftStatus = Schemas["DriftStatus"];
export type TourVisibility = Schemas["TourVisibility"];
export type TourSummary = Schemas["TourSummaryOut"];
export type Tour = Schemas["TourOut"];
export type Step = Schemas["StepOut"];
export type CheckpointPublic = Schemas["CheckpointPublicOut"];
export type CheckpointOwner = Schemas["CheckpointOwnerOut"];
export type SyncReport = Schemas["SyncReportOut"];
export type SyncStepResult = Schemas["SyncStepResult"];
export type Answer = Schemas["AnswerOut"];
export type TourProgress = Schemas["TourProgressOut"];
export type Dashboard = Schemas["DashboardOut"];
export type RepoAnalytics = Schemas["RepoAnalyticsOut"];
export type TourHealth = Schemas["TourHealthOut"];
export type TraineeProgress = Schemas["TraineeProgressOut"];
export type AIStepDraft = Schemas["AIStepDraftOut"];
export type ErrorBody = Schemas["ErrorBody"];

// ---- Request bodies (derived from paths so the -Input/-Output schema split can't bite) ----
type Methods = "get" | "post" | "put" | "patch" | "delete";

export type RequestBody<P extends keyof paths, M extends Methods> = paths[P][M] extends {
  requestBody?: { content: { "application/json": infer B } };
}
  ? B
  : never;

export type AnalyzeInput = RequestBody<"/api/v1/repos/analyze", "post">;
export type TourCreateInput = RequestBody<"/api/v1/tours", "post">;
export type TourUpdateInput = RequestBody<"/api/v1/tours/{tour_id}", "patch">;
export type StepCreateInput = RequestBody<"/api/v1/tours/{tour_id}/steps", "post">;
export type StepUpdateInput = RequestBody<"/api/v1/tours/{tour_id}/steps/{step_id}", "patch">;
export type StepReorderInput = RequestBody<"/api/v1/tours/{tour_id}/steps/order", "put">;
export type ResolveDriftInput = RequestBody<
  "/api/v1/tours/{tour_id}/steps/{step_id}/resolve",
  "post"
>;
export type AnswerInput = RequestBody<"/api/v1/tours/{tour_id}/steps/{step_id}/answer", "post">;
export type AIStepDraftInput = RequestBody<"/api/v1/ai/step-draft", "post">;
export type CheckpointInput = NonNullable<StepCreateInput["checkpoint"]>;

export type ReposListParams = NonNullable<paths["/api/v1/repos"]["get"]["parameters"]["query"]>;
export type ToursListParams = NonNullable<paths["/api/v1/tours"]["get"]["parameters"]["query"]>;

/** Narrow a checkpoint to the owner variant (includes the answer). */
export function isOwnerCheckpoint(
  checkpoint: Step["checkpoint"],
): checkpoint is CheckpointOwner {
  return checkpoint !== null && "correct_index" in checkpoint;
}
