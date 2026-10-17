import { describe, expect, it } from "vitest";

import type { GraphNode } from "@/lib/api/types";

import {
  DEFAULT_FILTERS,
  NODE_HEIGHT,
  NODE_WIDTH,
  ROOT_FOLDER,
  dirName,
  fileName,
  filterGraph,
  folderColor,
  folderHue,
  groupByFolder,
  hasActiveFilters,
  isTestPath,
  layoutGraph,
  topLevelFolder,
  type GraphFilters,
} from "./layout";

function node(path: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    path,
    language: "typescript",
    role: "STANDARD",
    in_degree: 1,
    out_degree: 1,
    pagerank: 0.1,
    is_circular: false,
    parse_warning: null,
    scc_id: null,
    loc: 10,
    exports: [],
    functions: [],
    classes: [],
    ...overrides,
  };
}

const nodes = [
  node("src/app.ts", { role: "ENTRY_POINT", in_degree: 0 }),
  node("src/lib/a.ts", { is_circular: true }),
  node("src/lib/b.ts", { is_circular: true }),
  node("src/util.py", { language: "python", role: "LEAF", out_degree: 0 }),
  node("tests/test_util.py", { language: "python", role: "ENTRY_POINT" }),
  node("README_helper.js", { language: "javascript", role: "ISOLATED", in_degree: 0, out_degree: 0 }),
];

const edges = [
  { source: "src/app.ts", target: "src/lib/a.ts" },
  { source: "src/lib/a.ts", target: "src/lib/b.ts" },
  { source: "src/lib/b.ts", target: "src/lib/a.ts" },
  { source: "src/app.ts", target: "src/util.py" },
  { source: "tests/test_util.py", target: "src/util.py" },
];

function filters(overrides: Partial<GraphFilters>): GraphFilters {
  return { ...DEFAULT_FILTERS, ...overrides };
}

