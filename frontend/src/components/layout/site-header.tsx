"use client";

import { ExternalLink, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type * as React from "react";

import { AuthButton } from "@/components/auth/auth-button";
import { GitHubIcon } from "@/components/icons/github-icon";
import { Logo } from "@/components/layout/logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; external?: boolean };

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Explore" },
  { href: "/dashboard", label: "Dashboard" },
  { href: env.docsUrl, label: "Docs", external: true },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/analyses") || pathname.startsWith("/repos");
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Spreads extra props so it can be used under Radix `asChild` (e.g. `SheetClose`). */
function NavLink({
  item,
  pathname,
  className,
  ...rest
}: { item: NavItem; pathname: string } & Omit<React.ComponentProps<"a">, "href">) {
  const base = "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors";
  if (item.external) {
    return (
      <a
        {...rest}
        href={item.href}
        target="_blank"
        rel="noreferrer"
        className={cn(base, "text-muted-foreground hover:text-foreground", className)}
      >
        {item.label}
        <ExternalLink className="size-3" aria-hidden />
      </a>
    );
  }
  const active = isActive(pathname, item.href);
  return (
    <Link
      {...rest}
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        base,
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {item.label}
    </Link>
  );
}

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.label} item={item} pathname={pathname} />
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" asChild>
                <a href={env.githubRepoUrl} target="_blank" rel="noreferrer" aria-label="RepoAtlas on GitHub">
                  <GitHubIcon />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Source on GitHub</TooltipContent>
          </Tooltip>
          <ThemeToggle />
          <div className="hidden sm:block">
            <AuthButton />
          </div>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <nav aria-label="Mobile" className="flex flex-col gap-1 px-4">
                {NAV_ITEMS.map((item) => (
                  <SheetClose asChild key={item.label}>
                    <NavLink item={item} pathname={pathname} className="w-full py-2" />
                  </SheetClose>
                ))}
              </nav>
              <div className="px-4 sm:hidden">
                <AuthButton />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
