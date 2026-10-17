"use client";

import { Globe, Lock, Plus } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { useSession } from "@/components/auth/auth-provider";
import { SignInPrompt } from "@/components/auth/login-card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useCreateTour } from "@/lib/api/hooks";
import type { TourVisibility } from "@/lib/api/types";
import {
  TOUR_DESCRIPTION_MAX,
  TOUR_TITLE_MAX,
  type TourDraftErrors,
  validateTourDraft,
} from "@/lib/tours/validation";

import { ApiErrorAlert, ButtonSpinner, Field, FieldError } from "./shared";
import { VisibilityPicker } from "./visibility-picker";

export type CreateTourDialogProps = {
  /** Analysis (commit snapshot) the tour is pinned to. */
  analysisId: string;
  /** e.g. "vercel/next.js" — shown in the dialog description. */
  repositoryLabel?: string;
  /** Custom trigger element (rendered with `asChild`). Defaults to a "Create tour" button. */
  trigger?: React.ReactNode;
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** "Create tour" dialog: title, description, visibility → creates and opens the builder. */
export function CreateTourDialog({
  analysisId,
  repositoryLabel,
  trigger,
  open: openProp,
  onOpenChange,
}: CreateTourDialogProps) {
  const [openState, setOpenState] = React.useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus aria-hidden /> Create tour
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {/* Remount the form on every open so it starts fresh. */}
        {open && (
          <CreateTourForm
            analysisId={analysisId}
            repositoryLabel={repositoryLabel}
            onCancel={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateTourForm({
  analysisId,
  repositoryLabel,
  onCancel,
}: {
  analysisId: string;
  repositoryLabel?: string;
  onCancel: () => void;
}) {
  const { status, isSignedIn } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const createTour = useCreateTour();
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [visibility, setVisibility] = React.useState<TourVisibility>("PUBLIC");
  const [errors, setErrors] = React.useState<TourDraftErrors>({});
  const id = React.useId();

  const header = (
    <DialogHeader>
      <DialogTitle>Create an onboarding tour</DialogTitle>
      <DialogDescription>
        Pin code ranges{repositoryLabel ? ` from ${repositoryLabel}` : ""}, explain them in
        Markdown and add checkpoints for new teammates.
      </DialogDescription>
    </DialogHeader>
  );

  if (status === "loading") {
    return (
      <>
        {header}
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-9" />
          <Skeleton className="h-24" />
        </div>
      </>
    );
  }

  if (!isSignedIn) {
    return (
      <>
        {header}
        <SignInPrompt
          next={pathname || "/"}
          title="Sign in to create tours"
          description="Tours are owned by your GitHub account so you can edit and share them."
        />
      </>
    );
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors = validateTourDraft({ title, description });
    setErrors(nextErrors);
    if (nextErrors.title || nextErrors.description) return;
    createTour.mutate(
      {
        analysis_id: analysisId,
        title: title.trim(),
        description: description.trim() === "" ? null : description.trim(),
        visibility,
      },
      {
        onSuccess: (tour) => {
          toast.success("Tour created — start pinning steps");
          router.push(`/tours/${tour.id}/edit`);
        },
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      {header}
      <Field label="Title" htmlFor={`${id}-title`} hint={`${title.trim().length}/${TOUR_TITLE_MAX}`}>
        <Input
          id={`${id}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. How a request flows through the API"
          maxLength={TOUR_TITLE_MAX + 50}
          autoFocus
          aria-invalid={Boolean(errors.title)}
          aria-describedby={errors.title ? `${id}-title-error` : undefined}
        />
        <FieldError id={`${id}-title-error`}>{errors.title}</FieldError>
      </Field>
      <Field
        label="Description"
        htmlFor={`${id}-description`}
        hint={`${description.length}/${TOUR_DESCRIPTION_MAX.toLocaleString("en")}`}
      >
        <Textarea
          id={`${id}-description`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What will trainees learn? (optional)"
          rows={3}
          aria-invalid={Boolean(errors.description)}
          aria-describedby={errors.description ? `${id}-description-error` : undefined}
        />
        <FieldError id={`${id}-description-error`}>{errors.description}</FieldError>
      </Field>
      <VisibilityPicker value={visibility} onChange={setVisibility} />
      <ApiErrorAlert error={createTour.error} title="Couldn't create the tour" />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={createTour.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={createTour.isPending}>
          {createTour.isPending ? <ButtonSpinner /> : visibility === "PUBLIC" ? <Globe aria-hidden /> : <Lock aria-hidden />}
          Create tour
        </Button>
      </DialogFooter>
    </form>
  );
}
