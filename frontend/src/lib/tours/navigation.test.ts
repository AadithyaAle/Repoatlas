import { describe, expect, it } from "vitest";

import {
  canAdvance,
  firstIncompleteIndex,
  formatStepParam,
  isStepReachable,
  isTourComplete,
  maxReachableIndex,
  moveItem,
  parseStepParam,
  percentComplete,
  resolveStepIndex,
} from "./navigation";

const ids = ["a", "b", "c", "d"];
const state = (completed: string[], signedIn = true) => ({
  stepIds: ids,
  completed: new Set(completed),
  signedIn,
});

describe("firstIncompleteIndex / isTourComplete", () => {
  it("finds the first incomplete step", () => {
    expect(firstIncompleteIndex(ids, new Set())).toBe(0);
    expect(firstIncompleteIndex(ids, new Set(["a", "b"]))).toBe(2);
    expect(firstIncompleteIndex(ids, new Set(["a", "c"]))).toBe(1);
    expect(firstIncompleteIndex(ids, new Set(ids))).toBe(4);
  });

  it("knows when a tour is complete", () => {
    expect(isTourComplete(ids, new Set(ids))).toBe(true);
    expect(isTourComplete(ids, new Set(["a"]))).toBe(false);
    expect(isTourComplete([], new Set())).toBe(false);
  });
});

describe("reachability", () => {
  it("lets signed-in users reach steps up to the first incomplete one", () => {
    expect(maxReachableIndex(state(["a"]))).toBe(1);
    expect(isStepReachable(1, state(["a"]))).toBe(true);
    expect(isStepReachable(2, state(["a"]))).toBe(false);
    expect(maxReachableIndex(state(ids))).toBe(3);
  });

  it("allows revisiting completed steps beyond a gap", () => {
    expect(isStepReachable(2, state(["a", "c"]))).toBe(true);
  });

  it("lets visitors browse everything", () => {
    expect(maxReachableIndex(state([], false))).toBe(3);
    expect(isStepReachable(3, state([], false))).toBe(true);
    expect(isStepReachable(4, state([], false))).toBe(false);
  });

  it("gates Next on completion for signed-in users only", () => {
    expect(canAdvance(0, state([]))).toBe(false);
    expect(canAdvance(0, state(["a"]))).toBe(true);
    expect(canAdvance(0, state([], false))).toBe(true);
    expect(canAdvance(9, state([], false))).toBe(false);
  });
});

describe("step param", () => {
  it("parses 1-based params", () => {
    expect(parseStepParam("1")).toBe(0);
    expect(parseStepParam("4")).toBe(3);
    expect(parseStepParam("done")).toBe("done");
    expect(parseStepParam("0")).toBeNull();
    expect(parseStepParam("-1")).toBeNull();
    expect(parseStepParam("abc")).toBeNull();
    expect(parseStepParam(null)).toBeNull();
  });

  it("formats params", () => {
    expect(formatStepParam(0)).toBe("1");
    expect(formatStepParam("done")).toBe("done");
  });
});

describe("resolveStepIndex", () => {
  it("resumes signed-in users at the first incomplete step", () => {
    expect(resolveStepIndex(null, state(["a", "b"]))).toBe(2);
    expect(resolveStepIndex(null, state(ids))).toBe("done");
    expect(resolveStepIndex(null, state(["a"], false))).toBe(0);
  });

  it("clamps locked steps to the reachable range", () => {
    expect(resolveStepIndex(3, state(["a"]))).toBe(1);
    expect(resolveStepIndex(0, state(["a"]))).toBe(0);
    expect(resolveStepIndex(99, state([], false))).toBe(3);
  });

  it("only shows the completion screen once everything is done", () => {
    expect(resolveStepIndex("done", state(["a"]))).toBe(1);
    expect(resolveStepIndex("done", state(ids))).toBe("done");
    expect(resolveStepIndex("done", state([], false))).toBe("done");
  });

  it("handles empty tours", () => {
    expect(resolveStepIndex(null, { stepIds: [], completed: new Set(), signedIn: true })).toBe(0);
  });
});

describe("percentComplete / moveItem", () => {
  it("computes percentages", () => {
    expect(percentComplete(ids, new Set(["a"]))).toBe(25);
    expect(percentComplete(ids, new Set(["a", "zzz"]))).toBe(25);
    expect(percentComplete([], new Set())).toBe(0);
  });

  it("moves items immutably", () => {
    const input = ["a", "b", "c"];
    expect(moveItem(input, 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(input, 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(input, 1, 5)).toEqual(input);
    expect(input).toEqual(["a", "b", "c"]);
  });
});
