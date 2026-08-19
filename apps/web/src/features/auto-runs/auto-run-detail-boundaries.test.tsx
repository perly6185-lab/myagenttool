import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AutoRunDiffLines } from "./auto-run-artifacts";
import { canCancelAutoRun, canReverifyAutoRun } from "./auto-run-actions";
import { selectAutoRunCenterRows } from "./auto-run-dashboard";
import { isAutoRunTimelineTerminal } from "./auto-run-detail-card";
import { formatAutoRunDuration, formatAutoRunSloValue } from "./auto-run-format";
import type { AutoRunRecord } from "./auto-run-model";
import { formatAutoRunRoutingSignal } from "./auto-run-routing-health-panel";
import { hasDevelopStepper } from "./auto-run-runtime";
import { buildAutoRunAttemptMap, filterAutoRuns } from "./use-auto-runs-controller";

describe("auto-run detail boundaries", () => {
  it("formats duration and SLO values without page state", () => {
    expect(formatAutoRunDuration(null)).toBe("—");
    expect(formatAutoRunDuration(45)).toBe("45s");
    expect(formatAutoRunDuration(120)).toBe("2m");
    expect(formatAutoRunDuration(5400)).toBe("1.5h");
    expect(formatAutoRunSloValue(0.875, "ratio")).toBe("88%");
    expect(formatAutoRunSloValue(90, "seconds")).toBe("2m");
  });

  it("only shows the linear stepper for develop-pipeline states", () => {
    expect(hasDevelopStepper("materializing")).toBe(true);
    expect(hasDevelopStepper("verifying")).toBe(true);
    expect(hasDevelopStepper("pr_open")).toBe(true);
    expect(hasDevelopStepper("needs_input")).toBe(false);
    expect(hasDevelopStepper("decomposed")).toBe(false);
  });

  it("caps large diff rendering while preserving the truncation explanation", () => {
    const diff = Array.from({ length: 805 }, (_, index) => `+line ${index + 1}`).join("\n");
    render(<AutoRunDiffLines diff={diff} />);

    expect(screen.getByText("+line 1")).toBeTruthy();
    expect(screen.queryByText("+line 805")).toBeNull();
    expect(screen.getByText(/5 more lines not shown/)).toBeTruthy();
  });

  it("orders run-center rows by urgency and caps the dashboard preview", () => {
    const runs = [
      { id: "waiting", status: "blocked" },
      { id: "queued", status: "materializing" },
      { id: "running", status: "running" },
      { id: "done", status: "done" },
    ] as AutoRunRecord[];

    expect(selectAutoRunCenterRows(runs, 2).map((run) => run.id)).toEqual(["running", "queued"]);
  });

  it("treats evicted invocations as terminal and keeps active invocations live", () => {
    const run = { id: "run-1", status: "running", invocationId: "inv-1" } as AutoRunRecord;

    expect(isAutoRunTimelineTerminal(run, [])).toBe(true);
    expect(isAutoRunTimelineTerminal(run, [{ id: "inv-1", status: "running" }] as never)).toBe(false);
    expect(isAutoRunTimelineTerminal(run, [{ id: "inv-1", status: "succeeded" }] as never)).toBe(true);
  });

  it("filters runs across status and searchable operator fields", () => {
    const runs = [
      { id: "run-1", status: "running", agentId: "Agent-Blue", branchName: "feature/search" },
      { id: "run-2", status: "blocked", link: { type: "issue", number: 42, title: "Fix routing", url: null } },
    ] as AutoRunRecord[];

    expect(filterAutoRuns(runs, "agent-blue", "all").map((run) => run.id)).toEqual(["run-1"]);
    expect(filterAutoRuns(runs, "42", "blocked").map((run) => run.id)).toEqual(["run-2"]);
    expect(filterAutoRuns(runs, "routing", "running")).toEqual([]);
  });

  it("numbers retries chronologically within the same work item", () => {
    const sharedLink = { type: "issue" as const, number: 7, title: "Retry task", url: null };
    const attempts = buildAutoRunAttemptMap([
      { id: "newer", status: "failed", projectId: "p1", link: sharedLink, createdAt: "2026-01-02T00:00:00Z" },
      { id: "older", status: "failed", projectId: "p1", link: sharedLink, createdAt: "2026-01-01T00:00:00Z" },
      { id: "other-project", status: "failed", projectId: "p2", link: sharedLink, createdAt: "2026-01-03T00:00:00Z" },
    ]);

    expect(attempts.get("older")).toEqual({ attempt: 1, total: 2 });
    expect(attempts.get("newer")).toEqual({ attempt: 2, total: 2 });
    expect(attempts.get("other-project")).toEqual({ attempt: 1, total: 1 });
  });

  it("keeps destructive and verification actions constrained to eligible states", () => {
    expect(canCancelAutoRun("running")).toBe(true);
    expect(canCancelAutoRun("done")).toBe(false);
    expect(canReverifyAutoRun({ id: "done", status: "done" } as AutoRunRecord)).toBe(true);
    expect(canReverifyAutoRun({ id: "verified", status: "done", verification: { verified: true, passed: true } } as AutoRunRecord)).toBe(false);
  });

  it("formats routing health signals according to their metric unit", () => {
    expect(formatAutoRunRoutingSignal({ key: "latency", severity: "danger", value: 1250.4, threshold: 1000 })).toBe("1250 ms > 1000 ms");
    expect(formatAutoRunRoutingSignal({ key: "fallback", severity: "warning", value: 0.26, threshold: 0.2 })).toBe("26% ≥ 20%");
  });
});
