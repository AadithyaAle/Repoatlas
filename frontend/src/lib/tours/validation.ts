import type { CheckpointInput, Step } from "@/lib/api/types";
import { isOwnerCheckpoint } from "@/lib/api/types";

import { type LineRange, validateLineRange } from "./lines";

// Limits mirror backend `app/schemas/atlas.py`.
export const STEP_TITLE_MAX = 200;
export const STEP_BODY_MAX = 20_000;
export const TOUR_TITLE_MIN = 3;
export const TOUR_TITLE_MAX = 200;
export const TOUR_DESCRIPTION_MAX = 5_000;
export const CHECKPOINT_QUESTION_MIN = 3;
export const CHECKPOINT_QUESTION_MAX = 500;
export const CHECKPOINT_OPTION_MAX = 300;
export const CHECKPOINT_EXPLANATION_MAX = 1_000;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

/** Editable checkpoint form state. */
export type CheckpointDraft = {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

export type CheckpointErrors = {
  question?: string;
  /** Per-option errors, aligned with `draft.options`. */
  options?: (string | undefined)[];
  /** Errors about the option list as a whole (count). */
  optionList?: string;
  correctIndex?: string;
  explanation?: string;
};

export function emptyCheckpointDraft(): CheckpointDraft {
  return { question: "", options: ["", ""], correctIndex: 0, explanation: "" };
}

/** Build a draft from an existing step checkpoint (owner variant carries the answer). */
export function checkpointToDraft(checkpoint: Step["checkpoint"] | CheckpointInput | null | undefined): CheckpointDraft | null {
  if (!checkpoint) return null;
  const owner = "correct_index" in checkpoint ? checkpoint : null;
  return {
    question: checkpoint.question,
    options: [...checkpoint.options],
    correctIndex: owner?.correct_index ?? 0,
    explanation: owner?.explanation ?? "",
  };
}

/** True when the step's checkpoint includes the answer (owner view). */
export function hasOwnerCheckpoint(step: Pick<Step, "checkpoint">): boolean {
  return isOwnerCheckpoint(step.checkpoint);
}

export function addOption(draft: CheckpointDraft): CheckpointDraft {
  if (draft.options.length >= MAX_OPTIONS) return draft;
  return { ...draft, options: [...draft.options, ""] };
}

/** Removes an option, keeping `correctIndex` pointing at the same answer when possible. */
export function removeOption(draft: CheckpointDraft, index: number): CheckpointDraft {
  if (draft.options.length <= MIN_OPTIONS || index < 0 || index >= draft.options.length) {
    return draft;
  }
  const options = draft.options.filter((_, i) => i !== index);
  let correctIndex = draft.correctIndex;
  if (index === correctIndex) correctIndex = 0;
  else if (index < correctIndex) correctIndex -= 1;
  return { ...draft, options, correctIndex };
}

export function validateCheckpoint(draft: CheckpointDraft): CheckpointErrors {
  const errors: CheckpointErrors = {};
  const question = draft.question.trim();
  if (question.length < CHECKPOINT_QUESTION_MIN) {
    errors.question = `The question needs at least ${CHECKPOINT_QUESTION_MIN} characters.`;
  } else if (question.length > CHECKPOINT_QUESTION_MAX) {
    errors.question = `Keep the question under ${CHECKPOINT_QUESTION_MAX} characters.`;
  }

  if (draft.options.length < MIN_OPTIONS || draft.options.length > MAX_OPTIONS) {
    errors.optionList = `Provide between ${MIN_OPTIONS} and ${MAX_OPTIONS} options.`;
  }

  const optionErrors = draft.options.map((option) => {
    const value = option.trim();
    if (value.length === 0) return "Options can't be empty.";
    if (value.length > CHECKPOINT_OPTION_MAX) return `Max ${CHECKPOINT_OPTION_MAX} characters.`;
    return undefined;
  });
  if (optionErrors.some(Boolean)) errors.options = optionErrors;

  if (
    !Number.isInteger(draft.correctIndex) ||
    draft.correctIndex < 0 ||
    draft.correctIndex >= draft.options.length
  ) {
    errors.correctIndex = "Choose which option is correct.";
  }

  if (draft.explanation.length > CHECKPOINT_EXPLANATION_MAX) {
    errors.explanation = `Keep the explanation under ${CHECKPOINT_EXPLANATION_MAX} characters.`;
  }
  return errors;
}

export function hasCheckpointErrors(errors: CheckpointErrors): boolean {
  return Boolean(
    errors.question ||
      errors.optionList ||
      errors.correctIndex ||
      errors.explanation ||
      errors.options?.some(Boolean),
  );
}

/** Convert a (valid) draft into the API payload. */
export function draftToCheckpointInput(draft: CheckpointDraft): CheckpointInput {
  const explanation = draft.explanation.trim();
  return {
    question: draft.question.trim(),
    options: draft.options.map((o) => o.trim()),
    correct_index: draft.correctIndex,
    explanation: explanation === "" ? null : explanation,
  };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export type StepDraftErrors = {
  title?: string;
  body?: string;
  range?: string;
  checkpoint?: CheckpointErrors;
};

export function validateStepTitle(title: string): string | undefined {
  const value = title.trim();
  if (value.length === 0) return "Give the step a title.";
  if (value.length > STEP_TITLE_MAX) return `Keep the title under ${STEP_TITLE_MAX} characters.`;
  return undefined;
}

export function validateStepDraft(input: {
  title: string;
  body: string;
  /** Pass `undefined` to skip range validation (e.g. editing an existing step). */
  range?: LineRange | null;
  maxLine?: number;
  checkpoint: CheckpointDraft | null;
}): StepDraftErrors {
  const errors: StepDraftErrors = {};
  const title = validateStepTitle(input.title);
  if (title) errors.title = title;
  if (input.body.length > STEP_BODY_MAX) {
    errors.body = `The explanation is limited to ${STEP_BODY_MAX.toLocaleString("en")} characters.`;
  }
  if (input.range !== undefined) {
    const range = validateLineRange(input.range, input.maxLine);
    if (range) errors.range = range;
  }
  if (input.checkpoint) {
    const checkpoint = validateCheckpoint(input.checkpoint);
    if (hasCheckpointErrors(checkpoint)) errors.checkpoint = checkpoint;
  }
  return errors;
}

export function hasStepErrors(errors: StepDraftErrors): boolean {
  return Boolean(errors.title || errors.body || errors.range || errors.checkpoint);
}

// ---------------------------------------------------------------------------
// Tours
// ---------------------------------------------------------------------------

export type TourDraftErrors = { title?: string; description?: string };

export function validateTourDraft(input: { title: string; description: string }): TourDraftErrors {
  const errors: TourDraftErrors = {};
  const title = input.title.trim();
  if (title.length < TOUR_TITLE_MIN) {
    errors.title = `The title needs at least ${TOUR_TITLE_MIN} characters.`;
  } else if (title.length > TOUR_TITLE_MAX) {
    errors.title = `Keep the title under ${TOUR_TITLE_MAX} characters.`;
  }
  if (input.description.length > TOUR_DESCRIPTION_MAX) {
    errors.description = `Keep the description under ${TOUR_DESCRIPTION_MAX.toLocaleString("en")} characters.`;
  }
  return errors;
}
