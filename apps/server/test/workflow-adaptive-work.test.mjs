import assert from "node:assert/strict";
import test from "node:test";

import { createWorkflowAdaptiveWorkService } from "../src/services/workflow-adaptive-work.mjs";

const ACTOR = { userId: "usr_a", teamId: "team_a", role: "owner" };
const OPERATOR = { userId: "usr_op", teamId: "team_a", role: "operator" };
const FOREIGN = { userId: "usr_b", teamId: "team_b", role: "owner" };

function harness(options = {}) {
  const state = {
    projects: [
      { id: "prj_a", ownerTeamId: "team_a" },
      { id: "prj_b", ownerTeamId: "team_b" },
    ],
    workflowSources: [{
      id: "wfs_a",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      state: "active",
    }],
    workflowAdaptivePolicies: [],
    workflowAdaptiveFeedback: [],
    workflowIntakeObservations: [{
      id: "wio_new",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      artifactId: "wfa_new",
      state: "ready",
    }],
    workflowArtifacts: [{
      id: "wfa_new",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      name: "RFQ-2026-101.xlsx",
      family: "spreadsheet",
      extension: "xlsx",
    }, {
      id: "wfa_history",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      name: "RFQ-2026-100.xlsx",
      family: "spreadsheet",
      extension: "xlsx",
    }],
    businessDocumentClassifications: [{
      id: "bdc_new",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      artifactId: "wfa_new",
      documentType: "inquiry",
      confirmationState: "confirmed",
      confidence: 0.96,
      riskSignals: [],
      revision: 2,
    }, {
      id: "bdc_history",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      artifactId: "wfa_history",
      documentType: "inquiry",
      confirmationState: "corrected",
      confidence: 1,
      riskSignals: [],
      revision: 3,
      updatedAt: "2026-07-31T00:00:00.000Z",
    }],
    workItems: [],
  };
  let sequence = 0;
  const events = [];
  const createWorkItem = (input, actor) => {
    const replay = state.workItems.find((row) => row.createIdempotencyKey === input.idempotencyKey);
    if (replay) return { status: 200, body: { workItem: replay, replayed: true } };
    const row = {
      id: `lwi_${++sequence}`,
      localRef: `LOCAL-${sequence}`,
      ownerTeamId: actor.teamId,
      createdBy: actor.userId,
      createIdempotencyKey: input.idempotencyKey,
      ...input,
    };
    state.workItems.push(row);
    return { status: 201, body: { workItem: row } };
  };
  const service = createWorkflowAdaptiveWorkService({
    state,
    now: options.now ?? (() => "2026-08-01T00:00:00.000Z"),
    nextId: (prefix) => `${prefix}_${++sequence}`,
    appendEvent: (event) => events.push(event),
    createWorkItem,
    runIntakeCycle: options.runIntakeCycle,
  });
  return { state, service, events };
}

