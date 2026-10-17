import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseConfig } from "@/lib/env";

export type BrowserSupabaseClient = SupabaseClient;

let browserClient: BrowserSupabaseClient | null = null;

/**
 * Browser Supabase client (singleton), or `null` when Supabase env vars are not configured —
 * callers must treat auth as disabled in that case.
 */
export function getSupabaseBrowserClient(): BrowserSupabaseClient | null {
  if (!supabaseConfig || typeof window === "undefined") return null;
  browserClient ??= createBrowserClient(supabaseConfig.url, supabaseConfig.key);
  return browserClient;
}

/** Current access token for API calls (Bearer), or `null` when signed out / not configured. */
export async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
