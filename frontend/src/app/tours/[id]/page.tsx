import type { Metadata } from "next";
import { Suspense } from "react";

import { TourPlayer } from "@/components/tours/tour-player";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Tour",
  description: "Step through pinned code, explanations and checkpoints.",
};

function TourPlayerFallback() {
  return (
    <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-8 sm:px-6" aria-busy="true">
      <Skeleton className="h-8 w-80" />
      <Skeleton className="h-[60vh] rounded-xl" />
    </div>
  );
}

export default async function TourPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The player reads `?step=N` via `useSearchParams`, which needs a Suspense boundary.
  return (
    <Suspense fallback={<TourPlayerFallback />}>
      <TourPlayer tourId={id} />
    </Suspense>
  );
}
