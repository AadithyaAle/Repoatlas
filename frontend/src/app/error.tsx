"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/common/error-state";

export default function GlobalRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <ErrorState error={error} onRetry={reset} title="This page crashed" />
    </div>
  );
}
