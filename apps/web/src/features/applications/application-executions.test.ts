import { describe, expect, it } from "vitest";
import {
  applicationExecutionDigest,
  applicationInvocations,
  digestTone,
  durableStatsWindow,
  executionKind,
  formatResultOutput,
} from "@/features/applications/application-executions";
import type { InvocationSnapshot } from "@/lib/console-state";

const inv = (id: string, over: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}): InvocationSnapshot => ({
  id,
  status: "succeeded",
  createdAt: "2026-07-11T01:00:00Z",
  options: { metadata: { applicationId: "app_1", ...metadata } },
  ...over,
});

describe("applicationInvocations", () => {
  it("filters to the application and sorts newest first", () => {
    const rows = applicationInvocations(
      [
        inv("old", { createdAt: "2026-07-11T01:00:00Z" }),
        inv("foreign", {}, { applicationId: "app_other" }),
        inv("new", { createdAt: "2026-07-11T03:00:00Z" }),
        { id: "no_meta", status: "succeeded", options: { metadata: {} } } as InvocationSnapshot,
      ],
      "app_1",
    );
    expect(rows.map((r) => r.id)).toEqual(["new", "old"]);
  });
});

describe("executionKind", () => {
  it("classifies every execution shape the server stamps", () => {
    expect(executionKind(inv("a", {}, { source: "application_orchestration", routineName: "Nightly" }))).toBe("orchestration · Nightly");
    expect(executionKind(inv("b", {}, { source: "application_orchestration" }))).toBe("orchestration run");
    expect(executionKind(inv("c", {}, { capability: "app.app_1.wrapper.daily", applicationWrapper: {} }))).toBe("wrapper · daily");
    expect(executionKind(inv("d", {}, { applicationAction: "generate_orchestration" }))).toBe("generate orchestration");
    expect(executionKind(inv("e", {}, { source: "application_orchestration", recoveryActionType: "rerun" }))).toBe("recovery rerun");
    expect(executionKind(inv("f"))).toBe("capability call");
  });
});

describe("applicationExecutionDigest", () => {
  it("rolls up totals, active runs, and terminal-only success rate", () => {
    const digest = applicationExecutionDigest([
      inv("s1", { createdAt: "2026-07-11T05:00:00Z" }),
      inv("s2"),
      inv("f1", { status: "failed" }),
      inv("t1", { status: "timed_out" }),
      inv("q1", { status: "queued" }),
      inv("r1", { status: "running" }, { recoveryActionType: "rerun" }),
    ]);
    expect(digest.total).toBe(6);
    expect(digest.succeeded).toBe(2);
    expect(digest.failed).toBe(2);
    expect(digest.active).toBe(2);
    expect(digest.successRate).toBe(0.5);
    expect(digest.lastAt).toBe("2026-07-11T05:00:00Z");
    expect(digest.recoveryRuns).toBe(1);
  });

  it("success rate is honestly null with nothing terminal", () => {
    const digest = applicationExecutionDigest([inv("q", { status: "queued" })]);
    expect(digest.successRate).toBeNull();
    expect(digestTone(digest)).toBe("neutral");
  });

  it("digest tone maps rate bands", () => {
    expect(digestTone(applicationExecutionDigest([inv("a"), inv("b")]))).toBe("success");
    expect(digestTone(applicationExecutionDigest([inv("a"), inv("b", { status: "failed" })]))).toBe("warning");
    expect(digestTone(applicationExecutionDigest([inv("a", { status: "failed" })]))).toBe("danger");
  });
});

describe("durableStatsWindow", () => {
  const stat = (date: string, over: Record<string, number> = {}, applicationId = "app_1") => ({
    applicationId,
    date,
    succeeded: 0,
    failed: 0,
    timedOut: 0,
    recovered: 0,
    ...over,
  });

  it("sums the window for one app, counting timeouts as failures", () => {
    const summary = durableStatsWindow(
      [
        stat("2026-07-11", { succeeded: 3, failed: 1 }),
        stat("2026-07-05", { succeeded: 2, timedOut: 1, recovered: 1 }),
        stat("2026-07-04", { succeeded: 9 }), // outside the 7d window
        stat("2026-07-11", { succeeded: 100 }, "app_other"), // other app
      ],
      "app_1",
      7,
      "2026-07-11",
    );
    expect(summary).toEqual({ days: 7, succeeded: 5, failed: 2, recovered: 1 });
  });

  it("empty stats → zeros", () => {
    expect(durableStatsWindow([], "app_1", 30, "2026-07-11")).toEqual({ days: 30, succeeded: 0, failed: 0, recovered: 0 });
  });
});

describe("formatResultOutput", () => {
  it("pretty-prints objects, passes strings, hides empties", () => {
    expect(formatResultOutput({ reportId: "daily", rows: 3 })!.text).toContain('"reportId": "daily"');
    expect(formatResultOutput("plain text")).toEqual({ text: "plain text", truncated: false });
    expect(formatResultOutput(null)).toBeNull();
    expect(formatResultOutput("   ")).toBeNull();
  });

  it("bounds huge payloads and says so", () => {
    const big = formatResultOutput({ blob: "x".repeat(10_000) }, 500)!;
    expect(big.truncated).toBe(true);
    expect(big.text.length).toBeLessThan(700);
    expect(big.text).toContain("more characters");
  });
});
