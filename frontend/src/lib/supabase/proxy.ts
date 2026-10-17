import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { supabaseConfig } from "@/lib/env";

/**
 * Refresh the Supabase auth session on every matched request (called from `src/proxy.ts`).
 * No-op when Supabase is not configured so the app keeps working anonymously.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  if (!supabaseConfig) return response;

  const supabase = createServerClient(supabaseConfig.url, supabaseConfig.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Do not run code between createServerClient and getClaims(): it revalidates the JWT and
  // triggers the cookie refresh above.
  try {
    await supabase.auth.getClaims();
  } catch {
    // Network hiccup talking to Supabase — continue anonymously rather than failing the page.
  }

  return response;
}
