/**
 * Supabase secret / service-role keys bypass Row Level Security. `NEXT_PUBLIC_*` values are
 * inlined into browser bundles, so such a key must never be used there.
 */
export function isSecretSupabaseKey(key: string | undefined): boolean {
  const value = key?.trim();
  if (!value) return false;
  if (value.startsWith("sb_secret_")) return true;
  // Legacy JWT keys: the payload's `role` claim is "service_role" for the secret key.
  const payload = value.split(".")[1];
  if (!payload) return false;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      role?: unknown;
    };
    return json.role === "service_role";
  } catch {
    return false;
  }
}

/** Throws at build/boot time if any browser-exposed Supabase key is a secret key. */
export function assertNoSecretSupabaseKeys(env: Record<string, string | undefined>): void {
  const leaked = Object.entries(env)
    .filter(([name, value]) => name.startsWith("NEXT_PUBLIC_") && isSecretSupabaseKey(value))
    .map(([name]) => name);
  if (leaked.length > 0) {
    throw new Error(
      `Refusing to build: ${leaked.join(", ")} contains a Supabase SECRET key. ` +
        "Use the publishable key (sb_publishable_...) — secret keys bypass Row Level Security.",
    );
  }
}
