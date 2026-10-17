"use client";

import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { env, isSupabaseConfigured } from "@/lib/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { safeNextPath } from "@/lib/utils";

export type AuthStatus = "disabled" | "loading" | "signed-in" | "signed-out";

export type AuthProfile = {
  id: string;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  email: string | null;
};

export type AuthContextValue = {
  /** `disabled` when Supabase env vars are missing — the app still works anonymously. */
  status: AuthStatus;
  isConfigured: boolean;
  isSignedIn: boolean;
  session: Session | null;
  user: User | null;
  profile: AuthProfile | null;
  /** Start GitHub OAuth; returns to `next` (relative path) afterwards. */
  signInWithGitHub: (next?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function toProfile(user: User | null): AuthProfile | null {
  if (!user) return null;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    id: user.id,
    login: stringOrNull(meta.user_name) ?? stringOrNull(meta.preferred_username),
    name: stringOrNull(meta.full_name) ?? stringOrNull(meta.name),
    avatarUrl: stringOrNull(meta.avatar_url),
    email: user.email ?? null,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [session, setSession] = React.useState<Session | null>(null);
  const [status, setStatus] = React.useState<AuthStatus>(
    isSupabaseConfigured ? "loading" : "disabled",
  );

  React.useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    let lastUserId: string | null | undefined;
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setStatus(nextSession ? "signed-in" : "signed-out");
      const userId = nextSession?.user.id ?? null;
      // Identity changed after the initial event: refetch everything with the new token.
      if (lastUserId !== undefined && lastUserId !== userId) {
        void queryClient.invalidateQueries();
      }
      lastUserId = userId;
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  const signInWithGitHub = React.useCallback(async (next?: string) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      toast.error("Sign-in is not configured on this deployment.");
      return;
    }
    const origin = typeof window === "undefined" ? env.siteUrl : window.location.origin;
    const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo },
    });
    if (error) toast.error(`GitHub sign-in failed: ${error.message}`);
  }, []);

  const signOut = React.useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(`Sign-out failed: ${error.message}`);
      return;
    }
    queryClient.removeQueries({ queryKey: ["repoatlas", "dashboard"] });
    router.refresh();
    toast.success("Signed out");
  }, [queryClient, router]);

  const value = React.useMemo<AuthContextValue>(() => {
    const user = session?.user ?? null;
    return {
      status,
      isConfigured: isSupabaseConfigured,
      isSignedIn: status === "signed-in",
      session,
      user,
      profile: toProfile(user),
      signInWithGitHub,
      signOut,
    };
  }, [session, status, signInWithGitHub, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Auth state + actions. Must be used under `<AuthProvider>` (mounted in `Providers`). */
export function useSession(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useSession must be used within <AuthProvider>");
  return ctx;
}
