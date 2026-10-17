import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RiskMeter, riskGaugePosition } from "./risk-meter";

describe("riskGaugePosition", () => {
  it("maps each risk band onto an equal quarter of the gauge", () => {
    expect(riskGaugePosition(0)).toBe(0);
    expect(riskGaugePosition(5)).toBeCloseTo(0.25);
    expect(riskGaugePosition(15)).toBeCloseTo(0.5);
    expect(riskGaugePosition(35)).toBeCloseTo(0.75);
    expect(riskGaugePosition(100)).toBe(1);
    expect(riskGaugePosition(250)).toBe(1);
    expect(riskGaugePosition(-3)).toBe(0);
  });
});

describe("<RiskMeter/>", () => {
  it("renders an accessible meter with the level in text", () => {
    render(<RiskMeter score={12.4} level="MEDIUM" />);
    const meter = screen.getByRole("meter", { name: /blast radius risk score/i });
    expect(meter).toHaveAttribute("aria-valuenow", "12.4");
    expect(meter).toHaveAttribute("aria-valuetext", "12.4 out of 100, Medium risk");
    expect(screen.getByText("Medium risk")).toBeInTheDocument();
    expect(screen.getByText("12.4")).toBeInTheDocument();
  });
});
