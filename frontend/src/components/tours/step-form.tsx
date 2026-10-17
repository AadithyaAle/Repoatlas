"use client";

import { ListChecks, Pin, Save, Sparkles } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAIStepDraft } from "@/lib/api/hooks";
import type { CheckpointInput, Step } from "@/lib/api/types";
import { formatLineRange, lineCount, type LineRange } from "@/lib/tours/lines";
import {
  type CheckpointDraft,
  checkpointToDraft,
  draftToCheckpointInput,
  emptyCheckpointDraft,
  hasStepErrors,
  STEP_BODY_MAX,
  STEP_TITLE_MAX,
  type StepDraftErrors,
  validateStepDraft,
} from "@/lib/tours/validation";

import { CheckpointEditor } from "./checkpoint-editor";
import { MarkdownContent } from "./markdown";
import { ApiErrorAlert, ButtonSpinner, Field, FieldError } from "./shared";

export type StepFormValues = {
  title: string;
  body: string;
  checkpoint: CheckpointInput | null;
  /** Insert position (create only); `null` = append. */
  position: number | null;
};

export type StepFormProps = {
  mode: "create" | "edit";
  analysisId: string;
  filePath: string;
  range: LineRange;
  /** File length, for client-side range validation. */
  maxLine?: number;
  initial?: { title: string; body: string; checkpoint: Step["checkpoint"] | CheckpointInput | null };
  /** Existing steps (for the insert-position picker). */
  steps: readonly Step[];
  defaultPosition?: number | null;
  aiEnabled: boolean;
  pending: boolean;
  error: unknown;
  /** Extra content next to the range label (e.g. "use current selection"). */
  rangeAction?: React.ReactNode;
  submitLabel?: string;
  onSubmit: (values: StepFormValues) => void;
  onCancel: () => void;
};

const END = "end";

/** Create/edit form for a tour step (title, Markdown body + preview, checkpoint, position). */
export function StepForm({
  mode,
  analysisId,
  filePath,
  range,
  maxLine,
  initial,
  steps,
  defaultPosition = null,
  aiEnabled,
  pending,
  error,
  rangeAction,
  submitLabel,
  onSubmit,
  onCancel,
}: StepFormProps) {
  const id = React.useId();
  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [body, setBody] = React.useState(initial?.body ?? "");
  const [checkpoint, setCheckpoint] = React.useState<CheckpointDraft | null>(() =>
    checkpointToDraft(initial?.checkpoint ?? null),
  );
  const [position, setPosition] = React.useState<string>(
    defaultPosition === null ? END : String(defaultPosition),
  );
  const [submitted, setSubmitted] = React.useState(false);
  const aiDraft = useAIStepDraft();

  const errors: StepDraftErrors = validateStepDraft({
    title,
    body,
    range: mode === "create" ? range : undefined,
    maxLine,
    checkpoint,
  });
  const shown: StepDraftErrors = submitted ? errors : {};

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (hasStepErrors(errors)) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    onSubmit({
      title: title.trim(),
      body,
      checkpoint: checkpoint ? draftToCheckpointInput(checkpoint) : null,
      position: mode === "create" && position !== END ? Number(position) : null,
    });
  };

  const draftWithAI = () => {
    aiDraft.mutate(
      { analysis_id: analysisId, file_path: filePath, start_line: range.start, end_line: range.end },
      {
        onSuccess: (draft) => {
          setTitle(draft.title.slice(0, STEP_TITLE_MAX));
          setBody(draft.body_markdown);
          if (draft.checkpoint) setCheckpoint(checkpointToDraft(draft.checkpoint));
          toast.success(draft.cached ? "Loaded cached AI draft" : "AI draft ready — review before saving");
        },
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-labelledby={`${id}-heading`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`${id}-heading`} className="font-semibold">
            {mode === "create" ? `Pin lines ${formatLineRange(range.start, range.end)}` : "Edit step"}
          </h3>
          <p className="truncate font-mono text-xs text-muted-foreground" title={filePath}>
            {filePath} · {formatLineRange(range.start, range.end)} ({lineCount(range)} lines)
          </p>
          {rangeAction}
        </div>
        {aiEnabled && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={draftWithAI}
            disabled={aiDraft.isPending || pending}
          >
            {aiDraft.isPending ? <ButtonSpinner /> : <Sparkles aria-hidden />}
            Draft with AI
          </Button>
        )}
      </div>

      {shown.range && (
        <p className="text-sm text-destructive" role="alert">
          {shown.range}
        </p>
      )}
      <ApiErrorAlert error={aiDraft.error} />

      <Field label="Step title" htmlFor={`${id}-title`} hint={`${title.trim().length}/${STEP_TITLE_MAX}`}>
        <Input
          id={`${id}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Where requests are authenticated"
          aria-invalid={Boolean(shown.title)}
          aria-describedby={shown.title ? `${id}-title-error` : undefined}
        />
        <FieldError id={`${id}-title-error`}>{shown.title}</FieldError>
      </Field>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={`${id}-body`} className="text-sm font-medium">
            Explanation <span className="font-normal text-muted-foreground">(Markdown)</span>
          </label>
          <span className="text-xs text-muted-foreground">
            {body.length.toLocaleString("en")}/{STEP_BODY_MAX.toLocaleString("en")}
          </span>
        </div>
        <div className="grid gap-2 xl:grid-cols-2">
          <Textarea
            id={`${id}-body`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            className="min-h-40 font-mono text-xs"
            placeholder={"Explain what this code does and why it matters.\n\n- Supports **GFM**, `code`, tables…"}
            aria-invalid={Boolean(shown.body)}
            aria-describedby={shown.body ? `${id}-body-error` : `${id}-preview`}
          />
          <div
            id={`${id}-preview`}
            aria-label="Markdown preview"
            aria-live="polite"
            className="max-h-72 min-h-40 overflow-auto rounded-md border bg-muted/20 p-3"
          >
            <MarkdownContent emptyText="Live preview appears here.">{body}</MarkdownContent>
          </div>
        </div>
        <FieldError id={`${id}-body-error`}>{shown.body}</FieldError>
      </div>

      {checkpoint ? (
        <div className="space-y-2">
          <CheckpointEditor
            value={checkpoint}
            onChange={setCheckpoint}
            errors={shown.checkpoint}
            disabled={pending}
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => setCheckpoint(null)}>
            Remove checkpoint
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCheckpoint(emptyCheckpointDraft())}
        >
          <ListChecks aria-hidden /> Add checkpoint question
        </Button>
      )}

      {mode === "create" && (
        <Field label="Insert position" htmlFor={`${id}-position`}>
          <Select value={position} onValueChange={setPosition}>
            <SelectTrigger id={`${id}-position`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={END}>At the end (step {steps.length + 1})</SelectItem>
              {steps.map((step, index) => (
                <SelectItem key={step.id} value={String(index)}>
                  Before step {index + 1}: {step.title.length > 40 ? `${step.title.slice(0, 40)}…` : step.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      <ApiErrorAlert error={error} title={mode === "create" ? "Couldn't pin this step" : "Couldn't save the step"} />

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <ButtonSpinner /> : mode === "create" ? <Pin aria-hidden /> : <Save aria-hidden />}
          {submitLabel ?? (mode === "create" ? "Pin step" : "Save changes")}
        </Button>
      </div>
    </form>
  );
}
