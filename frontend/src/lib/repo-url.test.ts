import { describe, expect, it } from "vitest";

import { REPO_URL_ERROR, parseRepoUrl, validateBranch } from "./repo-url";

describe("parseRepoUrl (mirrors backend parse_repo_url)", () => {
  it.each([
    ["https://github.com/vercel/swr", "vercel", "swr", null],
    ["http://www.github.com/pallets/flask/", "pallets", "flask", null],
    ["github.com/fastapi/typer.git", "fastapi", "typer", null],
    ["https://github.com/vercel/next.js", "vercel", "next.js", null],
    ["https://github.com/pallets/flask/tree/2.3.x", "pallets", "flask", "2.3.x"],
    ["https://github.com/o/r/tree/feature/nested-branch", "o", "r", "feature/nested-branch"],
    ["  vercel/swr  ", "vercel", "swr", null],
    ["my-org/my_repo.v2", "my-org", "my_repo.v2", null],
  ])("accepts %s", (input, owner, name, branch) => {
    expect(parseRepoUrl(input)).toEqual({ ok: true, value: { owner, name, branch } });
  });

  it.each([
    "https://gitlab.com/owner/repo",
    "https://github.com/owner",
    "-owner/repo",
    "owner/repo/extra",
    "owner repo",
    "https://github.com/owner/repo?tab=readme",
    `${"a".repeat(40)}/repo`,
  ])("rejects %s", (input) => {
    const result = parseRepoUrl(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(REPO_URL_ERROR);
  });

  it("rejects empty and over-long input with specific messages", () => {
    const empty = parseRepoUrl("   ");
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toMatch(/enter/i);

    const long = parseRepoUrl(`https://github.com/o/${"r".repeat(300)}`);
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error).toMatch(/300/);
  });
});

describe("validateBranch", () => {
  it("allows empty and normal branch names", () => {
    expect(validateBranch("")).toBeNull();
    expect(validateBranch("release/1.x")).toBeNull();
  });

  it("rejects spaces and over-long names", () => {
    expect(validateBranch("my branch")).not.toBeNull();
    expect(validateBranch("b".repeat(256))).not.toBeNull();
  });
});