test("directory monitor is owner-confirmed, revision guarded, and recovers with backoff", async () => {
  let timestamp = "2026-08-01T00:00:00.000Z";
  let shouldFail = true;
  const cycles = [];
  const { state, service } = harness({
    now: () => timestamp,
    runIntakeCycle: async (input) => {
      cycles.push(input);
      if (shouldFail) throw new Error("temporary_read_failure");
      return { status: 200, body: { ok: true } };
    },
  });
  assert.equal(service.updateMonitor({
    projectId: "prj_a", sourceId: "wfs_a", expectedRevision: 0,
    enabled: true, intervalMinutes: 5,
  }, ACTOR).body.error, "adaptive_work_monitor_confirmation_required");
  assert.equal(service.updateMonitor({
    projectId: "prj_a", sourceId: "wfs_a", expectedRevision: 0,
    enabled: true, intervalMinutes: 5, confirmed: true,
  }, OPERATOR).status, 403);
  const enabled = service.updateMonitor({
    projectId: "prj_a", sourceId: "wfs_a", expectedRevision: 0,
    enabled: true, intervalMinutes: 5, confirmed: true,
  }, ACTOR);
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.monitor.revision, 1);
  assert.equal(service.updateMonitor({
    projectId: "prj_a", sourceId: "wfs_a", expectedRevision: 0,
    enabled: false, intervalMinutes: 5,
  }, ACTOR).status, 409);

  const failed = await service.sweepMonitors();
  assert.equal(failed.attempted, 1);
  assert.equal(failed.results[0].status, "failed");
  assert.equal(state.workflowAdaptiveMonitors[0].state, "backoff");
  assert.equal(state.workflowAdaptiveMonitors[0].consecutiveFailures, 1);
  assert.equal(state.workflowAdaptiveMonitors[0].nextRunAt, "2026-08-01T00:10:00.000Z");
  assert.equal(state.workflowAdaptiveNotifications[0].kind, "monitor_failed");

  timestamp = "2026-08-01T00:10:00.000Z";
  shouldFail = false;
  const recovered = await service.sweepMonitors();
  assert.equal(recovered.results[0].status, "succeeded");
  assert.equal(state.workflowAdaptiveMonitors[0].state, "scheduled");
  assert.equal(state.workflowAdaptiveMonitors[0].consecutiveFailures, 0);
  assert.equal(state.workflowAdaptiveMonitors[0].nextRunAt, "2026-08-01T00:15:00.000Z");
  assert.equal(state.workflowAdaptiveNotifications[1].kind, "monitor_recovered");
  assert.equal(cycles.length, 2);
});

test("monitor sweep limits global concurrency and restores interrupted records", async () => {
  const state = {
    projects: [{ id: "prj_a", ownerTeamId: "team_a" }],
    workflowSources: ["a", "b", "c"].map((suffix) => ({
      id: `wfs_${suffix}`,
      ownerTeamId: "team_a",
      projectId: "prj_a",
      state: "active",
    })),
    workflowAdaptiveMonitors: ["a", "b", "c"].map((suffix) => ({
      id: `awm_${suffix}`,
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: `wfs_${suffix}`,
      enabled: true,
      intervalMinutes: 5,
      revision: 1,
      state: suffix === "a" ? "running" : "scheduled",
      nextRunAt: "2026-08-01T00:00:00.000Z",
      consecutiveFailures: 0,
      authorizedBy: "usr_a",
    })),
  };
  let active = 0;
  let peak = 0;
  const service = createWorkflowAdaptiveWorkService({
    state,
    now: () => "2026-08-01T00:00:00.000Z",
    runIntakeCycle: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return { status: 200, body: {} };
    },
  });
  assert.equal(state.workflowAdaptiveMonitors[0].state, "recoverable");
  const result = await service.sweepMonitors();
  assert.equal(result.attempted, 2);
  assert.equal(result.capped, true);
  assert.equal(peak, 2);
  assert.equal(state.workflowAdaptiveMonitors.filter((row) => row.lastSuccessAt).length, 2);
});

test("an enabled monitor can run immediately without overlapping the same source", async () => {
  let releaseCycle;
  const cycle = new Promise((resolve) => { releaseCycle = resolve; });
  const { service } = harness({
    runIntakeCycle: async () => {
      await cycle;
      return { status: 200, body: { observed: 1 } };
    },
  });
  assert.equal((await service.runMonitorNow({
    projectId: "prj_a", sourceId: "wfs_a",
  }, ACTOR)).body.error, "adaptive_work_monitor_disabled");
  service.updateMonitor({
    projectId: "prj_a", sourceId: "wfs_a", expectedRevision: 0,
    enabled: true, intervalMinutes: 15, confirmed: true,
  }, ACTOR);
  const first = service.runMonitorNow({ projectId: "prj_a", sourceId: "wfs_a" }, ACTOR);
  await Promise.resolve();
  const overlapping = await service.runMonitorNow({
    projectId: "prj_a", sourceId: "wfs_a",
  }, OPERATOR);
  assert.equal(overlapping.status, 409);
  assert.equal(overlapping.body.error, "adaptive_work_monitor_already_running");
  releaseCycle();
  const completed = await first;
  assert.equal(completed.status, 200);
  assert.equal(completed.body.monitor.lastSuccessAt, "2026-08-01T00:00:00.000Z");
  assert.equal(completed.body.monitor.state, "scheduled");
});

