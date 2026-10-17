/**
 * Pure step-navigation / unlock rules for the tour player.
 *
 * Signed-in trainees progress linearly: every step up to (and including) the first incomplete
 * one is reachable, and "Next" unlocks once the current step is completed. Signed-out visitors
 * can browse every step read-only.
 */

export type StepIndex = number | "done";

export type NavigationState = {
  stepIds: readonly string[];
  completed: ReadonlySet<string>;
  signedIn: boolean;
};

/** Index of the first step not yet completed; `stepIds.length` when all are done. */
export function firstIncompleteIndex(
  stepIds: readonly string[],
  completed: ReadonlySet<string>,
): number {
  const idx = stepIds.findIndex((id) => !completed.has(id));
  return idx === -1 ? stepIds.length : idx;
}

export function isTourComplete(stepIds: readonly string[], completed: ReadonlySet<string>): boolean {
  return stepIds.length > 0 && stepIds.every((id) => completed.has(id));
}

/** Highest step index the user may open. */
export function maxReachableIndex({ stepIds, completed, signedIn }: NavigationState): number {
  if (stepIds.length === 0) return 0;
  if (!signedIn) return stepIds.length - 1;
  return Math.min(firstIncompleteIndex(stepIds, completed), stepIds.length - 1);
}

export function isStepReachable(index: number, state: NavigationState): boolean {
  if (index < 0 || index >= state.stepIds.length) return false;
  if (!state.signedIn) return true;
  const id = state.stepIds[index];
  if (id !== undefined && state.completed.has(id)) return true;
  return index <= maxReachableIndex(state);
}

/** Whether "Next"/"Finish" is enabled on step `index`. */
export function canAdvance(index: number, state: NavigationState): boolean {
  if (index < 0 || index >= state.stepIds.length) return false;
  if (!state.signedIn) return true;
  const id = state.stepIds[index];
  return id !== undefined && state.completed.has(id);
}

/** Parse the 1-based `?step=` param. `"done"` → completion screen; invalid → `null`. */
export function parseStepParam(value: string | null | undefined): StepIndex | null {
  if (value === null || value === undefined || value === "") return null;
  if (value === "done") return "done";
  if (!/^\d+$/.test(value)) return null;
  const n = Number.parseInt(value, 10);
  return n >= 1 ? n - 1 : null;
}

/** Serialise a step index for the URL (1-based). */
export function formatStepParam(index: StepIndex): string {
  return index === "done" ? "done" : String(index + 1);
}

/**
 * Decide which step to show from the URL param and progress.
 * - no param: signed-in users resume at the first incomplete step (completion screen when all
 *   done); visitors start at step 1;
 * - numeric param: clamped to the reachable range;
 * - `done`: only once every step is complete (signed-in) — visitors may always see it.
 */
export function resolveStepIndex(param: StepIndex | null, state: NavigationState): StepIndex {
  const total = state.stepIds.length;
  if (total === 0) return 0;
  const complete = isTourComplete(state.stepIds, state.completed);
  const max = maxReachableIndex(state);

  if (param === "done") {
    if (!state.signedIn || complete) return "done";
    return max;
  }
  if (param === null) {
    if (!state.signedIn) return 0;
    return complete ? "done" : max;
  }
  if (isStepReachable(param, state)) return param;
  return Math.max(0, Math.min(param, max));
}

/** 0–100 rounded. */
export function percentComplete(stepIds: readonly string[], completed: ReadonlySet<string>): number {
  if (stepIds.length === 0) return 0;
  const done = stepIds.filter((id) => completed.has(id)).length;
  return Math.round((done / stepIds.length) * 100);
}

/** Immutable array move (for reordering). Out-of-range indices return a copy unchanged. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const result = [...items];
  if (from < 0 || from >= result.length || to < 0 || to >= result.length || from === to) {
    return result;
  }
  const [item] = result.splice(from, 1);
  if (item !== undefined) result.splice(to, 0, item);
  return result;
}
