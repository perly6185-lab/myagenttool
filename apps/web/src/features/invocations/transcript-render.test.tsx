import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Transcript } from "@/features/invocations/transcript";
import { i18n } from "@/lib/i18n";

afterEach(cleanup);

function ev(id: string, type: string, message: string, level?: string) {
  return { id, type, message, createdAt: "2026-07-03T00:00:00Z", ...(level ? { level } : {}) };
}

describe("Transcript rendering (P3)", () => {
  it("renders command output as a <pre> preserving newlines, plus a summary block", () => {
    const { container } = render(
      <Transcript events={[ev("1", "command", "line1\nline2")]} summary={{ text: "Run finished.", status: "succeeded" }} />,
    );
    expect(container.querySelector("pre")?.textContent).toContain("line2");
    expect(screen.getByText("Run finished.")).toBeTruthy();
    expect(screen.getByText("Summary")).toBeTruthy();
  });

  it("offers a Review jump on diff blocks and fires onOpenReview", () => {
    const onOpenReview = vi.fn();
    render(<Transcript events={[ev("1", "codex_review_findings_recorded", "3 findings")]} onOpenReview={onOpenReview} />);
    fireEvent.click(screen.getByText("View in Review →"));
    expect(onOpenReview).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state only when there are no events and no summary", () => {
    const { rerender } = render(<Transcript events={[]} />);
    expect(screen.getByText("No runs yet")).toBeTruthy();
    rerender(<Transcript events={[]} summary={{ text: "Cancelled.", status: "cancelled" }} />);
    expect(screen.queryByText("No runs yet")).toBeNull();
    expect(screen.getByText("Cancelled.")).toBeTruthy();
  });

  it("localizes operational summary status without changing result content", async () => {
    await i18n.changeLanguage("zh-CN");
    render(<Transcript events={[]} summary={{ text: "Provider result", status: "succeeded" }} />);
    expect(screen.getByText("结果摘要")).toBeTruthy();
    expect(screen.getByText("已完成")).toBeTruthy();
    expect(screen.getByText("Provider result")).toBeTruthy();
    expect(screen.queryByText("Done")).toBeNull();
    await i18n.changeLanguage("en-US");
  });
});