test("explains a ready inquiry with history and local-only boundaries", () => {
  const { service, events } = harness();
  const result = service.getWorkbench({ projectId: "prj_a", sourceId: "wfs_a" }, ACTOR);
  assert.equal(result.status, 200);
  assert.equal(result.body.policy.mode, "observe");
  assert.deepEqual(result.body.policy.boundary, {
    localIssueOnly: true,
    externalDelivery: false,
    overwriteFiles: false,
  });
  assert.equal(result.body.suggestions.length, 1);
  assert.equal(result.body.suggestions[0].documentType, "inquiry");
  assert.equal(result.body.suggestions[0].readiness, "ready");
  assert.equal(result.body.suggestions[0].history[0].artifact.name, "RFQ-2026-100.xlsx");
  assert.ok(result.body.suggestions[0].actions.includes("更新询价台账"));
  assert.equal(service.getWorkbench({ projectId: "prj_a" }, FOREIGN).status, 404);
});

test("policy updates are revision guarded and operators cannot manage it", () => {
  const { service, events } = harness();
  assert.equal(service.updatePolicy({
    projectId: "prj_a", expectedRevision: 0, mode: "assist",
  }, OPERATOR).status, 403);
  const updated = service.updatePolicy({
    projectId: "prj_a", expectedRevision: 0, mode: "assist",
  }, ACTOR);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.policy.mode, "assist");
  assert.equal(updated.body.policy.revision, 1);
  assert.equal(events[0].type, "workflow_adaptive_policy_updated");
  assert.equal(service.updatePolicy({
    projectId: "prj_a", expectedRevision: 0, mode: "execute", confirmed: true,
  }, ACTOR).status, 409);
  assert.equal(service.updatePolicy({
    projectId: "prj_a", sourceId: "wfs_a", expectedRevision: 0, mode: "execute",
  }, ACTOR).body.error, "adaptive_work_execute_confirmation_required");
  const sourcePolicy = service.updatePolicy({
    projectId: "prj_a", sourceId: "wfs_a", expectedRevision: 0, mode: "execute", confirmed: true,
  }, ACTOR);
  assert.equal(sourcePolicy.status, 200);
  assert.equal(sourcePolicy.body.policy.scope, "source");
  assert.equal(sourcePolicy.body.policy.mode, "execute");
});

test("explicit confirmation materializes one idempotent local issue", () => {
  const { state, service } = harness();
  const suggestion = service.getWorkbench({ projectId: "prj_a" }, ACTOR).body.suggestions[0];
  assert.equal(service.materialize({
    projectId: "prj_a", suggestionId: suggestion.id,
  }, ACTOR).status, 400);
  assert.equal(service.materialize({
    projectId: "prj_a", suggestionId: suggestion.id, confirmed: true,
  }, ACTOR).body.error, "adaptive_work_observe_mode");
  service.updatePolicy({
    projectId: "prj_a", expectedRevision: 0, mode: "assist",
  }, ACTOR);
  const first = service.materialize({
    projectId: "prj_a", suggestionId: suggestion.id, confirmed: true,
  }, ACTOR);
  assert.equal(first.status, 201);
  assert.equal(state.workItems.length, 1);
  assert.ok(first.body.workItem.body.includes("不会外发、覆盖或修改原文件"));
  const replay = service.materialize({
    projectId: "prj_a", suggestionId: suggestion.id, confirmed: true,
  }, OPERATOR);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(state.workItems.length, 1);
});

