import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RoutineSetupGuide } from "@/features/workflow-memory/routine-setup-guide";
import type { BusinessRoutineDefinition, WorkflowSource } from "@/lib/api-client";
import { i18n } from "@/lib/i18n";

const source: WorkflowSource = {
  id: "source-1",
  projectId: "project-1",
  name: "日常询价目录",
  relativePath: "业务/询价",
  readMode: "supported_text",
  state: "active",
  scanState: "ready",
  scanRevision: 2,
  revision: 2,
  fileCount: 12,
  skippedCount: 0,
  truncated: false,
  lastScanAt: "2026-08-11T00:00:00.000Z",
  lastError: null,
};

const publishedDefinition: BusinessRoutineDefinition = {
  id: "routine-1",
  familyId: "routine-family-1",
  projectId: "project-1",
  sourceId: "source-1",
  name: "处理客户询价",
  description: "按历史做法准备报价并登记台账",
  version: 1,
  state: "published",
  discoveryCandidateId: "candidate-1",
  historicalCaseIds: ["case-1", "case-2", "case-3"],
  triggerDocumentTypes: ["inquiry"],
  steps: [
    {
      key: "reference",
      kind: "retrieve",
      label: "查找客户价格资料",
      required: true,
      dependsOn: [],
      evidenceRefs: [],
      configuration: { source: "客户价格表" },
    },
    {
      key: "output",
      kind: "generate",
      label: "生成报价单",
      required: true,
      dependsOn: ["reference"],
      evidenceRefs: [],
      configuration: { output: "已报价/客户报价单" },
    },
    {
      key: "approval",
      kind: "human_approval",
      label: "正式写入前请你确认金额",
      required: true,
      dependsOn: ["output"],
      evidenceRefs: [],
      configuration: {},
    },
    {
      key: "ledger",
      kind: "ledger_upsert",
      label: "登记询价台账",
      required: true,
      dependsOn: ["approval"],
      evidenceRefs: [],
      configuration: { ledger: "询价台账.xlsx" },
    },
  ],
  confidence: 0.94,
  supersedesId: null,
  supersededById: null,
  evidenceHealth: { state: "valid", issues: [], recovery: null },
  revision: 3,
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
};

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => cleanup());

describe("RoutineSetupGuide", () => {
  it("keeps the three-step first-time setup before a routine is enabled", () => {
    render(
      <RoutineSetupGuide
        source={source}
        candidate={null}
        definition={null}
        artifacts={[]}
        pending={false}
        onScan={vi.fn()}
        onCreateDraft={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "让 AI 学会你平时怎么做" })).toBeTruthy();
    expect(screen.getByText("选历史工作文件夹")).toBeTruthy();
    expect(screen.getAllByText("配对几组历史工作").length).toBeGreaterThan(0);
    expect(screen.getByText("确认 AI 的做法")).toBeTruthy();
    expect(screen.getByRole("button", { name: "开始整理历史案例" })).toBeTruthy();
  });

  it("shows the learned work memory instead of per-task setup after enabling", () => {
    render(
      <RoutineSetupGuide
        source={source}
        candidate={null}
        definition={publishedDefinition}
        artifacts={[]}
        pending={false}
        onScan={vi.fn()}
        onCreateDraft={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "这台电脑已经学会这项工作" })).toBeTruthy();
    expect(screen.getByText(/不需要你在每个任务里重新设置/)).toBeTruthy();
    expect(screen.getByText("收到询价时")).toBeTruthy();
    expect(screen.getByText("客户价格表")).toBeTruthy();
    expect(screen.getByText("已报价/客户报价单")).toBeTruthy();
    expect(screen.getByText("询价台账.xlsx")).toBeTruthy();
    expect(screen.getByText(/查找客户价格资料 → 生成报价单/)).toBeTruthy();
    expect(screen.getByText("正式写入前请你确认金额")).toBeTruthy();
    expect(screen.queryByText("选历史工作文件夹")).toBeNull();
    expect(screen.getByRole("button", { name: "查看或调整已学规矩" })).toBeTruthy();
  });

  it("lets a user confirm and enable a reviewed work type in the main setup flow", () => {
    const onPublishConfirmed = vi.fn();
    const onPublish = vi.fn();
    render(
      <RoutineSetupGuide
        source={source}
        candidate={null}
        definition={{ ...publishedDefinition, state: "draft" }}
        artifacts={[]}
        pending={false}
        publishConfirmed={false}
        onScan={vi.fn()}
        onCreateDraft={vi.fn()}
        onPublishConfirmed={onPublishConfirmed}
        onPublish={onPublish}
      />,
    );

    expect(screen.getByText("可以启用这项工作了")).toBeTruthy();
    expect(screen.getByText(/不需要在每个任务里重新设置/)).toBeTruthy();
    const enable = screen.getByRole("button", { name: "启用这个工作类型" }) as HTMLButtonElement;
    expect(enable.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("我已检查触发条件、步骤、输出、台账和人工确认点。"));
    expect(onPublishConfirmed).toHaveBeenCalledWith(true);

    cleanup();
    render(
      <RoutineSetupGuide
        source={source}
        candidate={null}
        definition={{ ...publishedDefinition, state: "draft" }}
        artifacts={[]}
        pending={false}
        publishConfirmed
        onScan={vi.fn()}
        onCreateDraft={vi.fn()}
        onPublishConfirmed={onPublishConfirmed}
        onPublish={onPublish}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "启用这个工作类型" }));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });
});
