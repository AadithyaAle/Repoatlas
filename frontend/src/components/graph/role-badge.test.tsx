import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { FileRole } from "@/lib/api/types";

import { ROLE_META, ROLE_ORDER, RoleBadge } from "./role-badge";

const ALL_ROLES: FileRole[] = ["ENTRY_POINT", "CORE_UTILITY", "GOD_MODULE", "LEAF", "ISOLATED", "STANDARD"];

describe("<RoleBadge/>", () => {
  it("renders the human label (colour is never the only signal)", () => {
    render(<RoleBadge role="GOD_MODULE" />);
    const badge = screen.getByText("God module");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("data-role", "GOD_MODULE");
  });

  it("exposes the classification rule as a title", () => {
    render(<RoleBadge role="CORE_UTILITY" />);
    expect(screen.getByText("Core utility")).toHaveAttribute(
      "title",
      "Core utility: in-degree ≥ 5 and out-degree ≤ 2",
    );
  });

  it("can omit the title and merge class names", () => {
    render(<RoleBadge role="LEAF" withTitle={false} className="custom-class" />);
    const badge = screen.getByText("Leaf");
    expect(badge).not.toHaveAttribute("title");
    expect(badge).toHaveClass("custom-class");
  });

  it("has metadata for every role", () => {
    expect([...ROLE_ORDER].sort()).toEqual([...ALL_ROLES].sort());
    for (const role of ALL_ROLES) {
      const meta = ROLE_META[role];
      expect(meta.label).toBeTruthy();
      expect(meta.description.length).toBeGreaterThan(10);
      expect(meta.rule).toBeTruthy();
      expect(meta.color).toMatch(/^oklch\(/);
    }
  });

  it("documents the analyzer thresholds", () => {
    expect(ROLE_META.ENTRY_POINT.rule).toBe("in-degree = 0 and out-degree > 0");
    expect(ROLE_META.GOD_MODULE.rule).toBe("in-degree ≥ 5 and out-degree ≥ 5");
    expect(ROLE_META.LEAF.rule).toBe("in-degree > 0 and out-degree = 0");
    expect(ROLE_META.ISOLATED.rule).toBe("in-degree = 0 and out-degree = 0");
  });
});
