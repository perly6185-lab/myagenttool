import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkItemCompletionQualityMetrics } from "./task-view-types";
import { WorkItemCompletionMetricsCard } from "./work-item-completion-metrics-card";

afterEach(() => cleanup());

function report(): WorkItemCompletionQualityMetrics {
  const passed = { status: "passed" as const, target: 0.95 };
  return {
    generatedAt: "2026-08-28T00:00:00.000Z",
    scope: { projectId: null, origin: "all", trackedWorkItems: 10, trackedAutoRuns: 8, workItemIds: Array.from({ length: 10 }, (_, index) => `work_${index + 1}`) },
    metrics: {
      schemaVersion: 2,
      completion: {
        tracked: 10, settled: 8, completed: 7, falseCompletions: 1, requiringUserAction: 2,
        completionRate: 0.875, falseCompletionRate: 0.1,
        firstAttempt: { settled: 8, completed: 6, rate: 0.75, check: { status: "attention", target: 0.8 } },
        final: { settled: 8, completed: 7, rate: 0.875, check: { status: "attention", target: 0.9 } },
        check: { status: "attention", target: 0.95 },
      },
      recovery: { required: 2, succeeded: 2, pending: 0, successRate: 1, durationMs: { samples: 2, average: 1_000, maximum: 1_500 }, check: passed },
      humanIntervention: { count: 1, rate: 0.1, exceptionHandlingCount: 3, userInitiatedRecovery: { actions: 2, tasks: 2, rate: 0.2 }, check: { status: "passed", target: 0.15 } },
      automaticRecovery: { actions: 1, tasks: 1, succeeded: 1, successRate: 1 },
      externalActions: { attempts: 4, duplicateCount: 0, unresolvedCount: 0, check: { status: "passed", target: 0 } },
      acceptance: { status: "attention", checks: {} },
      byCategory: { development: { tracked: 4, settled: 4, completed: 4, finalCompletionRate: 1, forcedHumanInterventions: 0, recoveryRequired: 1, recoverySucceeded: 1 } },
      definitions: {},
    },
  };
}

describe("work item completion metrics card", () => {
  it("shows the four acceptance measures in ordinary-user language", () => {
    render(<WorkItemCompletionMetricsCard report={report()} language="zh-CN" />);
    expect(screen.getByRole("region", { name: "任务完成质量" })).toBeTruthy();
    expect(screen.getByText("首次完成率")).toBeTruthy();
    expect(screen.getByText("最终完成率")).toBeTruthy();
    expect(screen.getByText("恢复成功率")).toBeTruthy();
    expect(screen.getByText("被迫人工介入率")).toBeTruthy();
    expect(screen.getByText("重复外部动作")).toBeTruthy();
    expect(screen.getByText("88%")).toBeTruthy();
    expect(screen.getByText("仍需改进")).toBeTruthy();
    expect(screen.getByText(/由用户主动恢复/)).toBeTruthy();
    expect(screen.getByText("开发")).toBeTruthy();
  });

  it("does not turn missing recovery evidence into a zero percent failure", () => {
    const value = report();
    value.metrics.recovery = {
      required: 0, succeeded: 0, pending: 0, successRate: null,
      durationMs: { samples: 0, average: null, maximum: null },
      check: { status: "insufficient_data", target: 0.95 },
    };
    render(<WorkItemCompletionMetricsCard report={value} language="zh" />);
    expect(screen.getByText("暂无样本")).toBeTruthy();
    expect(screen.getByText("样本不足")).toBeTruthy();
  });
});
