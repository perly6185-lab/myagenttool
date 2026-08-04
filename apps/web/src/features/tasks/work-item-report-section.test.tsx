import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "@/lib/api-client";
import { i18n } from "@/lib/i18n";
import { WorkItemReportSection } from "./work-item-report-section";
import type { LocalWorkItem } from "./task-view-types";
import type { WorkItemReportDelivery, WorkItemReportDraft } from "./work-item-report-types";

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  generate: vi.fn(),
  update: vi.fn(),
  confirm: vi.fn(),
  discard: vi.fn(),
  listDeliveries: vi.fn(),
  previewDelivery: vi.fn(),
  getDelivery: vi.fn(),
  sendDelivery: vi.fn(),
}));

vi.mock("./work-item-report-api", () => ({
  WORK_ITEM_REPORT_DELIVERY_ACTION: "work_item.report.deliver",
  workItemReportApi: apiMocks,
}));

const item: LocalWorkItem = {
  id: "lwi_report",
  localRef: "LOCAL-77",
  projectId: "prj_1",
  title: "Confirm launch plan",
  body: "",
  type: "task",
  status: "review",
  priority: "p1",
  state: "open",
  labels: [],
  assigneeIds: ["usr_1"],
  followUpSchemaVersion: 1,
  requesterRelation: "customer",
  requesterName: "Alex",
  requesterOrganization: "Acme",
  requesterUserId: null,
  intakeChannel: "meeting",
  externalReference: null,
  waitingOn: "me",
  commitmentDate: null,
  nextFollowUpAt: null,
  lastProgressAt: null,
  lastProgressSummary: null,
  acceptanceCriteria: [],
  dueDate: null,
  milestone: "",
  estimatePoints: 0,
  revision: 4,
  archivedAt: null,
  updatedAt: "2026-08-03T12:00:00.000Z",
};

function draft(overrides: Partial<WorkItemReportDraft> = {}): WorkItemReportDraft {
  return {
    id: "wrd_1",
    schemaVersion: 1,
    workItemId: item.id,
    status: "draft",
    revision: 1,
    audience: { relation: "customer", name: "Alex", organization: "Acme", userId: null },
    tone: "concise",
    content: "Launch plan is ready for review.",
    stale: false,
    canEdit: true,
    canConfirm: true,
    source: {
      workItemRevision: 4,
      capturedAt: "2026-08-03T12:00:00.000Z",
      contextDigest: "digest",
      progressActivities: [{ activityId: "wia_1", summary: "QA passed", createdAt: "2026-08-03T11:00:00.000Z" }],
      executionResults: [{ kind: "auto_run", id: "aur_1", status: "completed", summary: "Release checks passed", updatedAt: "2026-08-03T11:30:00.000Z" }],
    },
    generation: { generator: "structured", policyVersion: "work-item-report-v1", modelVersion: null, inputDigest: "input" },
    createdBy: "usr_1",
    updatedBy: "usr_1",
    createdAt: "2026-08-03T12:00:00.000Z",
    updatedAt: "2026-08-03T12:00:00.000Z",
    confirmedAt: null,
    confirmedBy: null,
    confirmedSnapshot: null,
    ...overrides,
  };
}

