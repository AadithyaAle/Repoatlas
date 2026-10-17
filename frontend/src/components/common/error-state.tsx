"use client";

import { AlertTriangle, Lock, RefreshCw, SearchX, WifiOff } from "lucide-react";
import Link from "next/link";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import { toApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

export type ErrorStateProps = {
  /** Anything thrown (ApiError, Error, unknown) — normalised via `toApiError`. */
  error: unknown;
  /** Shows a "Try again" button when provided. */
  onRetry?: () => void;
  title?: string;
  /** Extra actions rendered next to the retry button. */
  actions?: React.ReactNode;
  className?: string;
  /** Compact inline variant (no big icon / padding). */
  compact?: boolean;
};

function ErrorIcon({ code, status }: { code: string; status: number }) {
  const className = "size-5";
  if (code === "NETWORK_ERROR") return <WifiOff className={className} aria-hidden />;
  if (status === 401 || status === 403) return <Lock className={className} aria-hidden />;
  if (status === 404) return <SearchX className={className} aria-hidden />;
  return <AlertTriangle className={className} aria-hidden />;
}

function titleFor(code: string, status: number): string {
  if (code === "NETWORK_ERROR") return "API unreachable";
  if (status === 401) return "Sign-in required";
  if (status === 403) return "Access denied";
  if (status === 404) return "Not found";
  if (code === "GITHUB_RATE_LIMITED") return "GitHub rate limit reached";
  return "Something went wrong";
}

export function ErrorState({
  error,
  onRetry,
  title,
  actions,
  className,
  compact = false,
}: ErrorStateProps) {
  const apiError = toApiError(error);

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center",
        compact ? "p-4" : "px-6 py-12",
        className,
      )}
    >
      {!compact && (
        <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ErrorIcon code={apiError.code} status={apiError.status} />
        </div>
      )}
      <div className="space-y-1">
        <h3 className="font-semibold">{title ?? titleFor(apiError.code, apiError.status)}</h3>
        <p className="max-w-md text-sm text-muted-foreground">{apiError.message}</p>
        <p className="font-mono text-xs text-muted-foreground/70">
          {apiError.code}
          {apiError.status > 0 ? ` · ${apiError.status}` : null}
        </p>
      </div>
      {(onRetry || actions || apiError.status === 404) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw /> Try again
            </Button>
          )}
          {actions}
          {!actions && apiError.status === 404 && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/">Back to Explore</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
