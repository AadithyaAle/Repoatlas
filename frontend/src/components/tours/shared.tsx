"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import * as React from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

const ERROR_TITLES: Record<string, string> = {
  INVALID_LINE_RANGE: "Invalid line range",
  FILE_NOT_IN_SNAPSHOT: "File not in this snapshot",
  VALIDATION_ERROR: "Please check your input",
  AI_DISABLED: "AI drafting is disabled",
  AI_FAILED: "AI draft failed",
  FORBIDDEN: "Not allowed",
  UNAUTHORIZED: "Sign-in required",
  CONFLICT: "Conflict",
};

/** Inline server error (message + code) for forms/mutations. Renders nothing without an error. */
export function ApiErrorAlert({
  error,
  title,
  className,
}: {
  error: unknown;
  title?: string;
  className?: string;
}) {
  if (!error) return null;
  const apiError = toApiError(error);
  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle aria-hidden />
      <AlertTitle>{title ?? ERROR_TITLES[apiError.code] ?? "Request failed"}</AlertTitle>
      <AlertDescription>
        <p>{apiError.message}</p>
        <p className="font-mono text-xs opacity-70">{apiError.code}</p>
      </AlertDescription>
    </Alert>
  );
}

/** Small "field error" text linked via `aria-describedby`. */
export function FieldError({ id, children }: { id: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="text-xs text-destructive" role="alert">
      {children}
    </p>
  );
}

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
};

/** Accessible confirmation dialog (focus-trapped, Esc to cancel). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  pending = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Label + control wrapper. */
export function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Spinner shown inside buttons while pending. */
export function ButtonSpinner() {
  return <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />;
}