function delivery(overrides: Partial<WorkItemReportDelivery> = {}): WorkItemReportDelivery {
  return {
    id: "wrdl_1",
    schemaVersion: 1,
    workItemId: item.id,
    reportDraftId: "wrd_1",
    status: "preview",
    revision: 1,
    confirmedReportRevision: 3,
    content: "Launch plan is ready for review.",
    contentDigest: "content-digest",
    chunkCount: 1,
    target: {
      channelId: "chn_1",
      channelName: "Customer updates",
      provider: "wecom",
      conversationId: "cnv_1",
      recipientId: "alex.external",
    },
    canSend: true,
    channelDeliveryIds: [],
    createdBy: "usr_1",
    createdAt: "2026-08-03T12:07:00.000Z",
    sentBy: null,
    sentAt: null,
    receipt: null,
    ...overrides,
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  vi.clearAllMocks();
  apiMocks.listDeliveries.mockResolvedValue({ reportDeliveries: [], count: 0 });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorkItemReportSection", () => {
  it("generates the first audience-aware draft without sending or closing work", async () => {
    const generated = draft();
    apiMocks.list.mockResolvedValueOnce({ reportDrafts: [], count: 0 })
      .mockResolvedValue({ reportDrafts: [generated], count: 1 });
    apiMocks.generate.mockResolvedValue({ reportDraft: generated, replayed: false });

    render(<WorkItemReportSection item={item} />);

    expect(await screen.findByText("No report draft yet")).toBeTruthy();
    expect(screen.getByDisplayValue("Alex")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Tone"), { target: { value: "formal" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate report" }));

    await waitFor(() => expect(apiMocks.generate).toHaveBeenCalledWith(item.id, expect.objectContaining({
      expectedWorkItemRevision: 4,
      audience: expect.objectContaining({ relation: "customer", name: "Alex" }),
      tone: "formal",
      idempotencyKey: expect.any(String),
    })));
    expect(await screen.findByDisplayValue("Launch plan is ready for review.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm report" })).toBeTruthy();
    expect(screen.queryByText(/send control/i)).toBeNull();
  });

  it("makes stale sources read-only and offers regeneration from current progress", async () => {
    const stale = draft({ stale: true, canEdit: false, canConfirm: false });
    apiMocks.list.mockResolvedValue({ reportDrafts: [stale], count: 1 });

    render(<WorkItemReportSection item={{ ...item, revision: 5 }} />);

    expect(await screen.findByText("Source progress changed")).toBeTruthy();
    expect((await screen.findByDisplayValue(stale.content)).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Confirm report" })).toBeNull();
    expect(screen.getByRole("button", { name: "Regenerate from current progress" })).toBeTruthy();
    fireEvent.click(screen.getByText("Source summary"));
    expect(screen.getByText("QA passed")).toBeTruthy();
    expect(screen.getByText("Release checks passed")).toBeTruthy();
  });

  it("saves and explicitly confirms the current revision while keeping confirmation review-only", async () => {
    let current = draft();
    apiMocks.list.mockImplementation(async () => ({ reportDrafts: [current], count: 1 }));
    apiMocks.update.mockImplementation(async (_workItemId, _draftId, payload) => {
      current = draft({ ...current, revision: 2, content: payload.content, updatedAt: "2026-08-03T12:05:00.000Z" });
      return { reportDraft: current };
    });
    apiMocks.confirm.mockImplementation(async () => {
      current = draft({ ...current, status: "confirmed", revision: 3, canEdit: false, canConfirm: false, confirmedAt: "2026-08-03T12:06:00.000Z" });
      return { reportDraft: current, replayed: false };
    });

    render(<WorkItemReportSection item={item} />);
    const editor = await screen.findByDisplayValue(current.content);
    fireEvent.change(editor, { target: { value: "Updated launch report" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(apiMocks.update).toHaveBeenCalledWith(item.id, current.id, expect.objectContaining({
      expectedRevision: 1,
      content: "Updated launch report",
    })));

    fireEvent.click(screen.getByRole("button", { name: "Confirm report" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm this report?" });
    expect(dialog.textContent).toContain("will not send a message or close the task");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm report" }));

    await waitFor(() => expect(apiMocks.confirm).toHaveBeenCalledWith(item.id, current.id, expect.objectContaining({
      expectedRevision: 2,
      idempotencyKey: expect.any(String),
    })));
    expect(await screen.findByText("Confirmed means reviewed. It has not been sent and the task has not been closed.")).toBeTruthy();
  });

  it("reloads the latest draft and gives actionable feedback after a revision conflict", async () => {
    const original = draft();
    const latest = draft({ revision: 2, content: "Updated elsewhere" });
    apiMocks.list.mockResolvedValueOnce({ reportDrafts: [original], count: 1 })
      .mockResolvedValue({ reportDrafts: [latest], count: 1 });
    apiMocks.update.mockRejectedValue(new ApiError("work_item_report_draft_revision_conflict", "conflict", 409));

    render(<WorkItemReportSection item={item} />);
    fireEvent.change(await screen.findByDisplayValue(original.content), { target: { value: "My local edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByText(/changed elsewhere/)).toBeTruthy();
    expect(await screen.findByDisplayValue("Updated elsewhere")).toBeTruthy();
    expect(apiMocks.list).toHaveBeenCalledTimes(2);
  });

  it("previews the exact target and content, requires approval, and renders the provider receipt without closing work", async () => {
    const confirmed = draft({
      status: "confirmed",
      revision: 3,
      canEdit: false,
      canConfirm: false,
      confirmedAt: "2026-08-03T12:06:00.000Z",
      confirmedBy: "usr_1",
      confirmedSnapshot: {
        revision: 3,
        audience: { relation: "customer", name: "Alex", organization: "Acme", userId: null },
        tone: "concise",
        content: "Launch plan is ready for review.",
        source: draft().source,
        contentDigest: "content-digest",
        confirmedAt: "2026-08-03T12:06:00.000Z",
        confirmedBy: "usr_1",
      },
    });
    const previewed = delivery();
    const sent = delivery({
      status: "delivered",
      revision: 2,
      canSend: false,
      channelDeliveryIds: ["cdl_1"],
      sentBy: "usr_1",
      sentAt: "2026-08-03T12:08:00.000Z",
      receipt: {
        status: "delivered",
        channelDeliveryIds: ["cdl_1"],
        deliveredChunks: 1,
        failedChunks: 0,
        attempts: 1,
        providerReceiptIds: ["wecom-receipt-77"],
        lastErrorCodes: [],
        updatedAt: "2026-08-03T12:08:01.000Z",
      },
    });
    let deliveryRows: WorkItemReportDelivery[] = [];
    apiMocks.list.mockResolvedValue({ reportDrafts: [confirmed], count: 1 });
    apiMocks.listDeliveries.mockImplementation(async () => ({ reportDeliveries: deliveryRows, count: deliveryRows.length }));
    apiMocks.previewDelivery.mockImplementation(async () => {
      deliveryRows = [previewed];
      return { reportDelivery: previewed, replayed: false };
    });
    apiMocks.sendDelivery.mockImplementation(async () => {
      deliveryRows = [sent];
      return { reportDelivery: sent, replayed: false };
    });
    const approval = vi.spyOn(api, "issueApprovalGrant").mockResolvedValue({
      grantId: "apg_1",
      token: "approval-token",
      expiresAt: "2026-08-03T12:13:00.000Z",
    });

    render(<WorkItemReportSection
      item={item}
      channels={[{
        id: "chn_1",
        name: "Customer updates",
        provider: "wecom",
        status: "enabled",
        readiness: {},
        ready: true,
        health: "ok",
        capabilityAllowlist: [],
        counts: { identities: 1, conversations: 1, events: 0, deliveries: 0, failedDeliveries: 0, injectionFlagged: 0 },
      }]}
      conversations={[{ id: "cnv_1", channelId: "chn_1", externalUserId: "alex.external" }]}
    />);

    expect(await screen.findByText("External delivery")).toBeTruthy();
    const previewButton = screen.getByRole("button", { name: "Preview recipient and message" });
    await waitFor(() => expect((previewButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(previewButton);
    await waitFor(() => expect(apiMocks.previewDelivery).toHaveBeenCalledWith(item.id, confirmed.id, expect.objectContaining({
      channelId: "chn_1",
      conversationId: "cnv_1",
      idempotencyKey: expect.any(String),
    })));

    const targetPreview = await screen.findByTestId("report-delivery-preview");
    expect(targetPreview.textContent).toContain("Customer updates · wecom");
    expect(targetPreview.textContent).toContain("alex.external");
    expect(targetPreview.textContent).toContain("Launch plan is ready for review.");
    fireEvent.click(within(targetPreview).getByRole("button", { name: "Send confirmed report" }));
    const dialog = screen.getByRole("dialog", { name: "Send this report externally?" });
    expect(dialog.textContent).toContain("Customer updates");
    expect(dialog.textContent).toContain("alex.external");
    expect(dialog.textContent).toContain("task will remain open");
    fireEvent.click(within(dialog).getByRole("button", { name: "Send confirmed report" }));

    await waitFor(() => expect(approval).toHaveBeenCalledWith("work_item.report.deliver", previewed.id));
    expect(apiMocks.sendDelivery).toHaveBeenCalledWith(item.id, confirmed.id, previewed.id, expect.objectContaining({
      expectedRevision: 1,
      approvalToken: "approval-token",
      idempotencyKey: expect.any(String),
    }));
    const receipt = await screen.findByTestId("report-delivery-receipt");
    expect(receipt.textContent).toContain("1 of 1 message parts delivered");
    expect(receipt.textContent).toContain("wecom-receipt-77");
    expect(screen.queryByRole("button", { name: /close task/i })).toBeNull();
    expect(item.state).toBe("open");
    expect(item.revision).toBe(4);
  });
});
