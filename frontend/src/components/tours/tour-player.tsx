"use client";

import { Pencil, PlayCircle } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTour } from "@/lib/api/hooks";

/**
 * `/tours/[id]` — tour player. PLACEHOLDER: the tour feature implements step navigation, code
 * viewer (Monaco), markdown body and checkpoints using `useTour`, `useProgress`, `useAnswerStep`.
 */
export function TourPlayer({ tourId }: { tourId: string }) {
  const tour = useTour(tourId);

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6">
      {tour.isPending ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-8 w-80" />
          <Skeleton className="h-4 w-96 max-w-full" />
          <Skeleton className="h-[60vh] rounded-xl" />
        </div>
      ) : tour.isError ? (
        <ErrorState error={tour.error} onRetry={() => void tour.refetch()} />
      ) : (
        <>
          <PageHeader
            eyebrow={
              <Link
                href={`/repos/${tour.data.repository.owner}/${tour.data.repository.name}`}
                className="font-mono normal-case hover:text-foreground"
              >
                {tour.data.repository.owner}/{tour.data.repository.name}
              </Link>
            }
            title={tour.data.title}
            description={tour.data.description ?? undefined}
            actions={
              <>
                <Badge variant="outline">{tour.data.step_count} steps</Badge>
                {tour.data.is_owner && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/tours/${tour.data.id}/edit`}>
                      <Pencil /> Edit
                    </Link>
                  </Button>
                )}
              </>
            }
          />
          <EmptyState
            icon={PlayCircle}
            title="Tour player coming soon"
            description="Step-by-step playback with pinned code, explanations and checkpoints will render here."
          />
        </>
      )}
    </div>
  );
}
