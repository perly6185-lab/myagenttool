import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "@/components/common/error-boundary";

afterEach(cleanup);

function Boom({ label }: { label: string }): JSX.Element {
  throw new Error(label);
}

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <span>healthy view</span>
      </ErrorBoundary>,
    );
    expect(screen.getByText("healthy view")).toBeTruthy();
  });

  it("contains a render crash and shows the message instead of unmounting", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom label="bad payload" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("This view hit an error")).toBeTruthy();
    expect(screen.getByText("bad payload")).toBeTruthy();
    spy.mockRestore();
  });

  it("clears the caught error when resetKey changes (e.g. navigating sections)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <ErrorBoundary resetKey="dashboard">
        <Boom label="crash" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("This view hit an error")).toBeTruthy();

    // Navigating to a healthy section changes resetKey → boundary recovers.
    rerender(
      <ErrorBoundary resetKey="agents">
        <span>recovered view</span>
      </ErrorBoundary>,
    );
    expect(screen.getByText("recovered view")).toBeTruthy();
    expect(screen.queryByText("This view hit an error")).toBeNull();
    spy.mockRestore();
  });

  it("clears the error when the user clicks Try again", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Flaky({ crash }: { crash: boolean }): JSX.Element {
      if (crash) throw new Error("transient");
      return <span>content back</span>;
    }
    const { rerender } = render(
      <ErrorBoundary>
        <Flaky crash />
      </ErrorBoundary>,
    );
    expect(screen.getByText("This view hit an error")).toBeTruthy();

    // The underlying cause is gone; Try again re-renders the healthy child.
    rerender(
      <ErrorBoundary>
        <Flaky crash={false} />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("content back")).toBeTruthy();
    spy.mockRestore();
  });
});
