"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { useSession } from "@/components/auth/auth-provider";
import { GitHubIcon } from "@/components/icons/github-icon";
import { LogoMark } from "@/components/layout/logo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export type SignInPromptProps = {
  /** Where to return after sign-in (relative path). */
  next: string;
  title?: string;
  description?: string;
};

/** GitHub sign-in button that handles the disabled / loading / signed-in states. */
export function SignInButton({ next, className }: { next: string; className?: string }) {
  const { status, signInWithGitHub } = useSession();
  const [redirecting, setRedirecting] = React.useState(false);

  if (status === "disabled") {
    return (
      <Button className={className} disabled variant="outline">
        <GitHubIcon /> Sign-in not configured
      </Button>
    );
  }

  return (
    <Button
      className={className}
      disabled={status === "loading" || redirecting}
      onClick={() => {
        setRedirecting(true);
        void signInWithGitHub(next).finally(() => setRedirecting(false));
      }}
    >
      {redirecting ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <GitHubIcon />}
      Continue with GitHub
    </Button>
  );
}

export function LoginCard({ next, error }: { next: string; error: string | null }) {
  const { status } = useSession();
  const router = useRouter();

  React.useEffect(() => {
    if (status === "signed-in") router.replace(next);
  }, [status, next, router]);

  return (
    <Card>
      <CardHeader className="items-center text-center">
        <LogoMark className="mx-auto mb-2 size-10" />
        <CardTitle className="text-xl">Sign in to RepoAtlas</CardTitle>
        <CardDescription>
          Create and share onboarding tours, track trainee progress and raise your GitHub quota.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Sign-in failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {status === "disabled" && (
          <Alert>
            <AlertCircle />
            <AlertTitle>Sign-in not configured</AlertTitle>
            <AlertDescription>
              This deployment has no Supabase credentials. You can still analyze repositories and
              explore graphs anonymously.
            </AlertDescription>
          </Alert>
        )}
        <SignInButton next={next} className="w-full" />
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          Continue without an account →
        </Link>
      </CardFooter>
    </Card>
  );
}

/** Inline call-to-action used by auth-gated pages (e.g. dashboard) when signed out. */
export function SignInPrompt({
  next,
  title = "Sign in required",
  description = "Sign in with GitHub to continue.",
}: SignInPromptProps) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-12 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        <GitHubIcon className="size-5" />
      </div>
      <div className="space-y-1">
        <h2 className="font-semibold">{title}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
      <SignInButton next={next} />
    </div>
  );
}
