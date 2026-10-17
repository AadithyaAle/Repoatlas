import { describe, expect, it } from "vitest";

import { assertNoSecretSupabaseKeys, isSecretSupabaseKey } from "./key-guard";

const jwt = (payload: object) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

describe("isSecretSupabaseKey", () => {
  it.each([
    ["sb_secret_abc123", true],
    [jwt({ role: "service_role" }), true],
    ["sb_publishable_abc123", false],
    [jwt({ role: "anon" }), false],
    ["not-a-key", false],
    ["", false],
    [undefined, false],
  ])("%s -> %s", (key, expected) => {
    expect(isSecretSupabaseKey(key)).toBe(expected);
  });
});

describe("assertNoSecretSupabaseKeys", () => {
  it("throws only for NEXT_PUBLIC_ variables holding secret keys", () => {
    expect(() =>
      assertNoSecretSupabaseKeys({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_x" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(() =>
      assertNoSecretSupabaseKeys({
        SUPABASE_SERVICE_KEY: "sb_secret_x",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
      }),
    ).not.toThrow();
  });
});
