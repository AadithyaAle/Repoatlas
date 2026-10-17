import { z } from "zod";

/**
 * Public (browser-exposed) environment. Every `process.env.NEXT_PUBLIC_*` access must be a
 * literal so Next.js can inline it at build time. Invalid or blank values fall back to safe
 * defaults so the app always boots (auth is simply disabled without Supabase).
 */

const DEFAULT_API_URL = "http://localhost:8000";
const DEFAULT_DOCS_URL = "https://aadithyaale.github.io/repoatlas/";
const DEFAULT_SITE_URL = "http://localhost:3000";

const url = z.url({ protocol: /^https?$/ });
const nonEmpty = z.string().trim().min(1);

function blankToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function read<T extends string>(
  name: string,
  schema: z.ZodType<T>,
  raw: string | undefined,
): T | undefined {
  const value = blankToUndefined(raw);
  if (value === undefined) return undefined;
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  console.warn(`[env] Ignoring invalid ${name}: ${result.error.issues[0]?.message ?? "invalid"}`);
  return undefined;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

const supabaseUrl = read("NEXT_PUBLIC_SUPABASE_URL", url, process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseKey =
  read(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    nonEmpty,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ) ?? read("NEXT_PUBLIC_SUPABASE_ANON_KEY", nonEmpty, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export const env = {
  apiUrl: stripTrailingSlash(
    read("NEXT_PUBLIC_API_URL", url, process.env.NEXT_PUBLIC_API_URL) ?? DEFAULT_API_URL,
  ),
  docsUrl: read("NEXT_PUBLIC_DOCS_URL", url, process.env.NEXT_PUBLIC_DOCS_URL) ?? DEFAULT_DOCS_URL,
  siteUrl: stripTrailingSlash(
    read("NEXT_PUBLIC_SITE_URL", url, process.env.NEXT_PUBLIC_SITE_URL) ?? DEFAULT_SITE_URL,
  ),
  supabaseUrl,
  supabaseKey,
  githubRepoUrl: "https://github.com/AadithyaAle/repoatlas",
} as const;

export type SupabaseConfig = { url: string; key: string };

/** Supabase credentials, or `null` when auth is not configured. */
export const supabaseConfig: SupabaseConfig | null =
  supabaseUrl && supabaseKey ? { url: supabaseUrl, key: supabaseKey } : null;

export const isSupabaseConfigured = supabaseConfig !== null;