test("tracks a suggestion through its local Issue to a completed delivery outcome", () => {
  const { state, service } = harness();
  service.updatePolicy({
    projectId: "prj_a", sourceId: "wfs_a", expectedRevision: 0, mode: "assist",
  }, ACTOR);
  const suggestion = service.getWorkbench({
    projectId: "prj_a", sourceId: "wfs_a",
  }, ACTOR).body.suggestions[0];
  const materialized = service.materialize({
    projectId: "prj_a", sourceId: "wfs_a", suggestionId: suggestion.id, confirmed: true,
  }, ACTOR);
  assert.equal(materialized.status, 201);
  assert.equal(materialized.body.workbench.suggestions[0].outcome.status, "active");
  assert.equal(state.workflowAdaptiveOutcomes.length, 1);

  Object.assign(state.workItems[0], {
    status: "done",
    completedAt: "2026-08-01T01:00:00.000Z",
    outputAssets: [{ id: "asset_quote", family: "document", name: "报价单.docx", path: "deliveries/报价单.docx" }],
    verificationRecords: [{
      id: "wvr_quote", kind: "manual", status: "passed",
      summary: "报价内容已复核", recordedAt: "2026-08-01T00:59:00.000Z",
    }],
  });
  const firstSync = service.syncWorkItemOutcome({ workItemId: state.workItems[0].id }, ACTOR);
  assert.equal(firstSync.status, 200);
  assert.equal(firstSync.body.tracked, true);
  assert.equal(firstSync.body.outcome.status, "completed");
  assert.equal(firstSync.body.outcome.outputAssets[0].name, "报价单.docx");
  assert.equal(firstSync.body.outcome.verification[0].status, "passed");
  const secondSync = service.syncWorkItemOutcome({ workItemId: state.workItems[0].id }, ACTOR);
  assert.equal(secondSync.body.outcome.id, firstSync.body.outcome.id);
  assert.equal(state.workflowAdaptiveOutcomes.length, 1);
  const workbench = service.getWorkbench({ projectId: "prj_a", sourceId: "wfs_a" }, ACTOR).body;
  assert.equal(workbench.metrics.tracked, 1);
  assert.equal(workbench.metrics.completed, 1);
  assert.equal(workbench.metrics.completionRate, 1);
});

