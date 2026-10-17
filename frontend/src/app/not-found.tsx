import { Compass } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="This route isn't on the atlas. The link may be outdated or mistyped."
        action={
          <Button asChild>
            <Link href="/">Back to Explore</Link>
          </Button>
        }
      />
    </div>
  );
}
