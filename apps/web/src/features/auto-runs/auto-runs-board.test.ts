import { describe, expect, it } from "vitest";
import { eventsForRun, failoverSummary, localQueueSnapshot, runLane } from "./auto-runs-view";
import type { AutoRunRecord } from "./auto-runs-view";

const run = (over: Partial<AutoRunRecord>): AutoRunRecord => ({ id: "ar", status: "running", ...over });

describe("runLane — stage board grouping", () => {
  it("routes failed/blocked and failed/rolled-back deploys to Attention (even when merged)", () => {
    expect(runLane(run({ status: "failed" }))).toBe("attention");
    expect(runLane(run({ status: "blocked" }))).toBe("attention");
    // a rolled-back deploy is on a MERGED PR — Attention must win over Done.
    expect(runLane(run({ status: "pr_open", prState: "MERGED", deployment: { status: "rolled_back" } }))).toBe("attention");
    expect(runLane(run({ status: "pr_open", prState: "MERGED", deployment: { status: "failed" } }))).toBe("attention");
  });

  it("routes human-gated states to Needs you", () => {
    for (const status of ["awaiting_approval", "needs_input", "report_posted", "plan_proposed"]) {
      expect(runLane(run({ status }))).toBe("needs_you");
    }
  });

  it("routes terminal-success states to Done", () => {
    expect(runLane(run({ status: "pr_open", prState: "MERGED", deployment: { status: "deployed" } }))).toBe("done");
    expect(runLane(run({ status: "pr_open", prState: "MERGED" }))).toBe("done");
    expect(runLane(run({ status: "pr_open", prState: "CLOSED" }))).toBe("done");
    expect(runLane(run({ status: "decomposed" }))).toBe("done");
  });

  it("routes an open PR (not merged) to PR open, and in-flight work to Running", () => {
    expect(runLane(run({ status: "pr_open", prState: "OPEN" }))).toBe("pr_open");
    for (const status of ["materializing", "running", "verifying", "publishing"]) {
      expect(runLane(run({ status }))).toBe("running");
    }
  });
});

describe("localQueueSnapshot (#1499)", () => {
  it("separates running, next, and human-actionable work", () => {
    const snapshot = localQueueSnapshot([
      run({ id: "running", status: "running" }),
      run({ id: "next", status: "materializing" }),
      run({ id: "approval", status: "awaiting_approval" }),
      run({ id: "failed", status: "failed" }),
      run({ id: "done", status: "pr_open" }),
    ]);
    expect(snapshot.running.map((item) => item.id)).toEqual(["running"]);
    expect(snapshot.next?.id).toBe("next");
    expect(snapshot.waiting.map((item) => item.id)).toEqual(["approval", "failed"]);
    expect(snapshot.attentionCount).toBe(2);
  });
});

describe("eventsForRun", () => {
  it("combines Auto-run lifecycle events with live events from its current invocation", () => {
    const events = [
      { id: "lifecycle", type: "auto_run_started", createdAt: "2026-07-29T00:00:00.000Z", data: { autoRunId: "aur_1" } },
      { id: "live", invocationId: "inv_1", type: "command_execution", createdAt: "2026-07-29T00:00:02.000Z", data: {} },
      { id: "other", invocationId: "inv_2", type: "command_execution", createdAt: "2026-07-29T00:00:01.000Z", data: {} },
    ];
    expect(eventsForRun(events, "aur_1", "inv_1").map((event) => event.id)).toEqual(["lifecycle", "live"]);
  });
});

describe("failoverSummary", () => {
  it("explains successful infrastructure recovery in plain language", () => {
    expect(failoverSummary({ status: "recovered", reason: "dispatch_timeout" })).toBe(
      "Recovered on another agent after dispatch timed out",
    );
  });

  it("explains why a failed run needs human attention", () => {
    expect(failoverSummary({ status: "alternate_unavailable", reason: "stuck" })).toBe(
      "No healthy alternate agent after run stopped responding",
    );
    expect(failoverSummary(null)).toBeNull();
  });
});
