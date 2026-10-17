import { describe, expect, it } from "vitest";

import { ApiError, unwrap } from "./client";

function response(status: number): Response {
  return new Response(null, { status });
}

describe("unwrap", () => {
  it("resolves to the envelope's data on success", async () => {
    const result = Promise.resolve({
      data: { success: true, data: { version: "0.1.0", ai_enabled: false } },
      error: undefined,
      response: response(200),
    });
    await expect(unwrap(result)).resolves.toEqual({ version: "0.1.0", ai_enabled: false });
  });

  it("throws ApiError from the error body of a failed response", async () => {
    const result = Promise.resolve({
      data: undefined,
      error: { success: false, error: { code: "NOT_FOUND", message: "Analysis not found" } },
      response: response(404),
    });
    await expect(unwrap(result)).rejects.toMatchObject({
      name: "ApiError",
      code: "NOT_FOUND",
      status: 404,
      message: "Analysis not found",
    });
  });

  it("wraps fetch failures as NETWORK_ERROR", async () => {
    const error = await unwrap(Promise.reject(new TypeError("Failed to fetch"))).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("NETWORK_ERROR");
    expect((error as ApiError).status).toBe(0);
  });
});
