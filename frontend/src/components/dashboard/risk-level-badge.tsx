import { Badge } from "@/components/ui/badge";
import type { RiskLevel } from "@/lib/api/types";
import { RISK_LEVEL_META } from "@/lib/dashboard/health";
import { cn } from "@/lib/utils";

export function RiskLevelBadge({ level, className }: { level: RiskLevel; className?: string }) {
  const meta = RISK_LEVEL_META[level];
  return (
    <Badge variant="outline" className={cn("border-transparent", meta.badge, className)}>
      {meta.label}
    </Badge>
  );
}
