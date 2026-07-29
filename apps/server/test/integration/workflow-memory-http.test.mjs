process.env.MYAGENT_REQUIRE_AUTH = "1";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, before, test } from "node:test";

let server;
let base;
let runtimeState;
const root = join(tmpdir(), `myagenttool-workflow-memory-http-${process.pid}`);

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");
  const now = () => new Date().toISOString();

  mkdirSync(join(root, "history", "deliveries"), { recursive: true });
  writeFileSync(
    join(root, "history", "客户需求-100.md"),
    "# 需求说明\n\n业务目标：生成方案。\n\n## 验收标准\n内容完整。",
  );
  writeFileSync(
    join(root, "history", "deliveries", "最终交付-100.md"),
    "# 实施方案\n\n## 解决方案\n按阶段交付。",
  );
  writeFileSync(
    join(root, "history", "新需求-200.md"),
    "# 需求说明\n\n业务目标：生成新方案。\n\n## 验收标准\n内容完整。",
  );
  mkdirSync(join(root, "history", "business"), { recursive: true });
  writeFileSync(
    join(root, "history", "business", "询价单-RFQ-HTTP-001.md"),
    [
      "# 询价单",
      "询价编号：RFQ-HTTP-001",
      "客户名称：星海科技",
      "产品名称：控制器",
      "数量：20",
      "币种：CNY",
    ].join("\n"),
  );
  execFileSync("git", ["init", "-b", "main", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.test"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Test"]);
  execFileSync("git", ["-C", root, "add", "history"]);
  execFileSync("git", ["-C", root, "commit", "-m", "workflow fixtures"]);

  const { defaultProject, state } = createServerState({ defaultProjectPath: root, now });
  runtimeState = state;
  state.teams.push({ id: "team_a" }, { id: "team_b" });
  state.users.push(
    { id: "usr_a", teamId: "team_a" },
    { id: "usr_b", teamId: "team_b" },
  );
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  state.tokens.push(
    { token: "tok_a", userId: "usr_a", expiresAt },
    { token: "tok_b", userId: "usr_b", expiresAt },
  );
  state.projects.push({ id: "prj_a", name: "Workflow fixtures", ownerTeamId: "team_a", path: root });

  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state,
    defaultProject,
    defaultProjectPath: root,
    persistenceEnabled: false,
    stateStorePath: join(root, "unused.json"),
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  server = createHttpServer({
    host: "127.0.0.1",
    port: 0,
    namespace: "test",
    protocolVersion: "0.0.0",
    ...httpDependencies,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  rmSync(root, { recursive: true, force: true });
});