test("creates, publishes, versions, and rolls back governed learning rules", () => {
  const { state, service } = harness();
  for (const index of [2, 3]) {
    state.workflowArtifacts.push({
      id: `wfa_shadow_${index}`,
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      name: `RFQ-SHADOW-${index}.xlsx`,
      family: "spreadsheet",
      extension: "xlsx",
    });
    state.workflowIntakeObservations.push({
      id: `wio_shadow_${index}`,
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      artifactId: `wfa_shadow_${index}`,
      state: "ready",
    });
    state.businessDocumentClassifications.push({
      id: `bdc_shadow_${index}`,
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      artifactId: `wfa_shadow_${index}`,
      documentType: "inquiry",
      confirmationState: "confirmed",
      confidence: 0.97,
      riskSignals: [],
      revision: 1,
    });
  }
  state.workflowAdaptiveFeedback.push(...[1, 2, 3, 4, 5].map((index) => ({
    id: `awf_evidence_${index}`,
    ownerTeamId: "team_a",
    projectId: "prj_a",
    sourceId: "wfs_a",
    suggestionId: `historical_${index}`,
    documentType: "inquiry",
    decision: index === 1 ? "rejected" : "accepted",
    reason: index === 1 ? "wrong_document_type" : "correct_workflow",
    correctedDocumentType: index === 1 ? "price_list" : null,
    correctedActions: index === 1 ? ["生成客户报价单", "更新报价台账"] : [],
    correctionConfirmed: index === 1,
    createdBy: "usr_a",
  })));
  const firstDraft = service.generateLearningDraft({ projectId: "prj_a", sourceId: "wfs_a" }, ACTOR);
  assert.equal(service.listLearning({
    projectId: "prj_a", sourceId: "wfs_a",
  }, ACTOR).body.readiness.canEvaluate, true);
  assert.equal(firstDraft.status, 201);
  assert.equal(firstDraft.body.draft.version, 1);
  assert.equal(firstDraft.body.draft.status, "shadow");
  assert.equal(firstDraft.body.draft.evaluation.passed, false);
  assert.ok(firstDraft.body.draft.configuration.documentTypes
    .find((row) => row.documentType === "price_list").actions.includes("生成客户报价单"));
  const firstComparisons = service.getWorkbench({
    projectId: "prj_a", sourceId: "wfs_a",
  }, ACTOR).body.suggestions.slice(0, 3);
  for (const [index, suggestion] of firstComparisons.entries()) {
    const preference = service.recordShadowPreference({
      draftId: firstDraft.body.draft.id,
      suggestionId: suggestion.id,
      expectedRevision: index + 1,
      preferred: "candidate",
      reason: "candidate_matches_workflow",
      confirmed: true,
    }, ACTOR);
    assert.equal(preference.status, 201);
  }
  const firstEvaluation = service.evaluateAndGovern({ projectId: "prj_a", sourceId: "wfs_a" }, ACTOR);
  assert.equal(firstEvaluation.body.evaluation.passed, true);
  assert.equal(firstEvaluation.body.evaluation.shadow.candidateWins, 3);
  assert.equal(service.publishLearningDraft({
    draftId: firstDraft.body.draft.id,
    expectedRevision: 5,
  }, ACTOR).body.error, "adaptive_work_learning_publish_confirmation_required");
  assert.equal(service.publishLearningDraft({
    draftId: firstDraft.body.draft.id,
    expectedRevision: 5,
    confirmed: true,
  }, ACTOR).body.error, "adaptive_work_learning_publication_review_required");
  const firstReview = service.previewLearningPublication({
    draftId: firstDraft.body.draft.id,
  }, ACTOR);
  assert.equal(firstReview.status, 200);
  assert.equal(firstReview.body.review.gate.passed, true);
  assert.equal(firstReview.body.review.boundary.externalDelivery, false);
  assert.equal(firstReview.body.review.impact.affectedSuggestions, 3);
  assert.equal(service.publishLearningDraft({
    draftId: firstDraft.body.draft.id,
    expectedRevision: 5,
    reviewFingerprint: "stale-review",
    confirmed: true,
  }, ACTOR).body.error, "adaptive_work_learning_publication_review_required");
  const firstRule = service.publishLearningDraft({
    draftId: firstDraft.body.draft.id,
    expectedRevision: 5,
    reviewFingerprint: firstReview.body.review.fingerprint,
    confirmed: true,
  }, ACTOR);
  assert.equal(firstRule.status, 201);
  assert.equal(firstRule.body.rule.version, 1);
  const suggestion = service.getWorkbench({ projectId: "prj_a", sourceId: "wfs_a" }, ACTOR).body.suggestions[0];
  assert.equal(suggestion.learnedRule.id, firstRule.body.rule.id);
  assert.equal(suggestion.detectedDocumentType, "inquiry");
  assert.equal(suggestion.documentType, "price_list");
  assert.ok(suggestion.reasons.includes("learned_type_mapping_applied"));
  assert.ok(suggestion.actions.includes("生成客户报价单"));

  state.workflowAdaptiveFeedback.push({
    ...state.workflowAdaptiveFeedback[0],
    id: "awf_evidence_new",
    suggestionId: "historical_1",
    correctedActions: ["生成第二版报价单", "更新报价台账"],
    correctionConfirmed: true,
  });
  const secondDraft = service.generateLearningDraft({ projectId: "prj_a", sourceId: "wfs_a" }, ACTOR);
  const secondComparisons = service.getWorkbench({
    projectId: "prj_a", sourceId: "wfs_a",
  }, ACTOR).body.suggestions.slice(0, 3);
  for (const [index, suggestion] of secondComparisons.entries()) {
    assert.equal(service.recordShadowPreference({
      draftId: secondDraft.body.draft.id,
      suggestionId: suggestion.id,
      expectedRevision: index + 1,
      preferred: "candidate",
      reason: "candidate_matches_workflow",
      confirmed: true,
    }, ACTOR).status, 201);
  }
  service.evaluateAndGovern({ projectId: "prj_a", sourceId: "wfs_a" }, ACTOR);
  const secondReview = service.previewLearningPublication({
    draftId: secondDraft.body.draft.id,
  }, ACTOR);
  assert.equal(secondReview.body.review.rollback.ruleId, firstRule.body.rule.id);
  const secondRule = service.publishLearningDraft({
    draftId: secondDraft.body.draft.id,
    expectedRevision: 5,
    reviewFingerprint: secondReview.body.review.fingerprint,
    confirmed: true,
  }, ACTOR);
  assert.equal(secondRule.body.rule.version, 2);
  assert.equal(state.workflowAdaptiveRules[0].status, "superseded");
  assert.equal(service.rollbackLearningRule({
    ruleId: secondRule.body.rule.id,
    expectedRevision: 1,
    confirmed: true,
  }, ACTOR).status, 200);
  assert.equal(state.workflowAdaptiveRules[0].status, "active");
  assert.equal(state.workflowAdaptiveRules[1].status, "rolled_back");
  assert.equal(service.listLearning({ projectId: "prj_a", sourceId: "wfs_a" }, ACTOR).body.rules.length, 2);
});

