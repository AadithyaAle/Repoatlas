"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/** `false` during SSR/hydration, `true` afterwards — without a setState-in-effect. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

// A single shared ticking clock so many <RelativeTime/> instances share one interval.
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribeNow(listener: () => void) {
  listeners.add(listener);
  if (timer === null) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, 30_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Current time (ms), refreshed every 30s on the client; `null` during SSR. */
export function useNow(): number | null {
  return useSyncExternalStore<number | null>(
    subscribeNow,
    () => now,
    () => null,
  );
}
