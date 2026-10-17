import type { Metadata } from "next";

import { TourPlayer } from "@/components/tours/tour-player";

export const metadata: Metadata = { title: "Tour" };

export default async function TourPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TourPlayer tourId={id} />;
}
