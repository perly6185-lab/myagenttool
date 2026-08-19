import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import type { LocalWorkItem, LocalWorkItemObservability } from "./task-view-types";

const mocks = vi.hoisted(() => ({
  getWorkItem: vi.fn(),
  listWorkItemComments: vi.fn(),
  listWorkItemActivity: vi.fn(),
  listWorkItems: vi.fn(),
  autoRunReadiness: vi.fn(),
}));

vi.mock("@/data/use-console-actions", () => ({
  api: mocks,
  useAsyncAction: () => ({ execute: (operation: () => unknown) => operation(), pending: false, error: null }),
}));

vi.mock("@/data/use-console-state", () => ({
  useConsoleState: () => ({ data: { projects: [], users: [], agents: [] } }),
}));

vi.mock("@/hooks/use-safe-navigation", () => ({
  useSafeNavigation: () => ({ requestNavigation: (operation: () => void) => operation() }),
}));

vi.mock("@/hooks/use-visible-interval", () => ({
  useVisibleInterval: () => {},
}));

import { useUiStore } from "@/store/ui-store";
import { LocalWorkItemDetail } from "./local-work-item-detail";

const workItem = {
  id: "lwi_integration",
  localRef: "LOCAL-42",
  projectId: "prj_1",
  title: "核对客户报价",
  body: "按最新报价文件核对客户记录",
  type: "task",
  status: "in_progress",
  priority: "p1",
  state: "open",
  labels: [],
  assigneeIds: [],
  revision: 6,
  acceptanceCriteria: [],
  verificationSop: [],
  executionBindings: [],
  channelTaskContract: {
    schemaVersion: 1,
    source: "channel",
    domain: "commercial",
    riskLevel: "medium",
    goal: "核对客户报价",
    workMode: {
      schemaVersion: 1,
      state: "matched",
      source: "my_template",
      name: "报价核对",
      version: 2,
      confidence: "high",
      goal: "核对客户报价",
      expectedOutput: "差异清单",
      inputs: null,
      data: { status: "ready", requirements: [], sources: [], relations: [], relationStatus: "ready" },
      mutation: { required: false, status: "not_required", targetCount: null, digest: null },
      confirmationRequired: false,
      candidates: [],
      trace: { templateDefinitionId: "tpl_1", templateFamilyId: "family_1", templateVersion: 2, templateMatchReason: "结果匹配", dataPlanDigest: null, relationDigest: null, executionDigest: null },
      digest: "mode_digest",
      generatedAt: "2026-08-18T00:00:00.000Z",
    },
  },
} as unknown as LocalWorkItem;

const observability = {
  nextAction: "none",
  attention: [],
  latestRun: null,
  timeline: [],
  cost: { knownUsd: 0, unknownEntries: 0, entryCount: 0 },
  alerts: { queued: 0, failed: 0, sent: 0, skipped: 0 },
} as unknown as LocalWorkItemObservability;

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
  useUiStore.setState({ selectedWorkItemSection: "overview" });
  mocks.getWorkItem.mockResolvedValue({ workItem, observability });
  mocks.listWorkItemComments.mockResolvedValue({ comments: [] });
  mocks.listWorkItemActivity.mockResolvedValue({ activities: [] });
  mocks.listWorkItems.mockResolvedValue({ workItems: [workItem] });
  mocks.autoRunReadiness.mockResolvedValue({ readiness: { ready: true, checks: [] } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LocalWorkItemDetail professional overview", () => {
  it("renders the professional fact summary after the real detail load", async () => {
    render(<LocalWorkItemDetail workItemId={workItem.id} projects={[]} onChanged={() => {}} onDirtyChange={() => {}} />);
    const summary = await screen.findByTestId("professional-work-summary");
    expect(summary.textContent).toContain("专业处理摘要");
    expect(summary.textContent).toContain("报价核对");
    await waitFor(() => expect(mocks.getWorkItem).toHaveBeenCalledWith(workItem.id));
  });
});
