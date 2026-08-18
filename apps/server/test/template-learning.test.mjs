import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createTemplateLearningService, prepareTemplateLearningOcr } from "../src/services/template-learning.mjs";

function setup() {
  const managedRoot = mkdtempSync(join(tmpdir(), "myagenttool-template-learning-"));
  const state = { projects: [], workflowSources: [], workItems: [], templateLearningTasks: [] };
  const events = [];
  let sequence = 0;
  const nextId = (prefix) => `${prefix}_${++sequence}`;
  const now = () => "2026-08-12T08:00:00.000Z";
  const actor = { teamId: "team_a", userId: "user_a" };
  const createWorkflowSource = (input) => {
    const source = {
      id: nextId("wfs"),
      ...input,
      state: "active",
      scanState: "idle",
      scanRevision: 0,
      revision: 1,
      fileCount: 0,
    };
    state.workflowSources.push(source);
    return { status: 201, body: { source } };
  };
  const createWorkItem = (input) => {
    const workItem = {
      id: nextId("lwi"), localRef: "LOCAL-1", revision: 1,
      ownerTeamId: actor.teamId, ...input,
    };
    state.workItems.push(workItem);
    return { ok: true, status: 201, body: { workItem } };
  };
  const updateWorkItem = ({ workItemId, expectedRevision, ...changes }) => {
    const item = state.workItems.find((row) => row.id === workItemId);
    assert.equal(item.revision, expectedRevision);
    Object.assign(item, changes, { revision: item.revision + 1 });
    return { ok: true, status: 200, body: { workItem: item } };
  };
  const scanWorkflowSource = async ({ sourceId }) => {
    const source = state.workflowSources.find((row) => row.id === sourceId);
    source.scanState = "ready";
    source.scanRevision += 1;
    source.fileCount = 2;
    return { status: 200, body: { source } };
  };
  const service = createTemplateLearningService({
    state, managedRoot, now, nextId,
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {},
    createWorkflowSource, scanWorkflowSource, createWorkItem, updateWorkItem,
  });
  return { actor, events, managedRoot, service, state };
}

test("template learning stages explicit input/output copies in a hidden managed project and tracks one task", async () => {
  const fixture = setup();
  try {
    const created = fixture.service.createTask({ name: "客户询价报价" }, fixture.actor);
    assert.equal(created.status, 201);
    assert.equal(fixture.state.projects.length, 1);
    assert.equal(fixture.state.projects[0].systemManaged, true);
    assert.equal(fixture.state.projects[0].hiddenFromNavigation, true);
    assert.equal(created.body.task.stage, "collecting_cases");
    assert.match(created.body.workItem.title, /创建模板/);

    const inputBytes = Buffer.from("customer inquiry RFQ-001");
    const outputBytes = Buffer.from("final quotation RFQ-001");
    const input = fixture.service.stageFile({
      taskId: created.body.task.id,
      caseId: "case-1",
      role: "input",
      filename: "询价单.md",
      contentType: "text/markdown",
      bytes: inputBytes,
    }, fixture.actor);
    const output = fixture.service.stageFile({
      taskId: created.body.task.id,
      caseId: "case-1",
      role: "output",
      filename: "报价单.md",
      contentType: "text/markdown",
      bytes: outputBytes,
    }, fixture.actor);
    assert.equal(input.status, 201);
    assert.equal(output.status, 201);
    assert.equal(Object.hasOwn(input.body.file, "storedPath"), false);
    assert.equal(fixture.state.workflowSources[0].selectedFileCount, 2);

    const projectRoot = fixture.state.projects[0].path;
    const inputCopy = join(projectRoot, "cases", "case-1", "raw", "inputs", "询价单.md");
    const outputCopy = join(projectRoot, "cases", "case-1", "raw", "outputs", "报价单.md");
    assert.equal(readFileSync(inputCopy, "utf8"), inputBytes.toString());
    assert.equal(readFileSync(outputCopy, "utf8"), outputBytes.toString());
    assert.equal(existsSync(join(projectRoot, "cases", "case-1", "source-manifest.json")), true);

    const started = await fixture.service.startTask({ taskId: created.body.task.id }, fixture.actor);
    assert.equal(started.status, 200);
    assert.equal(started.body.task.stage, "needs_case_review");
    assert.equal(fixture.state.workItems[0].status, "review");
    assert.equal(fixture.state.workItems[0].waitingOn, "me");

    const completed = fixture.service.completeTask({ sourceId: created.body.source.id }, fixture.actor);
    assert.equal(completed.status, 200);
    assert.equal(completed.body.task.stage, "completed");
    assert.equal(fixture.state.workItems[0].status, "done");
  } finally {
    rmSync(fixture.managedRoot, { recursive: true, force: true });
  }
});

