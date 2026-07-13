import { describe, expect, it } from "vitest";
import {
  applicationAttentionSummary,
  firstAttentionAutomationId,
  healthFor,
  matchesScheduleFilter,
  needsAttention,
  scheduleHealthLabel,
  scheduleHealthTone,
} from "@/features/automation/schedule-health-ui";
import { navigationFromSearch, searchFromNavigationState } from "@/store/ui-store";
import type { ApplicationScheduleHealth, ScheduleHealthRow } from "@/lib/console-state";

const row = (over: Partial<ScheduleHealthRow> = {}): ScheduleHealthRow => ({
  automationId: "atm_1",
  applicationId: "app_git",
  targetKind: "capability",
  capability: "app.app_git.wrapper.status",
  state: "healthy",
  reason: null,
  needsAttention: false,
  latestInvocationId: "inv_1",
  latestStatus: "succeeded",
  latestRunAt: null,
  ...over,
});

describe("the distinction that costs people days", () => {
  it("a PARKED schedule wants a human; a PAUSED one does not", () => {
    // They look identical to every surface that only shows failures: a parked
    // schedule produces no error, no failed run, and no red badge. If this ever
    // collapses "waiting for you" into "idle", the feature is gone.
    expect(scheduleHealthLabel("approval_pending")).toBe("Waiting for approval");
    expect(scheduleHealthLabel("paused")).toBe("Paused");
    expect(needsAttention("approval_pending")).toBe(true);
    expect(needsAttention("paused")).toBe(false);
    expect(scheduleHealthTone("approval_pending")).not.toBe(scheduleHealthTone("paused"));
  });

  it("failing is louder than parked, and healthy is neither", () => {
    expect(scheduleHealthTone("failing")).toBe("danger");
    expect(scheduleHealthTone("approval_pending")).toBe("warning");
    expect(scheduleHealthTone("healthy")).toBe("success");
    expect(needsAttention("healthy")).toBe(false);
    expect(needsAttention("unknown")).toBe(false);
  });
});

describe("filtering", () => {
  it("'Needs attention' means failing OR waiting — not just failing", () => {
    const failing = row({ state: "failing", needsAttention: true });
    const parked = row({ state: "approval_pending", needsAttention: true });
    const fine = row({ state: "healthy" });
    expect(matchesScheduleFilter(failing, "attention")).toBe(true);
    expect(matchesScheduleFilter(parked, "attention")).toBe(true);
    expect(matchesScheduleFilter(fine, "attention")).toBe(false);
  });

  it("a specific state filters to that state; 'all' keeps everything", () => {
    expect(matchesScheduleFilter(row({ state: "paused" }), "paused")).toBe(true);
    expect(matchesScheduleFilter(row({ state: "paused" }), "failing")).toBe(false);
    expect(matchesScheduleFilter(row({ state: "paused" }), "all")).toBe(true);
    expect(matchesScheduleFilter(undefined, "all")).toBe(true);
  });

  it("healthFor picks the row for that schedule and nobody else's", () => {
    const rows = [row({ automationId: "atm_1" }), row({ automationId: "atm_2", state: "failing" })];
    expect(healthFor("atm_2", rows)?.state).toBe("failing");
    expect(healthFor("atm_missing", rows)).toBeUndefined();
    expect(healthFor("atm_1", undefined)).toBeUndefined();
  });
});

describe("the application attention badge", () => {
  const rollup = (over: Partial<ApplicationScheduleHealth> = {}): ApplicationScheduleHealth => ({
    applicationId: "app_git",
    total: 3,
    failing: 0,
    approvalPending: 0,
    paused: 0,
    healthy: 3,
    unknown: 0,
    needsAttention: false,
    attentionAutomationIds: [],
    ...over,
  });

  it("names WHAT is wrong, rather than saying 'something is wrong here'", () => {
    expect(
      applicationAttentionSummary(rollup({ failing: 2, needsAttention: true, attentionAutomationIds: ["a", "b"] })),
    ).toBe("2 failing schedules");
    expect(
      applicationAttentionSummary(rollup({ approvalPending: 1, needsAttention: true, attentionAutomationIds: ["a"] })),
    ).toBe("1 waiting for approval schedule");
    expect(
      applicationAttentionSummary(
        rollup({ failing: 1, approvalPending: 1, needsAttention: true, attentionAutomationIds: ["a", "b"] }),
      ),
    ).toBe("1 failing, 1 waiting for approval schedules");
  });

  it("says nothing when nothing is wrong", () => {
    expect(applicationAttentionSummary(rollup())).toBeNull();
    expect(applicationAttentionSummary(null)).toBeNull();
    expect(applicationAttentionSummary(undefined)).toBeNull();
  });

  it("points AT a schedule, so the operator is not left to go find it", () => {
    expect(firstAttentionAutomationId(rollup({ attentionAutomationIds: ["atm_parked"] }))).toBe("atm_parked");
    expect(firstAttentionAutomationId(rollup())).toBeNull();
    expect(firstAttentionAutomationId(null)).toBeNull();
  });
});

describe("URL-backed focus", () => {
  it("a focused schedule survives a deep link and a refresh", () => {
    // An attention badge that cannot be linked to is a dead end: the operator
    // cannot share it, cannot refresh on it, and cannot come back to it.
    const navigation = navigationFromSearch("?section=automation&automation=atm_parked");
    expect(navigation.section).toBe("automation");
    expect(navigation.selectedAutomationId).toBe("atm_parked");

    const search = searchFromNavigationState("", {
      section: "automation",
      selectedInvocationId: null,
      selectedApplicationId: null,
      selectedApplicationRun: null,
      selectedEvidenceId: null,
      selectedAutomationId: "atm_parked",
    });
    expect(new URLSearchParams(search).get("automation")).toBe("atm_parked");
  });

  it("no focused schedule leaves no stale parameter behind", () => {
    const search = searchFromNavigationState("?automation=atm_old", {
      section: "automation",
      selectedInvocationId: null,
      selectedApplicationId: null,
      selectedApplicationRun: null,
      selectedEvidenceId: null,
      selectedAutomationId: null,
    });
    expect(new URLSearchParams(search).get("automation")).toBeNull();
  });
});
