import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const deleteObservabilityData = vi.fn();
vi.mock("@/lib/api-client", () => ({
  api: { deleteObservabilityData: (...args: unknown[]) => deleteObservabilityData(...args) },
}));

import { ObservabilityDeletionCard } from "@/features/audit/observability-deletion-card";

afterEach(() => {
  cleanup();
  deleteObservabilityData.mockReset();
});

describe("ObservabilityDeletionCard", () => {
  it("renders and keeps Delete disabled until a subject id is entered", () => {
    render(<ObservabilityDeletionCard />);
    expect(screen.getByText("Delete observability data")).toBeTruthy();
    const trigger = screen.getByRole("button", { name: "Delete…" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("usr_… / team_… / dev_…"), { target: { value: "usr_1" } });
    expect(trigger.disabled).toBe(false);
  });

  it("confirms, calls the API with the chosen scope/subject/tier, and shows the counts", async () => {
    deleteObservabilityData.mockResolvedValue({
      deleted: true, scope: "user", subjectId: "usr_1", tier: "operational", invocationCount: 2, counts: { digests: 4, transcripts: 1 },
    });
    render(<ObservabilityDeletionCard />);
    fireEvent.change(screen.getByPlaceholderText("usr_… / team_… / dev_…"), { target: { value: "usr_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    // Confirm modal → the permanent-delete button.
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => expect(deleteObservabilityData).toHaveBeenCalledWith({ scope: "user", subjectId: "usr_1", tier: "operational" }));
    await waitFor(() => expect(screen.getByText(/digests: 4/)).toBeTruthy());
    expect(screen.getByText("Deleted")).toBeTruthy();
  });

  it("surfaces the server's error (e.g. a 403 for a non-owner)", async () => {
    deleteObservabilityData.mockRejectedValue(new Error("Only an owner or admin can delete observability data."));
    render(<ObservabilityDeletionCard />);
    fireEvent.change(screen.getByPlaceholderText("usr_… / team_… / dev_…"), { target: { value: "usr_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/owner or admin/));
  });
});
