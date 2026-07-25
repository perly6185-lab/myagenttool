import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfirmModal } from "@/components/common/confirm-modal";
import { i18n } from "@/lib/i18n";

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
});

afterEach(cleanup);

describe("ConfirmModal", () => {
  function FocusHarness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
        <ConfirmModal open={open} title="Focused dialog" onConfirm={() => {}} onClose={() => setOpen(false)} />
      </>
    );
  }

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

  it("keeps the dialog locked while the action is pending", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmModal
        open
        title="Generate orchestration"
        confirmLabel="Generate"
        pending
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    const confirmButton = screen.getByText("Working…") as HTMLButtonElement;
    const cancelButton = screen.getByText("Cancel") as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    expect(cancelButton.disabled).toBe(true);

    fireEvent.click(cancelButton);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves focus into the dialog, traps tab, and restores the trigger on close", async () => {
    render(<FocusHarness />);
    const trigger = screen.getByText("Open dialog");
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByLabelText("Close")).toBe(document.activeElement));
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(screen.getByText("Confirm")).toBe(document.activeElement);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(trigger).toBe(document.activeElement));
  });
});
