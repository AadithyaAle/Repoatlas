/** Error codes emitted by the backend (`app/core/errors.py`) plus client-side codes. */
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "INVALID_REPO_URL",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "ANALYSIS_NOT_READY",
  "GITHUB_REPO_NOT_FOUND",
  "GITHUB_RATE_LIMITED",
  "GITHUB_UNAVAILABLE",
  "REPO_TOO_LARGE",
  "NO_SOURCE_FILES",
  "FILE_NOT_IN_SNAPSHOT",
  "INVALID_LINE_RANGE",
  "AI_DISABLED",
  "AI_FAILED",
  "INTERNAL_ERROR",
  // client-side
  "NETWORK_ERROR",
  "UNEXPECTED_RESPONSE",
] as const;

export type KnownErrorCode = (typeof ERROR_CODES)[number];
/** Unknown future codes are kept as plain strings. */
export type ErrorCode = KnownErrorCode | (string & Record<never, never>);

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(opts: {
    code: ErrorCode;
    message: string;
    status: number;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(opts.message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "ApiError";
    this.code = opts.code;
    this.status = opts.status;
    this.details = opts.details ?? {};
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isUnauthorized(): boolean {
    return this.status === 401 || this.code === "UNAUTHORIZED";
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Human-friendly fallback messages per error code. */
const FRIENDLY: Partial<Record<KnownErrorCode, string>> = {
  NETWORK_ERROR: "Can't reach the RepoAtlas API. Is the backend running?",
  GITHUB_RATE_LIMITED: "GitHub's API rate limit was hit. Try again later or sign in.",
  GITHUB_REPO_NOT_FOUND: "That repository doesn't exist or isn't public.",
  REPO_TOO_LARGE: "That repository is too large to analyze.",
  UNAUTHORIZED: "You need to sign in to do that.",
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "We couldn't find what you were looking for.",
  INTERNAL_ERROR: "Something went wrong on our side.",
};

export function friendlyMessage(code: ErrorCode, fallback?: string): string {
  return fallback || FRIENDLY[code as KnownErrorCode] || "Something went wrong.";
}

/**
 * Turn an `{success, data, error}` envelope (or any error body) into its `data` or throw an
 * `ApiError`. Pure — exported for unit tests.
 */
export function unwrapEnvelope<T>(body: unknown, status: number): T {
  const ok = status >= 200 && status < 300;

  if (isRecord(body) && typeof body.success === "boolean") {
    if (body.success && ok) {
      return (body.data ?? null) as T;
    }
    const err = isRecord(body.error) ? body.error : {};
    const code = typeof err.code === "string" ? err.code : codeFromStatus(status);
    throw new ApiError({
      code,
      message: friendlyMessage(code, typeof err.message === "string" ? err.message : undefined),
      status: ok ? 500 : status,
      details: isRecord(err.details) ? err.details : {},
    });
  }

  // FastAPI default validation error: { detail: [...] }
  if (isRecord(body) && "detail" in body) {
    const detail = body.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail) && isRecord(detail[0]) && typeof detail[0].msg === "string"
          ? detail[0].msg
          : "Request validation failed";
    throw new ApiError({
      code: status === 422 ? "VALIDATION_ERROR" : codeFromStatus(status),
      message,
      status,
      details: { detail },
    });
  }

  throw new ApiError({
    code: ok ? "UNEXPECTED_RESPONSE" : codeFromStatus(status),
    message: ok ? "The API returned an unexpected response." : friendlyMessage(codeFromStatus(status)),
    status,
  });
}

export function codeFromStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
    case 422:
      return "VALIDATION_ERROR";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 413:
      return "REPO_TOO_LARGE";
    case 429:
      return "GITHUB_RATE_LIMITED";
    case 502:
    case 503:
      return "GITHUB_UNAVAILABLE";
    default:
      return "INTERNAL_ERROR";
  }
}

/** Normalise anything thrown into an ApiError (for UI components). */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error) {
    return new ApiError({
      code: "INTERNAL_ERROR",
      message: error.message || "Something went wrong.",
      status: 0,
      cause: error,
    });
  }
  return new ApiError({ code: "INTERNAL_ERROR", message: "Something went wrong.", status: 0 });
}
