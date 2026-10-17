"use client";

import * as React from "react";

import { env } from "@/lib/env";

let warmed = false;

/**
 * Fire-and-forget request on first page load so a sleeping Render free instance (≈50 s cold
 * start) begins booting while the visitor reads the landing page. `/health` also touches the
 * database, so the connection pool is warm too. Failures are irrelevant and ignored.
 */
export function ApiWarmup() {
  React.useEffect(() => {
    if (warmed) return;
    warmed = true;
    fetch(`${env.apiUrl}/api/v1/health`, { cache: "no-store", keepalive: true }).catch(() => {});
  }, []);
  return null;
}
