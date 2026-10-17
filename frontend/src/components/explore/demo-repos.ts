export type DemoRepo = {
  slug: `${string}/${string}`;
  language: "TypeScript" | "Python";
  blurb: string;
};

/** Small, real, public repositories that analyze quickly (well under the file cap). */
export const DEMO_REPOS: readonly DemoRepo[] = [
  { slug: "vercel/swr", language: "TypeScript", blurb: "React data-fetching hooks" },
  { slug: "pmndrs/zustand", language: "TypeScript", blurb: "Tiny state management" },
  { slug: "sindresorhus/ky", language: "TypeScript", blurb: "Fetch-based HTTP client" },
  { slug: "pallets/flask", language: "Python", blurb: "Python micro web framework" },
  { slug: "fastapi/typer", language: "Python", blurb: "CLIs from type hints" },
];
