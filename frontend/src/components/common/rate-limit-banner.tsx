"use client";

import { Gauge } from "lucide-react";

import { RelativeTime } from "@/components/common/relative-time";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useSession } from "@/components/auth/auth-provider";
import { useRateLimit } from "@/lib/api/hooks";
import type { RateLimit } from "@/lib/api/types";
import { cn } from "@/lib/utils";

export const RATE_LIMIT_WARNING_THRESHOLD = 10;

export function isRateLimitLow(rateLimit: RateLimit | undefined): boolean {
  return (
    rateLimit?.remaining !== null &&
    rateLimit?.remaining !== undefined &&
    rateLimit.remaining < RATE_LIMIT_WARNING_THRESHOLD
  );
}

/**
 * Warns when the server's GitHub API quota is nearly exhausted (remaining < 10). Renders nothing
 * otherwise (including while loading or if the endpoint errors).
 */
export function RateLimitBanner({ className }: { className?: string }) {
  const { data } = useRateLimit();
  const { isConfigured, isSignedIn, signInWithGitHub } = useSession();

  if (!data || !isRateLimitLow(data)) return null;

  return (
    <Alert variant="warning" className={cn(className)}>
      <Gauge />
      <AlertTitle>GitHub API quota is running low</AlertTitle>
      <AlertDescription>
        <p>
          Only {data.remaining} of {data.limit ?? "?"} GitHub requests remain
          {data.reset_at ? (
            <>
              {" "}
              — resets <RelativeTime iso={data.reset_at} />
            </>
          ) : null}
          . New analyses may fail until then.
        </p>
        <p>
          {isConfigured && !isSignedIn ? (
            <>
              <button
                type="button"
                className="font-medium underline underline-offset-4"
                onClick={() => void signInWithGitHub(window.location.pathname)}
              >
                Sign in with GitHub
              </button>{" "}
              or try a demo repository — demo repos are usually already cached.
            </>
          ) : (
            "Try a demo repository — demo repos are usually already cached."
          )}
        </p>
      </AlertDescription>
    </Alert>
  );
}