test("template learning refuses to start until every case has both input and output", async () => {
  const fixture = setup();
  try {
    const created = fixture.service.createTask({ name: "周报整理" }, fixture.actor);
    fixture.service.stageFile({
      taskId: created.body.task.id,
      caseId: "case-1",
      role: "input",
      filename: "本周记录.md",
      bytes: Buffer.from("weekly notes"),
    }, fixture.actor);
    const started = await fixture.service.startTask({ taskId: created.body.task.id }, fixture.actor);
    assert.equal(started.status, 400);
    assert.equal(started.body.error, "template_learning_input_output_required");
  } finally {
    rmSync(fixture.managedRoot, { recursive: true, force: true });
  }
});

test("template learning accepts an empty display name and can start as a background task", async () => {
  const fixture = setup();
  try {
    const created = fixture.service.createTask({}, fixture.actor);
    assert.equal(created.status, 201);
    assert.equal(created.body.task.name, "");
    assert.equal(created.body.source.name, "正在识别的新模板");
    for (const role of ["input", "output"]) {
      fixture.service.stageFile({
        taskId: created.body.task.id,
        caseId: "case-1",
        role,
        filename: role === "input" ? "客户需求.md" : "最终结果.md",
        bytes: Buffer.from(role),
      }, fixture.actor);
    }
    const started = await fixture.service.startTask({ taskId: created.body.task.id, background: true }, fixture.actor);
    assert.equal(started.status, 202);
    assert.equal(started.body.accepted, true);
  } finally {
    rmSync(fixture.managedRoot, { recursive: true, force: true });
  }
});

test("template learning automatically OCRs only copied files that need text recognition", async () => {
  const calls = [];
  const actor = { teamId: "team_a", userId: "user_a" };
  const result = await prepareTemplateLearningOcr({
    artifacts: [
      { id: "image-1", revision: 3, extraction: { state: "needs_ocr" } },
      { id: "word-1", revision: 2, extraction: { state: "ready" } },
    ],
    actor,
    ocrWorkflowArtifact: async (input, receivedActor) => {
      calls.push([input, receivedActor]);
      return { status: 200, body: { artifact: { id: input.artifactId } } };
    },
  });

  assert.deepEqual(result, { processed: 1 });
  assert.deepEqual(calls, [[{
    artifactId: "image-1",
    expectedRevision: 3,
    confirmed: true,
    allowCloudOcr: false,
  }, actor]]);
});

test("template learning passes explicit Codex OCR consent to copied artifacts", async () => {
  const calls = [];
  await prepareTemplateLearningOcr({
    artifacts: [{ id: "scan-1", revision: 2, extraction: { state: "needs_ocr" } }],
    allowCloudOcr: true,
    ocrWorkflowArtifact: async (input) => {
      calls.push(input);
      return { status: 200, body: { artifact: { id: input.artifactId } } };
    },
  });
  assert.equal(calls[0].allowCloudOcr, true);
});

test("template learning reports a clear requirement when local OCR is unavailable", async () => {
  await assert.rejects(
    () => prepareTemplateLearningOcr({
      artifacts: [{ id: "scan-1", revision: 1, extraction: { state: "needs_ocr" } }],
      ocrWorkflowArtifact: async () => ({
        status: 409,
        body: { error: "workflow_ocr_platform_unsupported" },
      }),
    }),
    (error) => error?.body?.error === "template_learning_ocr_required",
  );
});
