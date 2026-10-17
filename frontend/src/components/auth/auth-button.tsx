"use client";

import { LayoutDashboard, LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useSession } from "@/components/auth/auth-provider";
import { GitHubIcon as Github } from "@/components/icons/github-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/[\s_-]+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}` : name.slice(0, 2))
    .toUpperCase();
}

/** Sign-in button / avatar menu. Shows a disabled state when Supabase isn't configured. */
export function AuthButton() {
  const { status, profile, signInWithGitHub, signOut } = useSession();
  const pathname = usePathname();

  if (status === "loading") return <Skeleton className="size-8 rounded-full" />;

  if (status === "disabled") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* span wrapper: disabled buttons don't fire pointer events for the tooltip */}
          <span tabIndex={0} className="rounded-md">
            <Button variant="outline" size="sm" disabled aria-disabled>
              <Github /> Sign-in not configured
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to enable GitHub
          sign-in. Graph exploration works anonymously.
        </TooltipContent>
      </Tooltip>
    );
  }

  if (status === "signed-out" || !profile) {
    return (
      <Button size="sm" onClick={() => void signInWithGitHub(pathname)}>
        <Github /> Sign in
      </Button>
    );
  }

  const display = profile.login ?? profile.name ?? profile.email ?? "Account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Account menu">
          <Avatar className="size-8">
            {profile.avatarUrl && <AvatarImage src={profile.avatarUrl} alt="" />}
            <AvatarFallback>{initials(profile.name ?? profile.login)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate">{display}</span>
          {profile.email && (
            <span className="truncate text-xs font-normal text-muted-foreground">
              {profile.email}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard">
            <LayoutDashboard /> Dashboard
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
