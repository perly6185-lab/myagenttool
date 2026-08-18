import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import type { LocalWorkItem } from "./task-view-types";
import { TaskContentReferences } from "./task-content-references";

const mocks = vi.hoisted(() => ({ removeFromWorkItem: vi.fn(), health: vi.fn(), refresh: vi.fn(), revealContainer: vi.fn() }));
vi.mock("@/features/local-content/local-content-api", () => ({ localContentApi: mocks }));

const task = {
  id: "work-1",
  revision: 7,
  localContentRefs: [{
    id: "ref-1",
    contentId: "lc_11111111111111111111111111111111",
    purpose: "required_input",
    title: "Customer brief.eml",
    kind: "mail",
    addedBy: "user-1",
    createdAt: "2026-08-14T00:00:00.000Z",
    fingerprintPinned: false,
  }],
} as LocalWorkItem;

function renderReferences(props: { readOnly?: boolean; onUpdated: ReturnType<typeof vi.fn> }) {
  return render(createElement(TaskContentReferences, { item: task, ...props }));
}

describe("TaskContentReferences", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage("en-US");
    mocks.removeFromWorkItem.mockResolvedValue({
      workItem: { ...task, revision: 8, localContentRefs: [] },
      appliesTo: "next_execution",
    });
    mocks.health.mockResolvedValue({ health: [{ contentId: task.localContentRefs![0].contentId, state: "ready", available: true, reason: null, canRefresh: true, canReveal: true }] });
    mocks.refresh.mockResolvedValue({ content: {}, refresh: {} });
    mocks.revealContainer.mockResolvedValue({ revealed: true, name: "Customer brief.eml" });
  });

  afterEach(cleanup);

  it("removes only the task reference with revision protection", async () => {
    const onUpdated = vi.fn();
    renderReferences({ onUpdated });

    fireEvent.click(screen.getByRole("button", { name: "Remove reference: Customer brief.eml" }));

    await waitFor(() => expect(mocks.removeFromWorkItem).toHaveBeenCalledWith("work-1", "ref-1", 7));
    expect(onUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 8, localContentRefs: [] }),
      expect.stringMatching(/original remains/),
    );
  });

  it("keeps completed-task references visible and read-only", () => {
    renderReferences({ readOnly: true, onUpdated: vi.fn() });
    expect(screen.getByText("Customer brief.eml")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Remove reference/ })).toBeNull();
  });

  it("warns about a changed original and refreshes the scoped library record", async () => {
    mocks.health.mockResolvedValueOnce({ health: [{ contentId: task.localContentRefs![0].contentId, state: "changed", available: true, reason: "local_content_original_changed", canRefresh: true, canReveal: true }] });
    const onUpdated = vi.fn();
    renderReferences({ onUpdated });

    expect(await screen.findByText(/Original changed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh library record: Customer brief.eml" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith(task.localContentRefs![0].contentId));
    expect(onUpdated).toHaveBeenCalledWith(task, expect.stringMatching(/refreshed/));
  });

  it("can locate the containing folder when an original is missing", async () => {
    mocks.health.mockResolvedValueOnce({ health: [{ contentId: task.localContentRefs![0].contentId, state: "missing", available: false, reason: "original_missing", canRefresh: true, canReveal: true }] });
    renderReferences({ onUpdated: vi.fn() });

    expect(await screen.findByText(/moved or is missing/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Locate original or containing folder: Customer brief.eml" }));
    await waitFor(() => expect(mocks.revealContainer).toHaveBeenCalledWith(task.localContentRefs![0].contentId));
  });

  it("makes a failed health check visible and lets the user retry it", async () => {
    mocks.health.mockRejectedValueOnce(new Error("offline"));
    renderReferences({ onUpdated: vi.fn() });

    expect(await screen.findByText("Status unknown")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check reference status again" }));

    await waitFor(() => expect(mocks.health).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Original available")).toBeTruthy();
    expect(screen.queryByText("Status unknown")).toBeNull();
  });
});
