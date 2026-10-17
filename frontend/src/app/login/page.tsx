import type { Metadata } from "next";

import { LoginCard } from "@/components/auth/login-card";
import { safeNextPath } from "@/lib/utils";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>;
}) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : null, "/dashboard");
  const error = typeof sp.error === "string" ? sp.error : null;

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-20 sm:px-6">
      <LoginCard next={next} error={error} />
    </div>
  );
}