test("shadow gate rejects a candidate when every reviewer prefers neither result", () => {
  const { state, service } = harness();
  for (const index of [2, 3]) {
    state.workflowArtifacts.push({
      id: `wfa_neither_${index}`,
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      name: `RFQ-NEITHER-${index}.xlsx`,
      family: "spreadsheet",
      extension: "xlsx",
    });
    state.workflowIntakeObservations.push({
      id: `wio_neither_${index}`,
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      artifactId: `wfa_neither_${index}`,
      state: "ready",
    });
    state.businessDocumentClassifications.push({
      id: `bdc_neither_${index}`,
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      artifactId: `wfa_neither_${index}`,
      documentType: "inquiry",
      confirmationState: "confirmed",
      confidence: 0.97,
      riskSignals: [],
      revision: 1,
    });
  }
  state.workflowAdaptiveFeedback.push(...[1, 2, 3, 4, 5].map((index) => ({
    id: `awf_neither_${index}`,
    ownerTeamId: "team_a",
    projectId: "prj_a",
    sourceId: "wfs_a",
    suggestionId: `neither_history_${index}`,
    documentType: "inquiry",
    decision: "accepted",
    reason: "confirmed_workflow",
    correctedDocumentType: null,
    correctedActions: index === 1 ? ["生成候选报价单", "更新报价台账"] : [],
    createdBy: "usr_a",
  })));
  const draft = service.generateLearningDraft({ projectId: "prj_a", sourceId: "wfs_a" }, ACTOR)
    .body.draft;
  const suggestions = service.getWorkbench({ projectId: "prj_a", sourceId: "wfs_a" }, ACTOR)
    .body.suggestions.slice(0, 3);
  for (const [index, suggestion] of suggestions.entries()) {
    assert.equal(service.recordShadowPreference({
      draftId: draft.id,
      suggestionId: suggestion.id,
      expectedRevision: index + 1,
      preferred: "neither",
      reason: "both_results_are_incorrect",
      confirmed: true,
    }, ACTOR).status, 201);
  }
  const evaluation = service.evaluateAndGovern({
    projectId: "prj_a", sourceId: "wfs_a",
  }, ACTOR).body.evaluation;
  assert.equal(evaluation.shadow.neitherWins, 3);
  assert.equal(evaluation.passed, false);
  assert.ok(evaluation.reasons.includes("shadow_candidate_not_preferred"));
});

test("shadow evaluation automatically downgrades unsafe execute automation", () => {
  const { state, service, events } = harness();
  service.updatePolicy({
    projectId: "prj_a", sourceId: "wfs_a", expectedRevision: 0,
    mode: "execute", confirmed: true,
  }, ACTOR);
  state.workflowAdaptiveFeedback.push(...[1, 2, 3, 4, 5].map((index) => ({
    id: `awf_bad_${index}`,
    ownerTeamId: "team_a",
    projectId: "prj_a",
    sourceId: "wfs_a",
    suggestionId: `bad_${index}`,
    documentType: "inquiry",
    decision: index === 1 ? "accepted" : "rejected",
    reason: "wrong_workflow",
    createdBy: "usr_a",
  })));
  const result = service.evaluateAndGovern({ projectId: "prj_a", sourceId: "wfs_a" }, ACTOR);
  assert.equal(result.status, 200);
  assert.equal(result.body.evaluation.representative, true);
  assert.equal(result.body.evaluation.passed, false);
  assert.equal(result.body.governance.downgraded, true);
  assert.equal(result.body.governance.currentMode, "assist");
  assert.equal(state.workflowAdaptiveNotifications[0].kind, "automation_downgraded");
  assert.ok(events.some((row) => row.type === "workflow_adaptive_policy_auto_downgraded"));
  const notifications = service.listNotifications({
    projectId: "prj_a", sourceId: "wfs_a",
  }, ACTOR);
  assert.equal(notifications.body.unread, 1);
  assert.equal(service.readNotification({
    notificationId: notifications.body.notifications[0].id,
  }, FOREIGN).status, 404);
  assert.equal(service.readNotification({
    notificationId: notifications.body.notifications[0].id,
  }, ACTOR).status, 200);
  assert.equal(service.listNotifications({
    projectId: "prj_a", sourceId: "wfs_a",
  }, ACTOR).body.unread, 0);
  assert.equal(service.evaluateAndGovern({
    projectId: "prj_a", sourceId: "wfs_a",
  }, ACTOR).body.governance.downgraded, false);
});

