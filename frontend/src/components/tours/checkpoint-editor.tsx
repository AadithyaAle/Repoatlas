"use client";

import { Plus, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  addOption,
  CHECKPOINT_EXPLANATION_MAX,
  type CheckpointDraft,
  type CheckpointErrors,
  MAX_OPTIONS,
  MIN_OPTIONS,
  removeOption,
} from "@/lib/tours/validation";
import { cn } from "@/lib/utils";

import { Field, FieldError } from "./shared";

export type CheckpointEditorProps = {
  value: CheckpointDraft;
  onChange: (value: CheckpointDraft) => void;
  /** Shown only after the first submit attempt. */
  errors?: CheckpointErrors;
  disabled?: boolean;
};

/** Multiple-choice checkpoint editor: question, 2–6 options, correct answer radio, explanation. */
export function CheckpointEditor({ value, onChange, errors = {}, disabled }: CheckpointEditorProps) {
  const id = React.useId();
  const radioName = `${id}-correct`;

  const setOption = (index: number, text: string) =>
    onChange({ ...value, options: value.options.map((o, i) => (i === index ? text : o)) });

  return (
    <fieldset className="space-y-3 rounded-lg border bg-muted/20 p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">Checkpoint</legend>
      <Field label="Question" htmlFor={`${id}-question`}>
        <Input
          id={`${id}-question`}
          value={value.question}
          onChange={(e) => onChange({ ...value, question: e.target.value })}
          placeholder="e.g. Which function validates the session token?"
          aria-invalid={Boolean(errors.question)}
          aria-describedby={errors.question ? `${id}-question-error` : undefined}
        />
        <FieldError id={`${id}-question-error`}>{errors.question}</FieldError>
      </Field>

      <div role="radiogroup" aria-labelledby={`${id}-options-label`} className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span id={`${id}-options-label`} className="text-sm font-medium">
            Options <span className="font-normal text-muted-foreground">(select the correct one)</span>
          </span>
          <span className="text-xs text-muted-foreground">
            {value.options.length}/{MAX_OPTIONS}
          </span>
        </div>
        {value.options.map((option, index) => {
          const optionError = errors.options?.[index];
          const checked = value.correctIndex === index;
          return (
            <div key={index} className="space-y-1">
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md border bg-background p-1.5 pl-2.5",
                  checked && "border-emerald-500/60",
                )}
              >
                <input
                  type="radio"
                  name={radioName}
                  checked={checked}
                  onChange={() => onChange({ ...value, correctIndex: index })}
                  aria-label={`Mark option ${index + 1} as correct`}
                  className="size-4 accent-emerald-600"
                />
                <Input
                  value={option}
                  onChange={(e) => setOption(index, e.target.value)}
                  placeholder={`Option ${index + 1}`}
                  aria-label={`Option ${index + 1}`}
                  aria-invalid={Boolean(optionError)}
                  aria-describedby={optionError ? `${id}-opt-${index}-error` : undefined}
                  className="h-8 border-0 shadow-none focus-visible:ring-1"
                />
                {checked && (
                  <span className="shrink-0 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    Correct
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onChange(removeOption(value, index))}
                  disabled={value.options.length <= MIN_OPTIONS}
                  aria-label={`Remove option ${index + 1}`}
                >
                  <X aria-hidden />
                </Button>
              </div>
              <FieldError id={`${id}-opt-${index}-error`}>{optionError}</FieldError>
            </div>
          );
        })}
        <FieldError id={`${id}-list-error`}>{errors.optionList ?? errors.correctIndex}</FieldError>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange(addOption(value))}
          disabled={value.options.length >= MAX_OPTIONS}
        >
          <Plus aria-hidden /> Add option
        </Button>
      </div>

      <Field
        label="Explanation"
        htmlFor={`${id}-explanation`}
        hint={`Shown after a correct answer · ${value.explanation.length}/${CHECKPOINT_EXPLANATION_MAX}`}
      >
        <Textarea
          id={`${id}-explanation`}
          value={value.explanation}
          onChange={(e) => onChange({ ...value, explanation: e.target.value })}
          rows={2}
          placeholder="Why is this the right answer? (optional)"
          aria-invalid={Boolean(errors.explanation)}
          aria-describedby={errors.explanation ? `${id}-explanation-error` : undefined}
        />
        <FieldError id={`${id}-explanation-error`}>{errors.explanation}</FieldError>
      </Field>
    </fieldset>
  );
}
