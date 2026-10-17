"use client";

import { useNow } from "@/hooks/use-client";
import { formatRelativeTime } from "@/lib/utils";

/** `<time>` showing "3 minutes ago", with the absolute timestamp as a tooltip. */
export function RelativeTime({ iso, className }: { iso: string | null | undefined; className?: string }) {
  const now = useNow();
  if (!iso) return <span className={className}>—</span>;
  const absolute = new Date(iso).toLocaleString("en");
  return (
    <time dateTime={iso} title={absolute} className={className} suppressHydrationWarning>
      {now === null ? absolute : formatRelativeTime(iso, now)}
    </time>
  );
}