test("learning requires representative evidence and rejects unsafe corrections", () => {
  const { service } = harness();
  assert.deepEqual(service.listLearning({
    projectId: "prj_a", sourceId: "wfs_a",
  }, ACTOR).body.readiness, {
    evidenceCount: 0,
    accepted: 0,
    rejected: 0,
    draftRequired: 3,
    evaluationRequired: 5,
    canGenerate: false,
    canEvaluate: false,
  });
  assert.equal(service.generateLearningDraft({
    projectId: "prj_a", sourceId: "wfs_a",
  }, ACTOR).body.error, "adaptive_work_learning_evidence_insufficient");
  const suggestion = service.getWorkbench({ projectId: "prj_a", sourceId: "wfs_a" }, ACTOR).body.suggestions[0];
  assert.equal(service.recordFeedback({
    projectId: "prj_a",
    sourceId: "wfs_a",
    suggestionId: suggestion.id,
    decision: "rejected",
    reason: "wrong_action",
    correctedActions: "not-an-array",
  }, ACTOR).body.error, "adaptive_work_feedback_invalid");
  assert.equal(service.recordFeedback({
    projectId: "prj_a",
    sourceId: "wfs_a",
    suggestionId: suggestion.id,
    decision: "rejected",
    reason: "wrong_document_type",
    correctedDocumentType: "price_list",
    correctedActions: ["核对价格表版本"],
  }, ACTOR).body.error, "adaptive_work_feedback_correction_confirmation_required");
  assert.equal(service.recordFeedback({
    projectId: "prj_a",
    sourceId: "wfs_a",
    suggestionId: suggestion.id,
    decision: "rejected",
    reason: "missing_actions",
  }, ACTOR).body.error, "adaptive_work_feedback_correction_required");
  assert.equal(service.recordFeedback({
    projectId: "prj_a",
    sourceId: "wfs_a",
    suggestionId: suggestion.id,
    decision: "accepted",
    reason: "useful_recommendation",
    correctedActions: ["不应通过已采纳反馈写入纠正"],
    correctionConfirmed: true,
  }, ACTOR).body.error, "adaptive_work_feedback_correction_required");
  assert.equal(service.recordFeedback({
    projectId: "prj_a",
    sourceId: "wfs_a",
    suggestionId: suggestion.id,
    decision: "rejected",
    reason: "wrong_document_type",
    correctedDocumentType: "inquiry",
    correctedActions: suggestion.actions,
    correctionConfirmed: true,
  }, ACTOR).body.error, "adaptive_work_feedback_correction_required");
  assert.equal(service.recordFeedback({
    projectId: "prj_a",
    sourceId: "wfs_a",
    suggestionId: suggestion.id,
    decision: "rejected",
    reason: "missing_actions",
    correctedActions: suggestion.actions,
    correctionConfirmed: true,
  }, ACTOR).body.error, "adaptive_work_feedback_correction_required");
  assert.equal(service.recordFeedback({
    projectId: "prj_a",
    sourceId: "wfs_a",
    suggestionId: suggestion.id,
    decision: "rejected",
    reason: "already_handled",
    correctedActions: ["不应作为纠正证据"],
    correctionConfirmed: true,
  }, ACTOR).body.error, "adaptive_work_feedback_correction_required");
  const corrected = service.recordFeedback({
    projectId: "prj_a",
    sourceId: "wfs_a",
    suggestionId: suggestion.id,
    decision: "rejected",
    reason: "wrong_document_type",
    correctedDocumentType: "price_list",
    correctedActions: ["核对价格表版本"],
    correctionConfirmed: true,
  }, ACTOR);
  assert.equal(corrected.status, 201);
  assert.deepEqual(corrected.body.feedback.correction, {
    confirmed: true,
    before: {
      documentType: "inquiry",
      actions: ["核对询价信息", "生成报价单", "更新询价台账", "更新报价台账"],
    },
    after: {
      documentType: "price_list",
      actions: ["核对价格表版本"],
    },
  });
  const actionCorrection = service.recordFeedback({
    projectId: "prj_a",
    sourceId: "wfs_a",
    suggestionId: suggestion.id,
    decision: "rejected",
    reason: "missing_actions",
    correctedActions: ["核对询价信息", "生成报价单", "登记客户要求的交期"],
    correctionConfirmed: true,
  }, ACTOR);
  assert.equal(actionCorrection.status, 201);
  assert.deepEqual(actionCorrection.body.feedback.correction.after.actions,
    ["核对询价信息", "生成报价单", "登记客户要求的交期"]);
});

