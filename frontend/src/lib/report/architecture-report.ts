/**
 * Builds a self-contained ARCHITECTURE.md from an analysis graph. Pure and deterministic: the
 * same graph always yields the same report (apart from the injected timestamp).
 *
 * Blast-radius numbers use the same formulas as the backend engine
 * (backend/app/engine/graph_algorithms.py): impact% = impacted / (N − 1) × 100 and
 * risk = Σ(1 / depth) / (N − 1) × 100, both rounded to 2 decimals.
 */
import type { FileRole, Graph, GraphNode } from "@/lib/api/types";

export type ReportRepo = { owner: string; name: string; htmlUrl: string };

export type ReportInput = {
  graph: Graph;
  repo: ReportRepo | null;
  generatedAt: Date;
  /** Max nodes drawn in the Mermaid diagram (keeps it readable). */
  diagramNodes?: number;
  riskyFiles?: number;
};

export type FileRisk = {
  path: string;
  direct: number;
  transitive: number;
  impactPercentage: number;
  riskScore: number;
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
};

const ROLE_LABEL: Record<FileRole, string> = {
  ENTRY_POINT: "Entry point",
  CORE_UTILITY: "Core utility",
  GOD_MODULE: "God module",
  LEAF: "Leaf",
  ISOLATED: "Isolated",
  STANDARD: "Standard",
};
const ROLE_ORDER: FileRole[] = [
  "GOD_MODULE",
  "CORE_UTILITY",
  "ENTRY_POINT",
  "STANDARD",
  "LEAF",
  "ISOLATED",
];
const ROLE_RULE: Record<FileRole, string> = {
  GOD_MODULE: "in ≥ 5 and out ≥ 5",
  CORE_UTILITY: "in ≥ 5 and out ≤ 2",
  ENTRY_POINT: "in = 0 and out > 0",
  STANDARD: "everything else",
  LEAF: "in > 0 and out = 0",
  ISOLATED: "in = 0 and out = 0",
};
const MERMAID_CLASS: Record<FileRole, string> = {
  GOD_MODULE: "fill:#7f1d1d,stroke:#f87171,color:#fff",
  CORE_UTILITY: "fill:#0c4a6e,stroke:#38bdf8,color:#fff",
  ENTRY_POINT: "fill:#064e3b,stroke:#34d399,color:#fff",
  STANDARD: "fill:#27272a,stroke:#a1a1aa,color:#fff",
  LEAF: "fill:#3b0764,stroke:#c084fc,color:#fff",
  ISOLATED: "fill:#18181b,stroke:#52525b,color:#d4d4d8",
};
const MAX_LISTED = 10;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function riskLevel(score: number): FileRisk["level"] {
  if (score < 5) return "LOW";
  if (score < 15) return "MEDIUM";
  if (score < 35) return "HIGH";
  return "CRITICAL";
}

/** Reverse BFS from every file (who imports it, transitively). Self-imports are ignored. */
export function computeRisks(graph: Graph): FileRisk[] {
  const reverse = new Map<string, string[]>();
  for (const node of graph.nodes) reverse.set(node.path, []);
  for (const edge of graph.edges) {
    if (edge.source !== edge.target) reverse.get(edge.target)?.push(edge.source);
  }
  const denominator = graph.nodes.length - 1;
  return graph.nodes.map(({ path }) => {
    const depth = new Map<string, number>([[path, 0]]);
    const queue = [path];
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head] as string;
      const next = (depth.get(current) ?? 0) + 1;
      for (const importer of reverse.get(current) ?? []) {
        if (depth.has(importer)) continue;
        depth.set(importer, next);
        queue.push(importer);
      }
    }
    depth.delete(path);
    let direct = 0;
    let weighted = 0;
    for (const d of depth.values()) {
      if (d === 1) direct++;
      weighted += 1 / d;
    }
    const riskScore = denominator > 0 ? round2((weighted / denominator) * 100) : 0;
    return {
      path,
      direct,
      transitive: depth.size - direct,
      impactPercentage: denominator > 0 ? round2((depth.size / denominator) * 100) : 0,
      riskScore,
      level: riskLevel(riskScore),
    };
  });
}

