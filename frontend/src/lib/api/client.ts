import createClient, { type Middleware } from "openapi-fetch";

import { env } from "@/lib/env";
import { getAccessToken } from "@/lib/supabase/client";

import { ApiError, unwrapEnvelope } from "./errors";
import type { paths } from "./schema";

export { ApiError, isApiError, toApiError, unwrapEnvelope } from "./errors";

/** Attach the Supabase access token as a Bearer token when the user is signed in. */
export const authMiddleware: Middleware = {
  async onRequest({ request }) {
    if (request.headers.has("Authorization")) return request;
    const token = await getAccessToken();
    if (token) request.headers.set("Authorization", `Bearer ${token}`);
    return request;
  },
};

/** Typed OpenAPI client. Paths include the `/api/v1` prefix. */
export const api = createClient<paths>({
  baseUrl: env.apiUrl,
  headers: { Accept: "application/json" },
});
api.use(authMiddleware);

type FetchResult = { data?: unknown; error?: unknown; response: Response };

/** The `data` payload type of an envelope response. */
export type EnvelopeData<E> = E extends { data?: infer D } ? NonNullable<D> : never;

/**
 * Await an openapi-fetch call and unwrap the `{success, data, error}` envelope into `data`,
 * throwing a typed `ApiError` (code, message, status, details) otherwise.
 *
 * @example const analysis = await unwrap(api.GET("/api/v1/analyses/{analysis_id}", {...}));
 */
export async function unwrap<R extends FetchResult>(
  request: Promise<R>,
): Promise<EnvelopeData<NonNullable<R["data"]>>> {
  let result: R;
  try {
    result = await request;
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError({
      code: "NETWORK_ERROR",
      message: "Can't reach the RepoAtlas API. Is the backend running?",
      status: 0,
      cause,
    });
  }
  const body: unknown = result.data ?? result.error;
  return unwrapEnvelope<EnvelopeData<NonNullable<R["data"]>>>(body, result.response.status);
}
