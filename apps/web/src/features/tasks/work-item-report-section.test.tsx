import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { i18n } from "@/lib/i18n";
import { WorkItemReportSection } from "./work-item-report-section";
import type { LocalWorkItem } from "./task-view-types";
import type { WorkItemReportDraft } from "./work-item-report-types";

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  generate: vi.fn(),
  update: vi.fn(),
  confirm: vi.fn(),
  discard: vi.fn(),
}));

vi.mock("./work-item-report-api", () => ({ workItemReportApi: apiMocks }));

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

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  vi.clearAllMocks();
});
afterEach(cleanup);

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
});