/** Escapes text for Markdown table cells. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function code(text: string): string {
  return `\`${text.replace(/`/g, "'")}\``;
}

function fileLink(path: string, repo: ReportRepo | null, sha: string): string {
  if (!repo) return code(path);
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `[${code(path)}](${repo.htmlUrl}/blob/${sha}/${encoded})`;
}

function mermaidLabel(path: string): string {
  const parts = path.split("/");
  const file = parts.pop() ?? path;
  const dir = parts.slice(-2).join("/");
  const label = dir ? `${file}<br/>${dir}` : file;
  return label.replace(/"/g, "#quot;");
}

/** Mermaid flowchart of the most central files (PageRank) and the imports among them. */
export function buildMermaid(graph: Graph, maxNodes: number): string {
  const top = [...graph.nodes]
    .sort((a, b) => b.pagerank - a.pagerank || a.path.localeCompare(b.path))
    .slice(0, maxNodes);
  const ids = new Map(top.map((n, i) => [n.path, `n${i}`]));
  const lines = ["```mermaid", "flowchart LR"];
  for (const node of top) lines.push(`  ${ids.get(node.path)}["${mermaidLabel(node.path)}"]`);
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    const from = ids.get(edge.source);
    const to = ids.get(edge.target);
    if (!from || !to || from === to || seen.has(`${from}>${to}`)) continue;
    seen.add(`${from}>${to}`);
    lines.push(`  ${from} ${edge.is_circular ? "-.->|cycle|" : "-->"} ${to}`);
  }
  const usedRoles = ROLE_ORDER.filter((role) => top.some((n) => n.role === role));
  for (const role of usedRoles) {
    lines.push(`  classDef ${role.toLowerCase()} ${MERMAID_CLASS[role]}`);
    const members = top.filter((n) => n.role === role).map((n) => ids.get(n.path));
    lines.push(`  class ${members.join(",")} ${role.toLowerCase()}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function listByRole(nodes: GraphNode[], role: FileRole, repo: ReportRepo | null, sha: string) {
  const members = nodes
    .filter((n) => n.role === role)
    .sort((a, b) => b.in_degree - a.in_degree || a.path.localeCompare(b.path));
  if (members.length === 0) return "_None._";
  const rows = members
    .slice(0, MAX_LISTED)
    .map((n) => `| ${fileLink(n.path, repo, sha)} | ${n.in_degree} | ${n.out_degree} |`);
  const more = members.length > MAX_LISTED ? `\n\n…and ${members.length - MAX_LISTED} more.` : "";
  return ["| File | Imported by | Imports |", "|---|---:|---:|", ...rows].join("\n") + more;
}

export function buildArchitectureReport({
  graph,
  repo,
  generatedAt,
  diagramNodes = 15,
  riskyFiles = 10,
}: ReportInput): string {
  const sha = graph.commit_sha;
  const nodes = graph.nodes;
  const title = repo ? `${repo.owner}/${repo.name}` : "Repository";
  const commitRef = repo ? `[\`${sha.slice(0, 7)}\`](${repo.htmlUrl}/tree/${sha})` : code(sha);

  const roleCounts = new Map<FileRole, number>();
  const languageCounts = new Map<string, number>();
  let loc = 0;
  for (const n of nodes) {
    roleCounts.set(n.role, (roleCounts.get(n.role) ?? 0) + 1);
    languageCounts.set(n.language, (languageCounts.get(n.language) ?? 0) + 1);
    loc += n.loc;
  }
  const circularFiles = nodes.filter((n) => n.is_circular).length;
  const warnings = nodes.filter((n) => n.parse_warning);
  const risks = computeRisks(graph)
    .filter((r) => r.riskScore > 0)
    .sort((a, b) => b.riskScore - a.riskScore || a.path.localeCompare(b.path))
    .slice(0, riskyFiles);
  const pct = (n: number) => (nodes.length ? `${Math.round((n / nodes.length) * 100)}%` : "0%");

  const sections: string[] = [
    `# Architecture report — ${title}`,
    `> Generated by [RepoAtlas](https://aadithyaale.github.io/Repoatlas/) on ${generatedAt.toISOString().slice(0, 10)} from commit ${commitRef}. ` +
      "Figures come from static import analysis (Python `ast`, tree-sitter for JS/TS); external packages are not edges.",
    "## Summary",
    [
      "| Metric | Value |",
      "|---|---:|",
      `| Source files analyzed | ${nodes.length} |`,
      `| Lines of code | ${loc.toLocaleString("en-US")} |`,
      `| Internal imports (edges) | ${graph.edges.length} |`,
      `| Import cycles | ${graph.cycles.length}${graph.cycles.length >= 100 ? "+" : ""} |`,
      `| Files in a cycle | ${circularFiles} |`,
      `| God modules | ${roleCounts.get("GOD_MODULE") ?? 0} |`,
      `| Files with parse warnings | ${warnings.length} |`,
    ].join("\n"),
    "## Most central files",
    "The diagram shows the files with the highest PageRank (importance flows from importer to " +
      "imported file) and the imports between them. Dotted arrows are part of a cycle.",
    buildMermaid(graph, diagramNodes),
    "## Riskiest files to change",
    "Reverse-BFS blast radius: how much of the codebase transitively imports each file. " +
      "Risk weights direct dependents fully and distant ones less (1 / depth).",
    risks.length === 0
      ? "_No file is imported by another file._"
      : [
          "| File | Risk | Level | Direct | Transitive | Impact |",
          "|---|---:|---|---:|---:|---:|",
          ...risks.map(
            (r) =>
              `| ${fileLink(r.path, repo, sha)} | ${r.riskScore} | ${r.level} | ${r.direct} | ${r.transitive} | ${r.impactPercentage}% |`,
          ),
        ].join("\n"),
    "## Architectural roles",
    [
      "| Role | Rule | Files | Share |",
      "|---|---|---:|---:|",
      ...ROLE_ORDER.map(
        (role) =>
          `| ${ROLE_LABEL[role]} | ${ROLE_RULE[role]} | ${roleCounts.get(role) ?? 0} | ${pct(roleCounts.get(role) ?? 0)} |`,
      ),
    ].join("\n"),
    "### God modules",
    "Imported by many files *and* importing many: the riskiest coupling hotspots.",
    listByRole(nodes, "GOD_MODULE", repo, sha),
    "### Core utilities",
    listByRole(nodes, "CORE_UTILITY", repo, sha),
    "### Entry points",
    listByRole(nodes, "ENTRY_POINT", repo, sha),
    "## Import cycles",
    graph.cycles.length === 0
      ? "_No circular imports detected._"
      : [
          ...graph.cycles
            .slice(0, MAX_LISTED)
            .map((cycle, i) => `${i + 1}. ${[...cycle, cycle[0] ?? ""].map(code).join(" → ")}`),
          graph.cycles.length > MAX_LISTED
            ? `\n…and ${graph.cycles.length - MAX_LISTED} more.`
            : "",
        ]
          .join("\n")
          .trimEnd(),
    "## Languages",
    [
      "| Language | Files | Share |",
      "|---|---:|---:|",
      ...[...languageCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([lang, count]) => `| ${lang} | ${count} | ${pct(count)} |`),
    ].join("\n"),
  ];
  if (warnings.length > 0) {
    sections.push(
      "## Parse warnings",
      "These files contained syntax the parser had to recover from; their imports may be incomplete.",
      warnings
        .slice(0, MAX_LISTED)
        .map((n) => `- ${fileLink(n.path, repo, sha)}: ${cell(n.parse_warning ?? "")}`)
        .join("\n"),
    );
  }
  return `${sections.join("\n\n")}\n`;
}

export function reportFileName(repo: ReportRepo | null, sha: string): string {
  const slug = repo ? `${repo.owner}-${repo.name}`.replace(/[^\w.-]+/g, "-") : "repository";
  return `ARCHITECTURE-${slug}-${sha.slice(0, 7)}.md`;
}