describe("layoutGraph", () => {
  it("positions every node and is deterministic regardless of input order", () => {
    const a = layoutGraph(nodes, edges, { direction: "LR" });
    const b = layoutGraph([...nodes].reverse(), [...edges].reverse(), { direction: "LR" });
    expect(Object.keys(a.positions).sort()).toEqual(nodes.map((n) => n.path).sort());
    expect(b.positions).toEqual(a.positions);
    expect(a.width).toBeGreaterThan(0);
    expect(a.height).toBeGreaterThan(0);
  });

  it("orders ranks along the chosen direction", () => {
    const lr = layoutGraph(nodes, edges, { direction: "LR" });
    const tb = layoutGraph(nodes, edges, { direction: "TB" });
    expect(lr.positions["src/app.ts"]!.x).toBeLessThan(lr.positions["src/util.py"]!.x);
    expect(tb.positions["src/app.ts"]!.y).toBeLessThan(tb.positions["src/util.py"]!.y);
  });

  it("places disconnected nodes in a grid below the layered graph", () => {
    const result = layoutGraph(nodes, edges, { direction: "LR" });
    const isolated = result.positions["README_helper.js"]!;
    const connectedBottom = Math.max(
      ...edges.flatMap((e) => [e.source, e.target]).map((p) => result.positions[p]!.y + NODE_HEIGHT),
    );
    expect(isolated.y).toBeGreaterThan(connectedBottom);
  });

  it("does not overlap nodes", () => {
    const result = layoutGraph(nodes, edges, { direction: "TB" });
    const rects = Object.values(result.positions);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const p = rects[i]!;
        const q = rects[j]!;
        const overlap =
          p.x < q.x + NODE_WIDTH && q.x < p.x + NODE_WIDTH && p.y < q.y + NODE_HEIGHT && q.y < p.y + NODE_HEIGHT;
        expect(overlap).toBe(false);
      }
    }
  });

  it("ignores self-loops and edges to unknown nodes", () => {
    const result = layoutGraph(
      [node("a.ts"), node("b.ts")],
      [
        { source: "a.ts", target: "a.ts" },
        { source: "a.ts", target: "missing.ts" },
        { source: "a.ts", target: "b.ts" },
      ],
      { direction: "LR" },
    );
    expect(Object.keys(result.positions).sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("handles an empty graph", () => {
    expect(layoutGraph([], [], { direction: "LR" })).toEqual({ positions: {}, width: 0, height: 0 });
  });
});

describe("folders", () => {
  it("derives the grouping folder", () => {
    expect(topLevelFolder("README.md")).toBe(ROOT_FOLDER);
    expect(topLevelFolder("backend/app/main.py")).toBe("backend");
    expect(topLevelFolder("src/api/client.ts")).toBe("src/api");
    expect(topLevelFolder("src/index.ts")).toBe("src");
    expect(topLevelFolder("packages/core/src/x.ts")).toBe("packages/core");
  });

  it("assigns deterministic hues and colours", () => {
    expect(folderHue("backend")).toBe(folderHue("backend"));
    expect(folderHue("backend")).toBeGreaterThanOrEqual(0);
    expect(folderHue("backend")).toBeLessThan(360);
    const hues = new Set(["backend", "frontend", "docs", "scripts", "infra"].map(folderHue));
    expect(hues.size).toBeGreaterThan(1);
    expect(folderColor("backend")).toBe(`oklch(0.72 0.15 ${folderHue("backend")})`);
    expect(folderColor(ROOT_FOLDER)).not.toContain("NaN");
  });

  it("groups paths by folder in sorted order", () => {
    const groups = groupByFolder(["b/x.ts", "a/z.ts", "a/y.ts", "root.ts"]);
    expect(groups.map((g) => g.folder)).toEqual([ROOT_FOLDER, "a", "b"]);
    expect(groups[1]!.paths).toEqual(["a/y.ts", "a/z.ts"]);
    expect(groups[1]!.color).toBe(folderColor("a"));
  });
});

describe("filterGraph", () => {
  const graph = { nodes };

  it("returns every node without filters", () => {
    expect(filterGraph(graph, DEFAULT_FILTERS).size).toBe(nodes.length);
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
  });

  it("filters by query terms (case-insensitive, all terms)", () => {
    expect([...filterGraph(graph, filters({ query: "LIB" }))]).toEqual(["src/lib/a.ts", "src/lib/b.ts"]);
    expect([...filterGraph(graph, filters({ query: "src a" }))]).toEqual(["src/app.ts", "src/lib/a.ts"]);
    expect(hasActiveFilters(filters({ query: "x" }))).toBe(true);
    expect(hasActiveFilters(filters({ query: "   " }))).toBe(false);
  });

  it("filters by role and language", () => {
    expect([...filterGraph(graph, filters({ roles: new Set(["ENTRY_POINT"]) }))]).toEqual([
      "src/app.ts",
      "tests/test_util.py",
    ]);
    expect([...filterGraph(graph, filters({ languages: new Set(["python"]) }))]).toEqual([
      "src/util.py",
      "tests/test_util.py",
    ]);
  });

  it("isolates cycles and hides isolated/test files", () => {
    expect([...filterGraph(graph, filters({ cyclesOnly: true }))]).toEqual(["src/lib/a.ts", "src/lib/b.ts"]);
    expect(filterGraph(graph, filters({ hideIsolated: true })).has("README_helper.js")).toBe(false);
    expect(filterGraph(graph, filters({ hideTests: true })).has("tests/test_util.py")).toBe(false);
  });
});

describe("path helpers", () => {
  it("detects test files", () => {
    for (const p of [
      "tests/x.py",
      "pkg/__tests__/a.ts",
      "app/test_models.py",
      "app/models_test.py",
      "conftest.py",
      "src/a.test.tsx",
      "src/b.spec.js",
    ]) {
      expect(isTestPath(p), p).toBe(true);
    }
    for (const p of ["src/testing_utils_impl.ts", "src/contest.py", "src/latest.ts"]) {
      expect(isTestPath(p), p).toBe(false);
    }
  });

  it("splits file and dir names", () => {
    expect(fileName("a/b/c.ts")).toBe("c.ts");
    expect(fileName("c.ts")).toBe("c.ts");
    expect(dirName("a/b/c.ts")).toBe("a/b");
    expect(dirName("c.ts")).toBe("");
  });
});
