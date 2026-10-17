import { type NextRequest, NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/utils";

/** OAuth (PKCE) callback: exchange `?code=` for a session cookie, then go to `?next=`. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");

  const fail = (message: string) => {
    const url = new URL("/login", origin);
    url.searchParams.set("error", message);
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  };

  if (providerError) return fail(providerError);
  if (!code) return fail("Missing authorization code.");

  const supabase = await createSupabaseServerClient();
  if (!supabase) return fail("Sign-in is not configured.");

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail(error.message);

  // Behind a load balancer the public host is in x-forwarded-host.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocal = process.env.NODE_ENV === "development";
  const base = !isLocal && forwardedHost ? `https://${forwardedHost}` : origin;
  return NextResponse.redirect(new URL(next, base));
}
