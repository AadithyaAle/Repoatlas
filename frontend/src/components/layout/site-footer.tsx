import Link from "next/link";

import { LogoMark } from "@/components/layout/logo";
import { env } from "@/lib/env";

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2">
          <LogoMark className="size-5" />
          <span>
            RepoAtlas — dependency graphs, blast radius &amp; self-healing onboarding tours.
          </span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-4">
          <Link href="/" className="hover:text-foreground">
            Explore
          </Link>
          <Link href="/dashboard" className="hover:text-foreground">
            Dashboard
          </Link>
          <a href={env.docsUrl} target="_blank" rel="noreferrer" className="hover:text-foreground">
            Docs
          </a>
          <a href={env.githubRepoUrl} target="_blank" rel="noreferrer" className="hover:text-foreground">
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
