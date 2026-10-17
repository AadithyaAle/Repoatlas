import { describe, expect, it } from "vitest";

import { ApiError, codeFromStatus, isApiError, toApiError, unwrapEnvelope } from "./errors";

function catchError(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected function to throw");
}

describe("unwrapEnvelope", () => {
  it("returns data for a successful envelope", () => {
    const data = { id: "a1", status: "PENDING" };
    expect(unwrapEnvelope({ success: true, data, error: null }, 200)).toEqual(data);
  });

  it("returns null when a successful envelope has no data", () => {
    expect(unwrapEnvelope({ success: true }, 202)).toBeNull();
  });

  it("throws a typed ApiError from an error envelope", () => {
    const err = catchError(() =>
      unwrapEnvelope(
        {
          success: false,
          error: {
            code: "GITHUB_RATE_LIMITED",
            message: "Rate limit exceeded",
            details: { reset_at: "2026-01-01T00:00:00Z" },
          },
        },
        429,
      ),
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(isApiError(err)).toBe(true);
    expect(err.code).toBe("GITHUB_RATE_LIMITED");
    expect(err.message).toBe("Rate limit exceeded");
    expect(err.status).toBe(429);
    expect(err.details).toEqual({ reset_at: "2026-01-01T00:00:00Z" });
  });

  it("treats success:false with a 2xx status as an error", () => {
    const err = catchError(() =>
      unwrapEnvelope({ success: false, error: { code: "CONFLICT", message: "Nope" } }, 200),
    );
    expect(err.code).toBe("CONFLICT");
    expect(err.status).toBe(500);
  });

  it("derives a code from the status when the error body is missing", () => {
    const err = catchError(() => unwrapEnvelope({ success: false }, 404));
    expect(err.code).toBe("NOT_FOUND");
    expect(err.isNotFound).toBe(true);
    expect(err.message.length).toBeGreaterThan(0);
  });

  it("maps FastAPI's raw validation errors", () => {
    const err = catchError(() =>
      unwrapEnvelope(
        { detail: [{ loc: ["body", "repo_url"], msg: "Expected a GitHub URL", type: "value_error" }] },
        422,
      ),
    );
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("Expected a GitHub URL");
    expect(err.status).toBe(422);
  });

  it("rejects non-envelope payloads", () => {
    expect(catchError(() => unwrapEnvelope("<html>", 200)).code).toBe("UNEXPECTED_RESPONSE");
    expect(catchError(() => unwrapEnvelope(undefined, 502)).code).toBe("GITHUB_UNAVAILABLE");
  });
});

describe("codeFromStatus", () => {
  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [409, "CONFLICT"],
    [413, "REPO_TOO_LARGE"],
    [429, "GITHUB_RATE_LIMITED"],
    [500, "INTERNAL_ERROR"],
  ])("maps %i to %s", (status, code) => {
    expect(codeFromStatus(status)).toBe(code);
  });
});

describe("toApiError", () => {
  it("passes ApiErrors through and wraps everything else", () => {
    const original = new ApiError({ code: "NOT_FOUND", message: "x", status: 404 });
    expect(toApiError(original)).toBe(original);
    const wrapped = toApiError(new Error("boom"));
    expect(wrapped.code).toBe("INTERNAL_ERROR");
    expect(wrapped.message).toBe("boom");
    expect(toApiError("weird").status).toBe(0);
  });
});
