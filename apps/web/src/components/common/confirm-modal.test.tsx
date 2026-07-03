import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConfirmModal } from "@/components/common/confirm-modal";

afterEach(cleanup);

describe("ConfirmModal", () => {
  it("does not render when closed", () => {
    render(<ConfirmModal open={false} title="Take offline" onConfirm={() => {}} onClose={() => {}} />);
    expect(screen.queryByText("Take offline")).toBeNull();
  });

  it("renders the title and confirm label, and fires the right handlers", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmModal
        open
        title="Take app offline"
        description="Disables its capabilities."
        confirmLabel="Take offline"
        destructive
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    expect(screen.getByText("Take app offline")).toBeTruthy();
    fireEvent.click(screen.getByText("Take offline"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("surfaces an error message when provided", () => {
    render(
      <ConfirmModal open title="Archive" error="approval_required" onConfirm={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByText("approval_required")).toBeTruthy();
  });
});