async function call(path, { token = "tok_a", method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

test("workflow memory routes authorize, scan, classify, and enforce tenancy over HTTP", async () => {
  const created = await call("/api/workflow-memory/sources", {
    method: "POST",
    body: {
      projectId: "prj_a",
      relativePath: "history",
      readMode: "supported_text",
      name: "Historical work",
    },
  });
  assert.equal(created.status, 201);
  const source = created.body.source;

  const scan = await call(`/api/workflow-memory/sources/${source.id}/scan`, { method: "POST" });
  assert.equal(scan.status, 200);
  assert.equal(scan.body.scan.discovered, 4);

  const artifacts = await call(`/api/workflow-memory/artifacts?sourceId=${source.id}`);
  assert.equal(artifacts.status, 200);
  assert.deepEqual(
    artifacts.body.artifacts.map((artifact) => artifact.roleInference.role).sort(),
    ["delivery", "requirement", "requirement", "requirement"],
  );

  const requirement = artifacts.body.artifacts.find((artifact) =>
    artifact.name === "客户需求-100.md");
  const delivery = artifacts.body.artifacts.find((artifact) =>
    artifact.name === "最终交付-100.md");
  const newRequirement = artifacts.body.artifacts.find((artifact) =>
    artifact.name === "新需求-200.md");
  const inquiry = artifacts.body.artifacts.find((artifact) =>
    artifact.name === "询价单-RFQ-HTTP-001.md");
  const businessAnalysis = await call(
    `/api/workflow-memory/artifacts/${inquiry.id}/analyze-business-document`,
    { method: "POST" },
  );
  assert.equal(businessAnalysis.status, 201, JSON.stringify(businessAnalysis.body));
  assert.equal(businessAnalysis.body.classification.documentType, "inquiry");
  assert.equal(
    businessAnalysis.body.classification.fieldProposals.find((field) =>
      field.key === "inquiry_number").normalizedValue,
    "RFQ-HTTP-001",
  );
  const classifications = await call(
    `/api/workflow-memory/business-document-classifications?sourceId=${source.id}`,
  );
  assert.equal(classifications.status, 200);
  assert.equal(classifications.body.count, 1);
  assert.equal((await call(
    `/api/workflow-memory/business-document-classifications?sourceId=${source.id}`,
    { token: "tok_b" },
  )).status, 404);
  const confirmedBusiness = await call(
    `/api/workflow-memory/business-document-classifications/${businessAnalysis.body.classification.id}/confirm`,
    {
      method: "POST",
      body: {
        expectedRevision: businessAnalysis.body.classification.revision,
        fieldCorrections: { customer: "星海科技有限公司" },
      },
    },
  );
  assert.equal(confirmedBusiness.status, 200, JSON.stringify(confirmedBusiness.body));
  assert.equal(confirmedBusiness.body.entity.businessKey, "RFQ-HTTP-001");
  const discoveredBusinessCases = await call(
    `/api/workflow-memory/sources/${source.id}/discover-business-cases`,
    { method: "POST" },
  );
  assert.equal(discoveredBusinessCases.status, 200);
  assert.equal(discoveredBusinessCases.body.count, 0);
  const businessCaseCandidates = await call(
    `/api/workflow-memory/business-case-candidates?sourceId=${source.id}`,
  );
  assert.equal(businessCaseCandidates.status, 200);
  assert.equal(businessCaseCandidates.body.count, 0);
  assert.equal((await call(
    `/api/workflow-memory/business-case-candidates?sourceId=${source.id}`,
    { token: "tok_b" },
  )).status, 404);
  const insufficientRoutine = await call(
    `/api/workflow-memory/sources/${source.id}/discover-business-routine`,
    { method: "POST" },
  );
  assert.equal(insufficientRoutine.status, 409);
  assert.equal(insufficientRoutine.body.error, "insufficient_confirmed_business_cases");
  assert.equal(insufficientRoutine.body.minimumCaseCount, 3);
  const routineCandidates = await call(
    `/api/workflow-memory/business-routine-candidates?sourceId=${source.id}`,
  );
  assert.equal(routineCandidates.status, 200);
  assert.equal(routineCandidates.body.count, 0);
  const inquiryArtifact = runtimeState.workflowArtifacts.find((artifact) => artifact.id === inquiry.id);
  for (const index of [1, 2, 3]) {
    runtimeState.businessCases.push({
      id: `bcs_http_${index}`,
      ownerTeamId: "team_a",
      projectId: source.projectId,
      sourceId: source.id,
      businessKey: `RFQ-HTTP-${index}`,
      state: "confirmed",
      artifactBindings: [{
        artifactId: inquiry.id,
        documentType: "inquiry",
        roles: ["trigger", "input"],
      }],
      artifactFingerprints: { [inquiry.id]: inquiryArtifact.fingerprint },
      revision: 1,
    });
  }
  runtimeState.routineDiscoveryCandidates.push({
    id: "rdc_http",
    ownerTeamId: "team_a",
    projectId: source.projectId,
    sourceId: source.id,
    state: "candidate",
    triggerDocumentTypes: ["inquiry"],
    confirmedCaseIds: ["bcs_http_1", "bcs_http_2", "bcs_http_3"],
    steps: [{
      key: "register",
      kind: "ledger_upsert",
      label: "Register inquiry",
      required: true,
      requirement: "mandatory",
      coverage: 1,
      dependsOn: [],
      evidenceRefs: [{ artifactId: inquiry.id, kind: "coverage", field: null, location: null }],
      configuration: {},
    }],
    evidenceRefs: [{ artifactId: inquiry.id, kind: "routine", field: null, location: null }],
    confidence: 0.9,
  });
  const routineDraft = await call(
    "/api/workflow-memory/business-routine-candidates/rdc_http/create-draft",
    { method: "POST" },
  );
  assert.equal(routineDraft.status, 201, JSON.stringify(routineDraft.body));
  assert.equal(routineDraft.body.routineDefinition.state, "draft");
  const routineDefinitionId = routineDraft.body.routineDefinition.id;
  const updatedRoutine = await call(
    `/api/workflow-memory/business-routine-definitions/${routineDefinitionId}/update`,
    {
      method: "POST",
      body: {
        expectedRevision: routineDraft.body.routineDefinition.revision,
        name: "Commercial inquiry and quotation",
        description: "A reviewed commercial workflow.",
        steps: routineDraft.body.routineDefinition.steps,
      },
    },
  );
  assert.equal(updatedRoutine.status, 200, JSON.stringify(updatedRoutine.body));
  assert.equal((await call(
    `/api/workflow-memory/business-routine-definitions/${routineDefinitionId}/publish`,
    {
      method: "POST",
      body: { expectedRevision: updatedRoutine.body.routineDefinition.revision, confirmed: false },
    },
  )).status, 400);
  const publishedRoutine = await call(
    `/api/workflow-memory/business-routine-definitions/${routineDefinitionId}/publish`,
    {
      method: "POST",
      body: { expectedRevision: updatedRoutine.body.routineDefinition.revision, confirmed: true },
    },
  );
  assert.equal(publishedRoutine.status, 200, JSON.stringify(publishedRoutine.body));
  assert.equal(publishedRoutine.body.routineDefinition.state, "published");
  const nextRoutineVersion = await call(
    `/api/workflow-memory/business-routine-definitions/${routineDefinitionId}/new-version`,
    {
      method: "POST",
      body: { expectedRevision: publishedRoutine.body.routineDefinition.revision },
    },
  );
  assert.equal(nextRoutineVersion.status, 201);
  assert.equal(nextRoutineVersion.body.routineDefinition.version, 2);
  const listedRoutineDefinitions = await call(
    `/api/workflow-memory/business-routine-definitions?sourceId=${source.id}`,
  );
  assert.equal(listedRoutineDefinitions.status, 200);
  assert.equal(listedRoutineDefinitions.body.count, 2);
  assert.equal((await call(
    `/api/workflow-memory/business-routine-definitions?sourceId=${source.id}`,
    { token: "tok_b" },
  )).status, 404);
  const analyzedSource = await call(
    `/api/workflow-memory/sources/${source.id}/analyze-business-documents`,
    { method: "POST" },
  );
  assert.equal(analyzedSource.status, 200);
  assert.equal(analyzedSource.body.job.total, 4);
  assert.equal(analyzedSource.body.job.replayed, 1);
  const analysisJobs = await call(
    `/api/workflow-memory/business-document-analysis-jobs?sourceId=${source.id}`,
  );
  assert.equal(analysisJobs.status, 200);
  assert.equal(analysisJobs.body.jobs[0].status, "succeeded");
  const deliveryCase = await call("/api/workflow-memory/cases", {
    method: "POST",
    body: {
      sourceId: source.id,
      requirementArtifactIds: [requirement.id],
      deliveryArtifactIds: [delivery.id],
    },
  });
  assert.equal(deliveryCase.status, 201);
  assert.equal(deliveryCase.body.deliveryCase.qualityAssessment.status, "trusted");
  const profile = await call("/api/workflow-memory/profiles", {
    method: "POST",
    body: { name: "HTTP delivery", caseIds: [deliveryCase.body.deliveryCase.id] },
  });
  assert.equal(profile.status, 201);
  assert.equal(profile.body.profile.learningQuality.trustedCaseCount, 1);
  const similar = await call(
    `/api/workflow-memory/inbox/${newRequirement.id}/similar-cases`,
  );
  assert.equal(similar.status, 200);
  assert.equal(similar.body.cases[0].deliveryCase.id, deliveryCase.body.deliveryCase.id);
  assert.ok(similar.body.cases[0].reasons.length >= 1);
  assert.equal(similar.body.retrieval.version, 2);
  assert.equal(similar.body.retrieval.vector.used, false);
  assert.equal(
    similar.body.cases[0].score,
    similar.body.cases[0].scoreBreakdown.total,
  );
  const retrievalEvaluation = await call(
    `/api/workflow-memory/retrieval-evaluation?sourceId=${source.id}`,
  );
  assert.equal(retrievalEvaluation.status, 200);
  assert.equal(retrievalEvaluation.body.gate.status, "insufficient_samples");
  assert.equal(retrievalEvaluation.body.current.sampleCount, 0);

  const draft = await call(
    `/api/workflow-memory/profiles/${profile.body.profile.id}/drafts`,
    {
      method: "POST",
      body: { expectedRevision: profile.body.profile.revision },
    },
  );
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  assert.equal(draft.body.draft.state, "draft");
  const listedDrafts = await call("/api/workflow-memory/profile-drafts");
  assert.equal(listedDrafts.body.drafts.length, 1);
  const published = await call(
    `/api/workflow-memory/profile-drafts/${draft.body.draft.id}/publish`,
    {
      method: "POST",
      body: { expectedRevision: draft.body.draft.revision },
    },
  );
  assert.equal(published.status, 201, JSON.stringify(published.body));
  assert.equal(published.body.profile.profileVersion, 2);

  const planned = await call("/api/workflow-memory/runs", {
    method: "POST",
    body: {
      artifactId: newRequirement.id,
      profileId: published.body.profile.id,
    },
  });
  assert.equal(planned.status, 201, JSON.stringify(planned.body));
  const started = await call(`/api/workflow-memory/runs/${planned.body.run.id}/execute`, {
    method: "POST",
    body: {
      expectedRevision: planned.body.run.revision,
      agentId: "agt_demo_cli",
    },
  });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  assert.equal(started.body.run.executionAttempts.length, 1);
  const firstWorktreeId = started.body.run.executionAttempts[0].worktreeId;
  assert.ok(runtimeState.worktrees.some((worktree) => worktree.id === firstWorktreeId));

  const cancelled = await call(
    `/api/workflow-memory/runs/${planned.body.run.id}/cancel-execution`,
    {
      method: "POST",
      body: { expectedRevision: started.body.run.revision },
    },
  );
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.run.status, "execution_cancelled");
  const restarted = await call(`/api/workflow-memory/runs/${planned.body.run.id}/execute`, {
    method: "POST",
    body: {
      expectedRevision: cancelled.body.run.revision,
      agentId: "agt_demo_cli",
    },
  });
  assert.equal(restarted.status, 201, JSON.stringify(restarted.body));
  assert.equal(restarted.body.run.executionAttempts.length, 2);
  assert.notEqual(restarted.body.run.executionAttempts[1].worktreeId, firstWorktreeId);
  assert.ok(runtimeState.worktrees.some((worktree) =>
    worktree.id === restarted.body.run.executionAttempts[1].worktreeId));
  const cleaned = await call(
    `/api/workflow-memory/runs/${planned.body.run.id}/attempts/1/cleanup`,
    {
      method: "POST",
      body: { expectedRevision: restarted.body.run.revision },
    },
  );
  assert.equal(cleaned.status, 200, JSON.stringify(cleaned.body));
  assert.equal(cleaned.body.attempt.cleanup.state, "cleaned");
  assert.equal(runtimeState.worktrees.some((worktree) => worktree.id === firstWorktreeId), false);
  assert.ok(runtimeState.worktrees.some((worktree) =>
    worktree.id === restarted.body.run.executionAttempts[1].worktreeId));
  const latestAutoRun = runtimeState.autoRuns.find((item) =>
    item.id === restarted.body.run.executionAttempts[1].autoRunId);
  latestAutoRun.status = "done";
  const selected = await call(
    `/api/workflow-memory/runs/${planned.body.run.id}/attempts/2/select`,
    {
      method: "POST",
      body: { expectedRevision: cleaned.body.run.revision },
    },
  );
  assert.equal(selected.status, 200, JSON.stringify(selected.body));
  assert.equal(selected.body.run.selectedAttemptNumber, 2);
  const selectedWorktree = runtimeState.worktrees.find((worktree) =>
    worktree.id === selected.body.run.executionAttempts[1].worktreeId);
  const selectedOutput = selected.body.run.plannedOutputs[0];
  const selectedOutputPath = join(selectedWorktree.path, selectedOutput.relativePath);
  mkdirSync(join(selectedOutputPath, ".."), { recursive: true });
  writeFileSync(
    selectedOutputPath,
    "# 实施方案\n\n## 解决方案\n按阶段交付，并保留验收证据。",
  );
  const validated = await call(
    `/api/workflow-memory/runs/${planned.body.run.id}/validate`,
    {
      method: "POST",
      body: { expectedRevision: selected.body.run.revision },
    },
  );
  assert.equal(validated.status, 200, JSON.stringify(validated.body));
  assert.equal(validated.body.passed, true);
  assert.equal(validated.body.run.validationAttemptNumber, 2);
  assert.equal(validated.body.run.validationSummary.validatorVersion, 2);
  const workItem = runtimeState.workItems.find((item) => item.id === planned.body.run.workItemId);
  assert.equal(workItem.verificationRecords[0].status, "passed");
  assert.equal(workItem.verificationRecords[0].evidence[0].ref, selectedOutput.relativePath);
  const accepted = await call(
    `/api/workflow-memory/runs/${planned.body.run.id}/feedback`,
    {
      method: "POST",
      body: {
        expectedRevision: validated.body.run.revision,
        feedback: "accepted",
      },
    },
  );
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.run.status, "accepted");
  assert.equal(accepted.body.learning.status, "pending_publication");
  assert.equal(accepted.body.deliveryCase, null);
  assert.equal(existsSync(join(root, selectedOutput.relativePath)), false);
  writeFileSync(selectedOutputPath, "# 实施方案\n\n## 解决方案\n验收后又发生了变化。");
  const changedAfterFeedback = await call(
    `/api/workflow-memory/runs/${planned.body.run.id}/publication-preview`,
    {
      method: "POST",
      body: { expectedRevision: accepted.body.run.revision },
    },
  );
  assert.equal(changedAfterFeedback.status, 409);
  assert.equal(
    changedAfterFeedback.body.error,
    "workflow_publication_source_changed_after_feedback",
  );
  writeFileSync(
    selectedOutputPath,
    "# 实施方案\n\n## 解决方案\n按阶段交付，并保留验收证据。",
  );
  const publicationPreview = await call(
    `/api/workflow-memory/runs/${planned.body.run.id}/publication-preview`,
    {
      method: "POST",
      body: { expectedRevision: accepted.body.run.revision },
    },
  );
  assert.equal(publicationPreview.status, 201, JSON.stringify(publicationPreview.body));
  assert.equal(publicationPreview.body.publication.state, "previewed");
  assert.equal(publicationPreview.body.publication.conflictCount, 0);
  assert.equal(publicationPreview.body.publication.files[0].relativePath, selectedOutput.relativePath);
  const unconfirmedPublication = await call(
    `/api/workflow-memory/runs/${planned.body.run.id}/publish`,
    {
      method: "POST",
      body: {
        expectedRevision: publicationPreview.body.run.revision,
        publicationId: publicationPreview.body.publication.id,
        confirmed: false,
      },
    },
  );
  assert.equal(unconfirmedPublication.status, 400);
  assert.equal(
    unconfirmedPublication.body.error,
    "workflow_publication_confirmation_required",
  );
  const stringConfirmation = await call(
    `/api/workflow-memory/runs/${planned.body.run.id}/publish`,
    {
      method: "POST",
      body: {
        expectedRevision: publicationPreview.body.run.revision,
        publicationId: publicationPreview.body.publication.id,
        confirmed: "true",
      },
    },
  );
  assert.equal(stringConfirmation.status, 400);
  assert.equal(
    stringConfirmation.body.error,
    "workflow_publication_confirmation_required",
  );
  const blockedRun = runtimeState.workflowRuns.find((item) =>
    item.id === planned.body.run.id);
  blockedRun.publication.state = "blocked";
  blockedRun.publication.lastError = "workflow_publication_staging_conflict";
  const retriedPublicationPreview = await call(
    `/api/workflow-memory/runs/${planned.body.run.id}/publication-preview`,
    {
      method: "POST",
      body: { expectedRevision: publicationPreview.body.run.revision },
    },
  );
  assert.equal(retriedPublicationPreview.status, 201);
  assert.equal(retriedPublicationPreview.body.publication.state, "previewed");
  assert.notEqual(
    retriedPublicationPreview.body.publication.id,
    publicationPreview.body.publication.id,
  );
  const publishedOutputs = await call(
    `/api/workflow-memory/runs/${planned.body.run.id}/publish`,
    {
      method: "POST",
      body: {
        expectedRevision: retriedPublicationPreview.body.run.revision,
        publicationId: retriedPublicationPreview.body.publication.id,
        confirmed: true,
      },
    },
  );
  assert.equal(publishedOutputs.status, 200, JSON.stringify(publishedOutputs.body));
  assert.equal(publishedOutputs.body.publication.state, "published");
  assert.equal(publishedOutputs.body.run.feedback.learning.status, "incorporated");
  assert.ok(publishedOutputs.body.deliveryCase);
  assert.equal(
    readFileSync(join(root, selectedOutput.relativePath), "utf8"),
    "# 实施方案\n\n## 解决方案\n按阶段交付，并保留验收证据。",
  );
  const publicationReplay = await call(
    `/api/workflow-memory/runs/${planned.body.run.id}/publish`,
    {
      method: "POST",
      body: {
        expectedRevision: publishedOutputs.body.run.revision,
        publicationId: retriedPublicationPreview.body.publication.id,
        confirmed: true,
      },
    },
  );
  assert.equal(publicationReplay.status, 200);
  assert.equal(publicationReplay.body.replayed, true);

  const archivedCase = await call(
    `/api/workflow-memory/cases/${deliveryCase.body.deliveryCase.id}/archive`,
    {
      method: "POST",
      body: {
        expectedRevision: deliveryCase.body.deliveryCase.revision,
        reason: "HTTP correction test",
      },
    },
  );
  assert.equal(archivedCase.status, 200);
  assert.equal(archivedCase.body.deliveryCase.state, "archived");
  const restoredCase = await call(
    `/api/workflow-memory/cases/${deliveryCase.body.deliveryCase.id}/restore`,
    {
      method: "POST",
      body: { expectedRevision: archivedCase.body.deliveryCase.revision },
    },
  );
  assert.equal(restoredCase.status, 200);
  assert.equal(restoredCase.body.deliveryCase.state, "confirmed");

  const excluded = await call(
    `/api/workflow-memory/artifacts/${newRequirement.id}/exclude`,
    {
      method: "POST",
      body: {
        expectedRevision: runtimeState.workflowArtifacts.find((artifact) =>
          artifact.id === newRequirement.id).revision,
        reason: "Not a representative requirement",
      },
    },
  );
  assert.equal(excluded.status, 200);
  const excludedInbox = await call(`/api/workflow-memory/inbox?sourceId=${source.id}`);
  assert.equal(excludedInbox.body.artifacts.some((artifact) => artifact.id === newRequirement.id), false);
  const included = await call(
    `/api/workflow-memory/artifacts/${newRequirement.id}/include`,
    {
      method: "POST",
      body: { expectedRevision: excluded.body.artifact.revision },
    },
  );
  assert.equal(included.status, 200);
  assert.equal(included.body.artifact.confirmationState, "changed");

  const foreignList = await call("/api/workflow-memory/sources", { token: "tok_b" });
  assert.deepEqual(foreignList.body.sources, []);
  const foreignScan = await call(`/api/workflow-memory/sources/${source.id}/scan`, {
    token: "tok_b",
    method: "POST",
  });
  assert.equal(foreignScan.status, 404);

  const staleRevoke = await call(`/api/workflow-memory/sources/${source.id}/revoke`, {
    method: "POST",
    body: {
      expectedRevision: runtimeState.workflowSources.find((item) => item.id === source.id).revision - 1,
    },
  });
  assert.equal(staleRevoke.status, 409);

  const revoked = await call(`/api/workflow-memory/sources/${source.id}/revoke`, {
    method: "POST",
    body: {
      expectedRevision: runtimeState.workflowSources.find((item) => item.id === source.id).revision,
    },
  });
  assert.equal(revoked.status, 200);
  const deleted = await call(`/api/workflow-memory/sources/${source.id}/delete-learning-data`, {
    method: "POST",
    body: { expectedRevision: revoked.body.source.revision, confirmed: true },
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.originalFilesDeleted, false);
  assert.equal(existsSync(join(root, "history", "客户需求-100.md")), true);
});
