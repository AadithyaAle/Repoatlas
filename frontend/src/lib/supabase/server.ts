import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { supabaseConfig } from "@/lib/env";

/**
 * Supabase client for Server Components, Route Handlers and Server Actions. Returns `null`
 * when Supabase is not configured. Create a new client per request — never share it.
 */
export async function createSupabaseServerClient() {
  if (!supabaseConfig) return null;
  const cookieStore = await cookies();

  return createServerClient(supabaseConfig.url, supabaseConfig.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component: cookies are read-only there. The proxy refreshes
          // the session, so this is safe to ignore.
        }
      },
    },
  });
}
