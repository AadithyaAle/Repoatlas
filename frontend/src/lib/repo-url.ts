/**
 * Client-side mirror of `parse_repo_url` in backend/app/schemas/atlas.py. Keep the regexes in
 * sync with the backend (`_GITHUB_URL` and `_SHORT`).
 */

// Groups: 1 = owner, 2 = name, 3 = branch
const GITHUB_URL =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?(?:\/tree\/([^?#]+))?\/?$/;
// Groups: 1 = owner, 2 = name
const SHORT = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/;

export const REPO_URL_MAX_LENGTH = 300;
export const BRANCH_MAX_LENGTH = 255;
export const REPO_URL_ERROR =
  "Expected a public GitHub repository URL like https://github.com/owner/repo";

export type ParsedRepo = { owner: string; name: string; branch: string | null };

export type RepoUrlResult = { ok: true; value: ParsedRepo } | { ok: false; error: string };

export function parseRepoUrl(input: string): RepoUrlResult {
  const value = input.trim();
  if (value === "") return { ok: false, error: "Enter a GitHub repository URL or owner/name." };
  if (value.length > REPO_URL_MAX_LENGTH) {
    return { ok: false, error: `Must be at most ${REPO_URL_MAX_LENGTH} characters.` };
  }
  const long = GITHUB_URL.exec(value);
  if (long?.[1] && long[2]) {
    return { ok: true, value: { owner: long[1], name: long[2], branch: long[3] ?? null } };
  }
  const short = SHORT.exec(value);
  if (short?.[1] && short[2]) {
    return { ok: true, value: { owner: short[1], name: short[2], branch: null } };
  }
  return { ok: false, error: REPO_URL_ERROR };
}

export function validateBranch(input: string): string | null {
  const value = input.trim();
  if (value.length > BRANCH_MAX_LENGTH) return `Must be at most ${BRANCH_MAX_LENGTH} characters.`;
  if (/\s/.test(value)) return "Branch names can't contain spaces.";
  return null;
}
