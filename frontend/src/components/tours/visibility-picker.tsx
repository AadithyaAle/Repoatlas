"use client";

import { Globe, Lock } from "lucide-react";
import * as React from "react";

import type { TourVisibility } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const OPTIONS: { value: TourVisibility; label: string; description: string; icon: typeof Globe }[] = [
  {
    value: "PUBLIC",
    label: "Public",
    description: "Anyone with the link can take this tour.",
    icon: Globe,
  },
  {
    value: "PRIVATE",
    label: "Private",
    description: "Only you can see it (share later by making it public).",
    icon: Lock,
  },
];

/** Radio-card picker for tour visibility (native radios → full keyboard support). */
export function VisibilityPicker({
  value,
  onChange,
  disabled,
}: {
  value: TourVisibility;
  onChange: (value: TourVisibility) => void;
  disabled?: boolean;
}) {
  const name = React.useId();
  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <legend className="mb-1.5 text-sm font-medium">Visibility</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                checked ? "border-primary bg-primary/5" : "hover:bg-accent/50",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <Icon className={cn("mt-0.5 size-4 shrink-0", checked ? "text-primary" : "text-muted-foreground")} aria-hidden />
              <span className="space-y-0.5">
                <span className="block font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
