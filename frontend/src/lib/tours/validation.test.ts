import { describe, expect, it } from "vitest";

import {
  addOption,
  checkpointToDraft,
  draftToCheckpointInput,
  emptyCheckpointDraft,
  hasCheckpointErrors,
  hasStepErrors,
  MAX_OPTIONS,
  removeOption,
  validateCheckpoint,
  validateStepDraft,
  validateTourDraft,
} from "./validation";

const valid = {
  question: "What does this do?",
  options: ["Parses", "Renders", "Nothing"],
  correctIndex: 1,
  explanation: "",
};

describe("checkpoint validation", () => {
  it("accepts a valid checkpoint", () => {
    expect(hasCheckpointErrors(validateCheckpoint(valid))).toBe(false);
  });

  it("rejects short questions, empty options and out-of-range answers", () => {
    const errors = validateCheckpoint({
      question: "?",
      options: ["a", " "],
      correctIndex: 2,
      explanation: "",
    });
    expect(errors.question).toBeDefined();
    expect(errors.options?.[1]).toBeDefined();
    expect(errors.options?.[0]).toBeUndefined();
    expect(errors.correctIndex).toBeDefined();
    expect(hasCheckpointErrors(errors)).toBe(true);
  });

  it("enforces option count", () => {
    expect(validateCheckpoint({ ...valid, options: ["only"], correctIndex: 0 }).optionList).toBeDefined();
    expect(
      validateCheckpoint({ ...valid, options: Array(7).fill("x"), correctIndex: 0 }).optionList,
    ).toBeDefined();
  });
});

describe("option editing", () => {
  it("adds options up to the maximum", () => {
    let draft = emptyCheckpointDraft();
    for (let i = 0; i < 10; i++) draft = addOption(draft);
    expect(draft.options).toHaveLength(MAX_OPTIONS);
  });

  it("keeps the correct answer when removing other options", () => {
    expect(removeOption(valid, 0)).toMatchObject({ options: ["Renders", "Nothing"], correctIndex: 0 });
    expect(removeOption(valid, 2).correctIndex).toBe(1);
    expect(removeOption(valid, 1).correctIndex).toBe(0);
    const two = { ...valid, options: ["a", "b"] };
    expect(removeOption(two, 0)).toBe(two);
  });
});

describe("conversion", () => {
  it("round-trips through the API shape", () => {
    const input = draftToCheckpointInput({ ...valid, question: "  Q?? ", explanation: "  " });
    expect(input).toEqual({
      question: "Q??",
      options: valid.options,
      correct_index: 1,
      explanation: null,
    });
    expect(checkpointToDraft({ ...input, explanation: "why" })).toEqual({
      question: "Q??",
      options: valid.options,
      correctIndex: 1,
      explanation: "why",
    });
    expect(checkpointToDraft({ question: "Q", options: ["a", "b"] })?.correctIndex).toBe(0);
    expect(checkpointToDraft(null)).toBeNull();
  });
});

describe("step + tour validation", () => {
  it("validates step drafts", () => {
    expect(
      hasStepErrors(
        validateStepDraft({ title: "Intro", body: "", range: { start: 1, end: 5 }, checkpoint: null }),
      ),
    ).toBe(false);
    const errors = validateStepDraft({
      title: "   ",
      body: "x".repeat(20_001),
      range: { start: 1, end: 500 },
      checkpoint: { ...valid, question: "" },
    });
    expect(errors.title).toBeDefined();
    expect(errors.body).toBeDefined();
    expect(errors.range).toBeDefined();
    expect(errors.checkpoint?.question).toBeDefined();
    expect(validateStepDraft({ title: "x".repeat(201), body: "", checkpoint: null }).title).toBeDefined();
  });

  it("skips range validation when the range is omitted", () => {
    expect(validateStepDraft({ title: "ok", body: "", checkpoint: null }).range).toBeUndefined();
  });

  it("validates tour drafts", () => {
    expect(validateTourDraft({ title: "ab", description: "" }).title).toBeDefined();
    expect(validateTourDraft({ title: "Auth flow", description: "" })).toEqual({});
    expect(validateTourDraft({ title: "Auth flow", description: "x".repeat(5001) }).description).toBeDefined();
  });
});
