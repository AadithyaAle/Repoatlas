import Link from "next/link";

import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={cn("size-6", className)}>
      <rect width="24" height="24" rx="6" className="fill-primary" />
      <path
        d="M7 16.5 12 7l5 9.5M9.2 12.6h5.6"
        className="stroke-primary-foreground"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="16.5" r="1.4" className="fill-primary-foreground" />
      <circle cx="17" cy="16.5" r="1.4" className="fill-primary-foreground" />
      <circle cx="12" cy="7" r="1.4" className="fill-primary-foreground" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}
      aria-label="RepoAtlas home"
    >
      <LogoMark />
      <span>RepoAtlas</span>
    </Link>
  );
}
