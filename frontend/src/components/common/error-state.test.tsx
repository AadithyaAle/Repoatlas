import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";

import { ErrorState } from "./error-state";

describe("<ErrorState/>", () => {
  it("renders the ApiError message, code and status", () => {
    render(
      <ErrorState
        error={new ApiError({ code: "GITHUB_RATE_LIMITED", message: "Slow down", status: 429 })}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("GitHub rate limit reached")).toBeInTheDocument();
    expect(screen.getByText("Slow down")).toBeInTheDocument();
    expect(screen.getByText(/GITHUB_RATE_LIMITED · 429/)).toBeInTheDocument();
  });

  it("calls onRetry", () => {
    const onRetry = vi.fn();
    render(<ErrorState error={new Error("boom")} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
