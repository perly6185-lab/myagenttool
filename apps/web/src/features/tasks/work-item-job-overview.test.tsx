import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkItemJobOverview } from "./work-item-job-overview";
import type { LocalWorkItem } from "./task-view-types";

describe("WorkItemJobOverview", () => {
  it("turns child tasks into an ordinary-language view of one piece of work", () => {
    const onOpen = vi.fn();
    const item = {
      id: "parent", subIssues: [
        { id: "one", localRef: "LOCAL-2", title: "核对客户资料", status: "done", state: "closed" },
        { id: "two", localRef: "LOCAL-3", title: "生成报价草稿", status: "in_progress", state: "open" },
      ],
    } as unknown as LocalWorkItem;
    render(<WorkItemJobOverview item={item} language="zh" onOpenWorkItem={onOpen} />);
    expect(screen.getByText("这件事怎么完成")).toBeTruthy();
    expect(screen.getByText("已完成")).toBeTruthy();
    expect(screen.getByText("正在处理")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "打开 生成报价草稿" }));
    expect(onOpen).toHaveBeenCalledWith("two");
  });

  it("shows same-intent work as independent tasks instead of a forced hierarchy", () => {
    const item = {
      id: "article",
      intentId: "intent_content_1",
      intentStatement: "写文章和漫画",
      intentPeers: [{
        id: "comic", localRef: "LOCAL-2", title: "制作漫画", taskKind: "content_comic",
        status: "in_progress", state: "open",
      }],
    } as LocalWorkItem;
    render(<WorkItemJobOverview item={item} language="zh" />);
    expect(screen.getByText("同一意图下的独立任务")).toBeTruthy();
    expect(screen.getByText("制作漫画")).toBeTruthy();
    expect(screen.getByText(/不会互相自动启动/)).toBeTruthy();
  });

  it("shows one multi-intent goal, progress, platform tasks and honest publication readiness", () => {
    const item = {
      id: "publish_wechat",
      taskKind: "content_publish",
      workGoal: {
        id: "goal_daily_coding", title: "把今天编码成果整理并发布", statement: "整理成文章和图片后发布",
        outcome: "形成可审核内容并发布", status: "active", planVersion: 1,
        platforms: [{ id: "wechat_official", label: "公众号" }], progress: { total: 5, completed: 2 },
        userSummary: {
          schemaVersion: 1, goalId: "goal_daily_coding", title: "把今天编码成果整理并发布", outcome: "形成可审核内容并发布", status: "active",
          progress: { total: 5, completed: 2, cancelled: 0, failed: 0, running: 1, waiting: 2, needsUser: 0, percent: 40 },
          quality: { passed: 1, failed: 0, unchecked: 1 }, nextStep: "正在处理公众号版本适配；完成后会通知你。",
          latestChange: { id: "change_1", status: "applied", summary: "已应用：修改 1 项", updatedAt: "2026-08-24T00:00:00.000Z" },
        },
      },
      goalTasks: [{
        id: "adapt_wechat", localRef: "LOCAL-4", title: "公众号版本适配", taskKind: "platform_adaptation",
        status: "ready", state: "open", dependencyIds: ["article", "image"], platformTarget: { id: "wechat_official", label: "公众号" },
      }],
      publicationReadiness: { state: "needs_setup", reason: "publication_connection_missing", platformId: "wechat_official", connection: null },
    } as LocalWorkItem;
    render(<WorkItemJobOverview item={item} language="zh" />);
    expect(screen.getByText("把今天编码成果整理并发布")).toBeTruthy();
    expect(screen.getByText("已完成 2/5 项专业任务")).toBeTruthy();
    expect(screen.getByTestId("work-goal-user-summary").textContent).toContain("正在处理公众号版本适配");
    expect(screen.getByTestId("work-goal-user-summary").textContent).toContain("最近调整：已应用：修改 1 项");
    expect(screen.getByText("公众号版本适配")).toBeTruthy();
    expect(screen.getByTestId("publication-readiness").textContent).toContain("发布连接尚未配置");
  });

  it("explains that draft sync is separate from public publishing", () => {
    const item = {
      id: "draft_wechat",
      taskKind: "wechat_draft_sync",
      draftSyncReadiness: { state: "ready", reason: "governed_draft_sync_capability_ready", platformId: "wechat_official", connection: { applicationId: "app_wechat", applicationName: "微信公众号", facadeId: "draft_sync", displayName: "保存公众号草稿", requiresApproval: true } },
    } as LocalWorkItem;
    render(<WorkItemJobOverview item={item} language="zh" />);
    expect(screen.getByTestId("draft-sync-readiness").textContent).toContain("不会公开发布");
  });

  it("turns the shared goal next step into one ordinary action", () => {
    const onOpen = vi.fn();
    const item = {
      id: "current",
      workGoal: {
        id: "goal_repair", title: "完成客户方案", statement: "准备并检查客户方案", outcome: "可交付客户方案",
        status: "active", planVersion: 1, platforms: [],
        userSummary: {
          schemaVersion: 1, goalId: "goal_repair", title: "完成客户方案", outcome: "可交付客户方案", status: "active",
          progress: { total: 2, completed: 1, cancelled: 0, failed: 0, running: 0, waiting: 0, needsUser: 1, percent: 50 },
          quality: { passed: 1, failed: 1, unchecked: 0 },
          nextStep: "请先处理“客户方案”的结果检查问题。",
          nextAction: { kind: "repair_result", workItemId: "failed_doc", label: "查看并返工" },
          latestChange: null,
        },
      },
    } as unknown as LocalWorkItem;
    render(<WorkItemJobOverview item={item} language="zh" onOpenWorkItem={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "查看并返工" }));
    expect(onOpen).toHaveBeenCalledWith("failed_doc");
  });
});
