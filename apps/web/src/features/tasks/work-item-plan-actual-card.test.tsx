import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkItemPlanActual } from "./task-view-types";
import { WorkItemPlanActualCard } from "./work-item-plan-actual-card";

afterEach(() => cleanup());

function plan(overrides: Partial<WorkItemPlanActual> = {}): WorkItemPlanActual {
  return {
    schemaVersion: 1,
    runId: "aur_1",
    status: "matched",
    summaryCode: "plan_actual_matched",
    planned: {
      goal: "更新客户台账",
      expectedOutput: "客户台账.xlsx",
      method: { kind: "template", name: "客户更新", definitionId: "rtd_1", familyId: "family_1", version: 2 },
      materialCount: 1,
      materialNames: ["客户台账"],
      deliveryDestination: "task",
      actionAccessMode: "write",
      verificationStepCount: 1,
    },
    actual: {
      resultStatus: "available",
      resultFiles: ["客户台账.xlsx"],
      materializedCount: 1,
      skippedMaterialCount: 0,
      deliveryStatus: null,
      verificationStatus: "passed",
      impactStatus: "prepared",
    },
    checks: [
      { key: "method", status: "matched", reasonCode: "execution_method_frozen", expected: {}, actual: {} },
      { key: "materials", status: "matched", reasonCode: "planned_materials_materialized", expected: {}, actual: {} },
      { key: "output", status: "matched", reasonCode: "reviewable_result_available", expected: {}, actual: {} },
      { key: "action", status: "matched", reasonCode: "planned_write_has_receipt", expected: {}, actual: {} },
      { key: "delivery", status: "matched", reasonCode: "result_available_in_task", expected: {}, actual: {} },
      { key: "verification", status: "matched", reasonCode: "verification_passed", expected: {}, actual: {} },
    ],
    deviations: [],
    digest: "digest",
    ...overrides,
  };
}

describe("plan and actual card", () => {
  it("summarizes a fully evidenced match in ordinary language", () => {
    render(<WorkItemPlanActualCard plan={plan()} language="zh" />);

    expect(screen.getByText("执行与计划一致")).toBeTruthy();
    expect(screen.getByText("1/1 项已加载 · 客户台账")).toBeTruthy();
    expect(screen.getByText("客户更新 · v2")).toBeTruthy();
    expect(screen.getByText("客户台账.xlsx")).toBeTruthy();
  });

  it("separates confirmed deviations from missing evidence", () => {
    const attention = plan({
      status: "attention",
      checks: plan().checks.map((check) => check.key === "output"
        ? { ...check, status: "mismatch" as const, reasonCode: "output_format_mismatch" }
        : check.key === "verification"
          ? { ...check, status: "unknown" as const, reasonCode: "verification_not_proven" }
          : check),
      deviations: [{ code: "output_format_mismatch", severity: "high", scope: "output", correctionTarget: "template" }],
    });
    render(<WorkItemPlanActualCard plan={attention} language="en" />);

    expect(screen.getByText("Confirmed deviations found")).toBeTruthy();
    expect(screen.getByText(/1 actual item/)).toBeTruthy();
    expect(within(screen.getByTestId("plan-actual-output")).getByText("The result format differs from the confirmed format")).toBeTruthy();
    expect(within(screen.getByTestId("plan-actual-verification")).getByText("The run ended without sufficient verification evidence")).toBeTruthy();
  });

  it("opens full evidence without introducing another primary action", () => {
    const open = vi.fn();
    render(<WorkItemPlanActualCard plan={plan({ status: "unverified" })} language="en" onOpenDetails={open} />);

    fireEvent.click(screen.getByRole("button", { name: "View full evidence" }));
    expect(open).toHaveBeenCalledTimes(1);
  });
});
