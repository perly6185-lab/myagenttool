import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalWorkItem } from "./task-view-types";
import { WorkItemLedgerPostingPlan } from "./work-item-ledger-posting-plan";
import { WorkItemRecordBindings } from "./work-item-record-bindings";

const mocks = vi.hoisted(() => ({
  getWorkItemLedgerPostingPlan: vi.fn(),
  prepareWorkItemLedgerPostingPlan: vi.fn(),
  issueApprovalGrant: vi.fn(),
  commitWorkItemLedgerPostingPlan: vi.fn(),
}));

vi.mock("@/data/use-console-actions", () => ({
  api: mocks,
}));

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("work item business record boundaries", () => {
  it("keeps a stale record snapshot read-only after execution starts", () => {
    const onRefresh = vi.fn();
    const item = {
      id: "lwi_1",
      recordBindings: [{
        id: "binding_customer",
        direction: "input",
        role: "required",
        record: { title: "Acme Corporation", businessKey: "CUS-001" },
        selection: { fieldKeys: ["customer"] },
        resolution: { state: "stale" },
      }],
    } as LocalWorkItem;

    render(
      <WorkItemRecordBindings
        item={item}
        language="en"
        locked
        pendingId={null}
        onRefresh={onRefresh}
        error={null}
      />,
    );

    expect(screen.getByRole("heading", { name: "Business materials" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refresh and confirm" })).toBeNull();
    expect(screen.getByText(/Execution has started/)).toBeTruthy();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("shows a ledger diff without exposing a write action to a viewer", async () => {
    mocks.getWorkItemLedgerPostingPlan.mockResolvedValue({
      plan: { id: "tpp_1", status: "proposed", state: "proposed", revision: 1 },
      preview: { changedCells: [{ field: "status", before: "draft", after: "ready" }] },
      batchPreview: null,
    });
    const item = {
      id: "lwi_1",
      revision: 2,
      ledgerPostingPlanId: "tpp_1",
    } as LocalWorkItem;

    render(<WorkItemLedgerPostingPlan item={item} language="en" canOperate={false} />);

    expect(await screen.findByRole("heading", { name: "Ledger change approval" })).toBeTruthy();
    expect(await screen.findByText("status")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve and write ledger" })).toBeNull();
    expect(mocks.issueApprovalGrant).not.toHaveBeenCalled();
    expect(mocks.commitWorkItemLedgerPostingPlan).not.toHaveBeenCalled();
  });
});