test("unconfirmed classifications block issue creation and feedback is auditable", () => {
  const { state, service, events } = harness();
  state.businessDocumentClassifications[0].confirmationState = "proposed";
  const suggestion = service.getWorkbench({ projectId: "prj_a" }, OPERATOR).body.suggestions[0];
  assert.equal(suggestion.readiness, "needs_confirmation");
  assert.equal(service.materialize({
    projectId: "prj_a", suggestionId: suggestion.id, confirmed: true,
  }, OPERATOR).status, 409);
  const feedback = service.recordFeedback({
    projectId: "prj_a",
    suggestionId: suggestion.id,
    decision: "rejected",
    reason: "wrong_document_type",
    note: "这是一份价格参考表",
    correctedDocumentType: "price_list",
    correctedActions: ["核对价格表版本", "将价格表作为报价参考资料"],
    correctionConfirmed: true,
  }, OPERATOR);
  assert.equal(feedback.status, 201);
  assert.equal(state.workflowAdaptiveFeedback[0].createdBy, "usr_op");
  assert.equal(feedback.body.workbench.suggestions[0].feedback.decision, "rejected");
  assert.equal(events[0].type, "workflow_adaptive_feedback_recorded");
});

test("execute mode auto-creates only a trusted low-risk local Issue", () => {
  const { state, service } = harness();
  for (const index of [2, 3]) {
    state.workflowArtifacts.push({
      id: `wfa_history_${index}`,
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      name: `RFQ-2026-10${index}.xlsx`,
      family: "spreadsheet",
      extension: "xlsx",
    });
    state.businessDocumentClassifications.push({
      id: `bdc_history_${index}`,
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      artifactId: `wfa_history_${index}`,
      documentType: "inquiry",
      confirmationState: "confirmed",
      confidence: 1,
      riskSignals: [],
      revision: 1,
    });
  }
  assert.equal(service.reconcile({ projectId: "prj_a", sourceId: "wfs_a" }, ACTOR).body.autoCreated, 0);
  service.updatePolicy({
    projectId: "prj_a", sourceId: "wfs_a", expectedRevision: 0, mode: "execute", confirmed: true,
  }, ACTOR);
  const result = service.reconcile({ projectId: "prj_a", sourceId: "wfs_a" }, ACTOR);
  assert.equal(result.status, 200);
  assert.equal(result.body.autoCreated, 1);
  assert.equal(state.workItems.length, 1);
  assert.ok(state.workItems[0].labels.includes("adaptive-auto"));
  assert.equal(service.reconcile({
    projectId: "prj_a", sourceId: "wfs_a",
  }, ACTOR).body.autoCreated, 0);
});
