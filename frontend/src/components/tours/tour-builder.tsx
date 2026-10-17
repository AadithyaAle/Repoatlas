"use client";

import { Hammer } from "lucide-react";
import Link from "next/link";

import { useSession } from "@/components/auth/auth-provider";
import { SignInPrompt } from "@/components/auth/login-card";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/errors";
import { useTour } from "@/lib/api/hooks";

/**
 * `/tours/[id]/edit` — tour builder (owner only). PLACEHOLDER: the tour feature implements step
 * CRUD, reordering, drift sync/resolve and AI drafts using the tour mutation hooks.
 */
export function TourBuilder({ tourId }: { tourId: string }) {
  const { status, isSignedIn } = useSession();
  const tour = useTour(tourId);

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6">
      {status === "loading" || tour.isPending ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-8 w-80" />
          <Skeleton className="h-[60vh] rounded-xl" />
        </div>
      ) : !isSignedIn ? (
        <SignInPrompt
          next={`/tours/${tourId}/edit`}
          title="Sign in to edit this tour"
          description="Only the tour's owner can edit it."
        />
      ) : tour.isError ? (
        <ErrorState error={tour.error} onRetry={() => void tour.refetch()} />
      ) : !tour.data.is_owner ? (
        <ErrorState
          error={
            new ApiError({
              code: "FORBIDDEN",
              message: "Only the owner can edit this tour.",
              status: 403,
            })
          }
          title="Access denied"
          actions={
            <Button variant="outline" size="sm" asChild>
              <Link href={`/tours/${tourId}`}>View tour</Link>
            </Button>
          }
        />
      ) : (
        <>
          <PageHeader
            eyebrow="Tour builder"
            title={tour.data.title}
            actions={
              <Button variant="outline" size="sm" asChild>
                <Link href={`/tours/${tourId}`}>Preview</Link>
              </Button>
            }
          />
          <EmptyState
            icon={Hammer}
            title="Tour builder coming soon"
            description="Pin code ranges, write step explanations, add checkpoints and resolve drift here."
          />
        </>
      )}
    </div>
  );
}
