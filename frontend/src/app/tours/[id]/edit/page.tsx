import type { Metadata } from "next";

import { TourBuilder } from "@/components/tours/tour-builder";

export const metadata: Metadata = {
  title: "Edit tour",
  description: "Pin code ranges, write explanations, add checkpoints and resolve drift.",
};

export default async function TourEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TourBuilder tourId={id} />;
}
