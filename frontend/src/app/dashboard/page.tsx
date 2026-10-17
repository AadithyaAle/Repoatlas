import type { Metadata } from "next";

import { DashboardView } from "@/components/dashboard/dashboard-view";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Repository analytics, onboarding-tour health and trainee progress.",
  robots: { index: false },
};

export default function DashboardPage() {
  return <DashboardView />;
}
