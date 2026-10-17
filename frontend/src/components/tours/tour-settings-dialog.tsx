"use client";

import { Settings, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useDeleteTour, useUpdateTour } from "@/lib/api/hooks";
import type { Tour, TourVisibility } from "@/lib/api/types";
import {
  TOUR_DESCRIPTION_MAX,
  TOUR_TITLE_MAX,
  type TourDraftErrors,
  validateTourDraft,
} from "@/lib/tours/validation";

import { ApiErrorAlert, ButtonSpinner, ConfirmDialog, Field, FieldError } from "./shared";
import { VisibilityPicker } from "./visibility-picker";

/** Tour settings (title / description / visibility) + delete tour. */
export function TourSettingsDialog({ tour }: { tour: Tour }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings aria-hidden /> Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {open && <SettingsForm tour={tour} onClose={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function SettingsForm({ tour, onClose }: { tour: Tour; onClose: () => void }) {
  const router = useRouter();
  const update = useUpdateTour(tour.id);
  const remove = useDeleteTour();
  const id = React.useId();
  const [title, setTitle] = React.useState(tour.title);
  const [description, setDescription] = React.useState(tour.description ?? "");
  const [visibility, setVisibility] = React.useState<TourVisibility>(tour.visibility);
  const [errors, setErrors] = React.useState<TourDraftErrors>({});
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors = validateTourDraft({ title, description });
    setErrors(nextErrors);
    if (nextErrors.title || nextErrors.description) return;
    update.mutate(
      {
        title: title.trim(),
        description: description.trim() === "" ? null : description.trim(),
        visibility,
      },
      {
        onSuccess: () => {
          toast.success("Tour settings saved");
          onClose();
        },
      },
    );
  };

  const deleteTour = () => {
    remove.mutate(tour.id, {
      onSuccess: () => {
        toast.success("Tour deleted");
        setConfirmDelete(false);
        router.push("/dashboard");
      },
    });
  };

  return (
    <>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <DialogHeader>
          <DialogTitle>Tour settings</DialogTitle>
          <DialogDescription>
            {tour.repository.owner}/{tour.repository.name}
          </DialogDescription>
        </DialogHeader>
        <Field label="Title" htmlFor={`${id}-title`} hint={`${title.trim().length}/${TOUR_TITLE_MAX}`}>
          <Input
            id={`${id}-title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
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
            rows={3}
            aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description ? `${id}-description-error` : undefined}
          />
          <FieldError id={`${id}-description-error`}>{errors.description}</FieldError>
        </Field>
        <VisibilityPicker value={visibility} onChange={setVisibility} />
        <ApiErrorAlert error={update.error} title="Couldn't save settings" />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={update.isPending}>
            {update.isPending && <ButtonSpinner />}
            Save
          </Button>
        </DialogFooter>
      </form>
      <Separator />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-3">
        <div>
          <p className="text-sm font-medium">Delete this tour</p>
          <p className="text-xs text-muted-foreground">
            Removes all steps and trainee progress. This can&apos;t be undone.
          </p>
        </div>
        <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
          <Trash2 aria-hidden /> Delete tour
        </Button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${tour.title}”?`}
        description="All steps, checkpoints and trainee progress will be permanently removed."
        confirmLabel="Delete tour"
        destructive
        pending={remove.isPending}
        onConfirm={deleteTour}
      />
    </>
  );
}
