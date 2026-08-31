import assert from "node:assert/strict";
import { test } from "node:test";

import { projectWorkItemJourney } from "../src/services/work-item-journey.mjs";

test("projects the same approval wait from Channel and execution facts", () => {
  const journey = projectWorkItemJourney({
    item: { id: "wi_1", channelOrigin: { channelId: "chn_1", threadId: "cth_1" } },
    thread: { id: "cth_1", channelId: "chn_1", status: "waiting_approval" },
    latestRun: { id: "aur_1", status: "awaiting_approval" },
    invocation: { id: "inv_1", status: "waiting_for_local_approval" },
  });

  assert.equal(journey.origin, "channel");
  assert.equal(journey.stage, "waiting_approval");
  assert.equal(journey.waitingFor, "approval");
  assert.deepEqual(journey.nextAction, { kind: "open_approval", target: "approval", required: true });
});

test("never promotes a declared completion when evidence is missing", () => {
  const journey = projectWorkItemJourney({
    item: { id: "wi_2", status: "done", state: "closed" },
    latestRun: { id: "aur_2", status: "done" },
    completionAssessment: {
      status: "unverified", evidenceComplete: false, reasonCodes: ["material_use_not_proven"],
    },
  });

  assert.equal(journey.status, "attention");
  assert.equal(journey.stage, "needs_attention");
  assert.equal(journey.requiresUserAction, true);
  assert.deepEqual(journey.reasonCodes, ["material_use_not_proven"]);
});

test("delivery failure outranks a successful Channel execution", () => {
  const journey = projectWorkItemJourney({
    item: { id: "wi_3", channelOrigin: { channelId: "chn_1" } },
    thread: { id: "cth_3", channelId: "chn_1", status: "succeeded" },
    outcome: { status: "available" },
    resultVerification: { status: "passed" },
    delivery: { status: "failed_terminal" },
  });

  assert.equal(journey.stage, "delivery_failed");
  assert.deepEqual(journey.nextAction, { kind: "retry_delivery", target: "channel", required: true });
  assert.equal(journey.result.verified, true);
  assert.equal(journey.result.delivered, false);
});

test("a newer delivery failure outranks a stale completed assessment", () => {
  const journey = projectWorkItemJourney({
    item: { id: "wi_delivery", status: "done", state: "closed", channelOrigin: { channelId: "chn_1" } },
    thread: { id: "cth_delivery", channelId: "chn_1", status: "succeeded" },
    completionAssessment: { status: "completed", evidenceComplete: true, reasonCodes: [] },
    delivery: { status: "failed_terminal", updatedAt: "2026-08-31T00:01:00.000Z" },
  });

  assert.equal(journey.stage, "delivery_failed");
  assert.equal(journey.status, "attention");
  assert.equal(journey.updatedAt, "2026-08-31T00:01:00.000Z");
});

test("a Channel task is complete only when closed, verified, and delivered", () => {
  const journey = projectWorkItemJourney({
    item: { id: "wi_4", status: "done", state: "closed", channelOrigin: { channelId: "chn_1" } },
    thread: { id: "cth_4", channelId: "chn_1", status: "succeeded" },
    outcome: { status: "available" },
    resultVerification: { status: "passed" },
    delivery: { status: "delivered" },
  });

  assert.equal(journey.stage, "completed");
  assert.equal(journey.status, "completed");
  assert.deepEqual(journey.nextAction, { kind: "none", target: "task", required: false });
});

test("active and paused work expose exactly one next action", () => {
  const active = projectWorkItemJourney({ item: { id: "wi_5" }, latestRun: { id: "aur_5", status: "running" } });
  const paused = projectWorkItemJourney({
    item: { id: "wi_6", channelOrigin: { channelId: "chn_1" } },
    thread: { id: "cth_6", channelId: "chn_1", status: "paused" },
  });

  assert.deepEqual(active.nextAction, { kind: "wait", target: "task", required: false });
  assert.deepEqual(paused.nextAction, { kind: "reply_in_channel", target: "channel", required: true });
});
