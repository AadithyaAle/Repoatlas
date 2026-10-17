import { describe, expect, it } from "vitest";

import type { Graph, GraphNode } from "@/lib/api/types";

import {
  buildArchitectureReport,
  buildMermaid,
  computeRisks,
  reportFileName,
  riskLevel,
} from "./architecture-report";

const node = (path: string, overrides: Partial<GraphNode> = {}): GraphNode => ({
  path,
  language: "typescript",
  loc: 10,
  in_degree: 0,
  out_degree: 0,
  role: "STANDARD",
  pagerank: 0.1,
  is_circular: false,
  scc_id: null,
  parse_warning: null,
  exports: [],
  functions: [],
  classes: [],
  ...overrides,
});

const edge = (source: string, target: string, is_circular = false) => ({
  source,
  target,
  kind: "static" as const,
  line: 1,
  is_circular,
});

// Diamond a -> b, a -> c, b -> d, c -> d (same fixture as the backend tests).
const diamond: Graph = {
  analysis_id: "00000000-0000-0000-0000-000000000000",
  commit_sha: "abcdef1234567890abcdef1234567890abcdef12",
  nodes: [
    node("a.ts", { role: "ENTRY_POINT", out_degree: 2, pagerank: 0.1 }),
    node("b.ts", { in_degree: 1, out_degree: 1, pagerank: 0.2 }),
    node("c.ts", { in_degree: 1, out_degree: 1, pagerank: 0.2 }),
    node("d.ts", { role: "LEAF", in_degree: 2, pagerank: 0.5 }),
  ],
  edges: [edge("a.ts", "b.ts"), edge("a.ts", "c.ts"), edge("b.ts", "d.ts"), edge("c.ts", "d.ts")],
  cycles: [],
};

const repo = { owner: "acme", name: "shop", htmlUrl: "https://github.com/acme/shop" };

describe("computeRisks", () => {
  it("matches the backend reverse-BFS formulas", () => {
    const d = computeRisks(diamond).find((r) => r.path === "d.ts");
    // impacted b, c (depth 1) and a (depth 2): risk = (1 + 1 + 0.5) / 3 * 100
    expect(d).toEqual({
      path: "d.ts",
      direct: 2,
      transitive: 1,
      impactPercentage: 100,
      riskScore: 83.33,
      level: "CRITICAL",
    });
    expect(computeRisks(diamond).find((r) => r.path === "a.ts")?.riskScore).toBe(0);
  });

  it("ignores self-imports and handles single-file graphs", () => {
    const single: Graph = { ...diamond, nodes: [node("x.ts")], edges: [edge("x.ts", "x.ts")] };
    expect(computeRisks(single)[0]).toMatchObject({ riskScore: 0, impactPercentage: 0 });
  });

  it.each([
    [4.99, "LOW"],
    [5, "MEDIUM"],
    [15, "HIGH"],
    [35, "CRITICAL"],
  ] as const)("riskLevel(%s) = %s", (score, level) => {
    expect(riskLevel(score)).toBe(level);
  });
});

describe("buildMermaid", () => {
  it("draws the top nodes by pagerank, deduplicates edges and marks cycles", () => {
    const graph: Graph = {
      ...diamond,
      edges: [...diamond.edges, edge("b.ts", "d.ts"), edge("d.ts", "b.ts", true)],
    };
    const mermaid = buildMermaid(graph, 2);
    expect(mermaid).toContain('n0["d.ts"]');
    expect(mermaid).toContain('n1["b.ts"]');
    expect(mermaid).not.toContain("a.ts");
    expect(mermaid.match(/n1 --> n0/g)).toHaveLength(1);
    expect(mermaid).toContain("n0 -.->|cycle| n1");
    expect(mermaid).toMatch(/^```mermaid\nflowchart LR/);
  });
});

describe("buildArchitectureReport", () => {
  const report = buildArchitectureReport({
    graph: diamond,
    repo,
    generatedAt: new Date("2026-10-17T12:00:00Z"),
  });

  it("includes summary, diagram, risk table and pinned permalinks", () => {
    expect(report).toContain("# Architecture report — acme/shop");
    expect(report).toContain("2026-10-17");
    expect(report).toContain("| Source files analyzed | 4 |");
    expect(report).toContain("```mermaid");
    expect(report).toContain(
      "| [`d.ts`](https://github.com/acme/shop/blob/abcdef1234567890abcdef1234567890abcdef12/d.ts) | 83.33 | CRITICAL | 2 | 1 | 100% |",
    );
    expect(report).toContain("_No circular imports detected._");
    expect(report).not.toContain("## Parse warnings");
  });

  it("lists cycles and parse warnings when present", () => {
    const withIssues: Graph = {
      ...diamond,
      nodes: diamond.nodes.map((n) =>
        n.path === "b.ts" ? { ...n, parse_warning: "Syntax error line 3: unexpected | token" } : n,
      ),
      cycles: [["b.ts", "d.ts"]],
    };
    const text = buildArchitectureReport({ graph: withIssues, repo: null, generatedAt: new Date() });
    expect(text).toContain("1. `b.ts` → `d.ts` → `b.ts`");
    expect(text).toContain("Syntax error line 3: unexpected \\| token");
    expect(text).toContain("# Architecture report — Repository");
  });

  it("builds a safe file name", () => {
    expect(reportFileName(repo, diamond.commit_sha)).toBe("ARCHITECTURE-acme-shop-abcdef1.md");
  });
});
