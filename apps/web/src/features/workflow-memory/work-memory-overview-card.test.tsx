import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkMemoryOverviewCard,
  type WorkMemoryOverview,
} from "@/features/workflow-memory/work-memory-overview-card";
import { i18n } from "@/lib/i18n";

const overview: WorkMemoryOverview = {
  name: "处理客户询价",
  path: {
    incoming: { title: "新询价进入待处理目录", detail: "识别询价编号和客户" },
    references: { title: "读取客户资料和价格表", examples: ["客户资料", "标准价格表"] },
    process: { title: "核对数量、价格和交期" },
    result: { title: "生成客户报价单", detail: "保存到已报价目录" },
    ledger: { title: "登记询价台账", detail: "正式写入前请你确认" },
  },
  health: {
    state: "needs_attention",
    score: 82.4,
    summary: "大部分历史任务做法一致，但交期写法需要确认。",
    issues: [{
      id: "delivery-term",
      message: "历史结果中出现了两种交期写法。",
      action: "确认以后统一使用“收到订单后 15 天”。",
    }],
  },
  versions: {
    current: { name: "询价报价做法", versionLabel: "第 3 版" },
    previous: { name: "询价报价做法", versionLabel: "第 2 版" },
    changes: [{
      id: "output-folder",
      label: "报价单保存位置",
      previous: "报价草稿",
      current: "已报价",
    }],
  },
  resultSuggestions: [{
    id: "suggestion-1",
    title: "统一报价单里的交期表达",
    observedDifference: "你把 AI 草稿中的“约两周”改成了“收到订单后 15 天”。",
    suggestedChange: "以后优先使用“收到订单后 15 天”。",
    reason: "最近三份人工完成的报价单使用了相同表达。",
  }],
};

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => cleanup());

describe("WorkMemoryOverviewCard", () => {
  it("explains the work path, health, version differences and result suggestions in user language", () => {
    const onReviewSuggestion = vi.fn();
    render(
      <WorkMemoryOverviewCard
        overview={overview}
        onReviewSuggestion={onReviewSuggestion}
        onRestorePrevious={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "这项工作会怎样处理" })).toBeTruthy();
    const path = screen.getByRole("list", { name: "工作路径" });
    const stages = within(path).getAllByRole("listitem").filter((item) =>
      ["新工作", "查找参考", "按规矩处理", "生成结果", "更新台账"]
        .some((label) => item.textContent?.includes(label)));
    expect(stages).toHaveLength(5);
    expect(stages.map((stage) => stage.textContent)).toEqual([
      expect.stringContaining("新询价进入待处理目录"),
      expect.stringContaining("读取客户资料和价格表"),
      expect.stringContaining("核对数量、价格和交期"),
      expect.stringContaining("生成客户报价单"),
      expect.stringContaining("登记询价台账"),
    ]);

    expect(screen.getByText("需要检查")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    fireEvent.click(screen.getByText("查看判断依据"));
    expect(screen.getByText("内部参考分数：82/100")).toBeTruthy();
    expect(screen.getByText("历史结果中出现了两种交期写法。")).toBeTruthy();
    expect(screen.getByText("报价单保存位置")).toBeTruthy();
    expect(screen.getByText("第 3 版")).toBeTruthy();
    expect(screen.getByText("第 2 版")).toBeTruthy();
    expect(screen.getByText("统一报价单里的交期表达")).toBeTruthy();
    expect(screen.getByText(/不会自行改变以后任务的处理方式/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "检查这条建议" }));
    expect(onReviewSuggestion).toHaveBeenCalledWith("suggestion-1");
  });

  it("requires a second confirmation before restoring the previous rules", () => {
    const onRestorePrevious = vi.fn();
    render(
      <WorkMemoryOverviewCard
        overview={overview}
        onRestorePrevious={onRestorePrevious}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "恢复上一次的规矩" }));
    expect(onRestorePrevious).not.toHaveBeenCalled();
    expect(screen.getByText("确定恢复上一次的工作做法吗？")).toBeTruthy();
    expect(screen.getByText(/已经开始的任务仍按当前规矩完成/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "继续使用当前规矩" }));
    expect(screen.queryByText("确定恢复上一次的工作做法吗？")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "恢复上一次的规矩" }));
    fireEvent.click(screen.getByRole("button", { name: "确认恢复上一次" }));
    expect(onRestorePrevious).toHaveBeenCalledTimes(1);
  });

  it("does not offer rollback when there is no previous set of rules", () => {
    render(
      <WorkMemoryOverviewCard
        overview={{
          ...overview,
          versions: { current: overview.versions.current, previous: null, changes: [] },
          resultSuggestions: [],
        }}
        onRestorePrevious={vi.fn()}
      />,
    );

    expect(screen.getByText("目前还没有可以比较的上一版。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "恢复上一次的规矩" })).toBeNull();
    expect(screen.queryByText("从你的人工结果中发现的改进")).toBeNull();
  });
});
