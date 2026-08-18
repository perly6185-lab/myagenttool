import assert from "node:assert/strict";
import test from "node:test";

import { buildMailClassificationQuality } from "../src/services/mail-classification-quality.mjs";
import { MAIL_CLASSIFIER_VERSION, mailMessageKey } from "../src/services/mail-header-classifier.mjs";

const actor = { teamId: "team_a", userId: "user_a" };

function message(index) {
  return { applicationId: "app_mail", folderId: "inbox", messageId: `message-${index}`, from: `secret-${index}@example.test`, subject: `Private ${index}` };
}

function record(value, index, extra = {}) {
  return {
    id: `classification-${index}`, ownerTeamId: "team_a", messageKey: mailMessageKey(value),
    attention: "routine", classifierVersion: MAIL_CLASSIFIER_VERSION, stage: "header",
    confirmationState: "proposed", ...extra,
  };
}

test("quality summary is tenant scoped, content free, and healthy after enough stable samples", () => {
  const messages = Array.from({ length: 60 }, (_, index) => message(index));
  const state = {
    mailClassifications: [
      ...messages.slice(0, 55).map((value, index) => record(value, index, {
        attention: index < 10 ? "unknown" : "routine",
        ...(index < 2 ? { manualOverride: { attention: "routine" }, confirmationState: "corrected" } : {}),
      })),
      { ...record(messages[55], 999, { attention: "unknown" }), ownerTeamId: "team_other" },
    ],
    mailClassificationJobs: [{ ownerTeamId: "team_a", status: "succeeded", processed: 55, failed: 0, completedAt: "2026-08-17T10:00:00.000Z" }],
    mailFolderMoveJobs: Array.from({ length: 10 }, (_, index) => ({ id: `move-${index}`, ownerTeamId: "team_a", status: "succeeded" })),
  };
  const quality = buildMailClassificationQuality({ state, messages, actor, now: () => "2026-08-17T11:00:00.000Z" });
  assert.equal(quality.status, "healthy");
  assert.equal(quality.sampleSize, 55);
  assert.equal(quality.metrics.coverage.value, 0.9167);
  assert.equal(quality.metrics.unknown.numerator, 8, "manual corrections are evaluated using their current result");
  assert.equal(quality.organization.status, "healthy");
  assert.deepEqual(quality.privacy, { localOnly: true, includesMessageContent: false, includesSenderIdentity: false });
  assert(!JSON.stringify(quality).includes("secret-"));
  assert(!JSON.stringify(quality).includes("Private"));
});

test("quality summary reports closed warning signals without claiming accuracy", () => {
  const messages = Array.from({ length: 50 }, (_, index) => message(index));
  const state = {
    mailClassifications: messages.map((value, index) => record(value, index, {
      attention: index < 30 ? "unknown" : "routine",
      ...(index < 10 ? { manualOverride: { attention: "other" }, confirmationState: "corrected" } : {}),
    })),
    mailClassificationJobs: [{ ownerTeamId: "team_a", status: "degraded", processed: 100, failed: 10 }],
    mailFolderMoveJobs: Array.from({ length: 10 }, (_, index) => ({ ownerTeamId: "team_a", status: index === 0 ? "unconfirmed" : "succeeded" })),
  };
  const quality = buildMailClassificationQuality({ state, messages, actor });
  assert.equal(quality.status, "needs_attention");
  assert(quality.signals.includes("high_unknown_rate"));
  assert(quality.signals.includes("high_correction_rate"));
  assert(quality.signals.includes("high_job_failure_rate"));
  assert.equal(quality.organization.status, "needs_attention");
  assert.equal("accuracy" in quality.metrics, false);
});

test("quality summary stays collecting before the minimum local sample", () => {
  const messages = [message(1)];
  const quality = buildMailClassificationQuality({ state: { mailClassifications: [record(messages[0], 1)] }, messages, actor });
  assert.equal(quality.status, "collecting");
  assert.deepEqual(quality.signals, ["insufficient_sample"]);
});
