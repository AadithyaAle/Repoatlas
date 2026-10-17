import { describe, expect, it } from "vitest";

import { isAnalysisTerminal } from "./api/hooks";
import {
  describeFailure,
  getProgressPercent,
  getStepStates,
  inferFailedStep,
} from "./analysis-steps";

const states = (...args: Parameters<typeof getStepStates>) =>
  getStepStates(...args).map((s) => s.state);

describe("getStepStates", () => {
  it("marks the first step current while pending", () => {
    expect(states("PENDING")).toEqual(["current", "upcoming", "upcoming", "upcoming", "upcoming"]);
  });

  it("marks earlier steps complete and the active one current", () => {
    expect(states("PARSING_AST")).toEqual([
      "complete",
      "complete",
      "current",
      "upcoming",
      "upcoming",
    ]);
  });

  it("marks every step complete when the analysis completed", () => {
    expect(states("COMPLETED")).toEqual(Array(5).fill("complete"));
  });

  it("marks the failed step and leaves later ones upcoming", () => {
    expect(states("FAILED", "COMPUTING_GRAPH")).toEqual([
      "complete",
      "complete",
      "complete",
      "failed",
      "upcoming",
    ]);
    expect(states("FAILED")).toEqual(["failed", "upcoming", "upcoming", "upcoming", "upcoming"]);
  });
});

describe("inferFailedStep", () => {
  it("prefers the last status observed while polling", () => {
    expect(
      inferFailedStep({ lastActiveStatus: "COMPUTING_GRAPH", errorCode: "GITHUB_RATE_LIMITED" }),
    ).toBe("COMPUTING_GRAPH");
  });

  it("attributes GitHub errors to fetching the tree", () => {
    expect(inferFailedStep({ errorCode: "GITHUB_REPO_NOT_FOUND", startedAt: null })).toBe(
      "FETCHING_TREE",
    );
    expect(inferFailedStep({ errorCode: "REPO_TOO_LARGE" })).toBe("FETCHING_TREE");
  });

  it("falls back on whether a worker ever started the job", () => {
    expect(inferFailedStep({ errorCode: "INTERNAL_ERROR", startedAt: null })).toBe("PENDING");
    expect(inferFailedStep({ errorCode: "INTERNAL_ERROR", startedAt: "2026-01-01T00:00:00Z" })).toBe(
      "PARSING_AST",
    );
  });
});

describe("progress + terminal helpers", () => {
  it("computes progress percentages", () => {
    expect(getProgressPercent("PENDING")).toBe(0);
    expect(getProgressPercent("PARSING_AST")).toBe(50);
    expect(getProgressPercent("COMPLETED")).toBe(100);
  });

  it("knows when to stop polling", () => {
    expect(isAnalysisTerminal("COMPLETED")).toBe(true);
    expect(isAnalysisTerminal("FAILED")).toBe(true);
    expect(isAnalysisTerminal("COMPUTING_GRAPH")).toBe(false);
    expect(isAnalysisTerminal(undefined)).toBe(false);
  });
});

describe("describeFailure", () => {
  it("gives code-specific messaging", () => {
    expect(describeFailure("GITHUB_RATE_LIMITED")).toMatchObject({
      retryable: true,
      suggestSignIn: true,
    });
    expect(describeFailure("GITHUB_REPO_NOT_FOUND").retryable).toBe(false);
    expect(describeFailure("REPO_TOO_LARGE").title).toMatch(/too large/i);
    expect(describeFailure(null, "boom")).toMatchObject({ description: "boom", retryable: true });
  });
});
