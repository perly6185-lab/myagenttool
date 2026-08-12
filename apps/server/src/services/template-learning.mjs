import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

import { LOCAL_TEAM_ID, LOCAL_USER_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { createProjectRecord } from "./projects.mjs";

const MAX_FILE_BYTES = 24 * 1024 * 1024;
const MAX_TASK_BYTES = 256 * 1024 * 1024;
const MAX_CASES = 20;
const MAX_FILES_PER_CASE = 40;
const ROLES = new Set(["input", "output", "reference"]);
const SUPPORTED_EXTENSIONS = new Set([
  ".csv", ".docx", ".jpeg", ".jpg", ".json", ".md", ".pdf", ".png",
  ".pptx", ".txt", ".webp", ".xlsx",
]);

const actorTeam = (actor) => actor?.teamId ?? LOCAL_TEAM_ID;
const actorUser = (actor) => actor?.userId ?? LOCAL_USER_ID;

function safeSegment(value, fallback) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function safeFilename(value) {
  const original = basename(String(value ?? "")).normalize("NFKC");
  const extension = extname(original).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw Object.assign(new Error("This file type is not supported for template learning."), {
      code: "template_learning_file_type_unsupported",
      status: 400,
    });
  }
  const stem = basename(original, extension)
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 120) || "file";
  return `${stem}${extension}`;
}

function taskView(task) {
  return {
    id: task.id,
    templateId: task.templateId,
    sourceId: task.sourceId,
    workItemId: task.workItemId,
    name: task.name,
    nameSuggested: Boolean(task.nameSuggested),
    stage: task.stage,
    progress: task.progress,
    lastError: task.lastError ?? null,
    allowCloudOcr: Boolean(task.allowCloudOcr),
    cases: task.cases.map((item) => ({
      id: item.id,
      files: item.files.map(({ storedPath: _storedPath, ...file }) => file),
    })),
    fileCount: task.cases.reduce((sum, item) => sum + item.files.length, 0),
    totalBytes: task.totalBytes,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt ?? null,
  };
}

function roleDirectory(role) {
  return role === "input" ? "inputs" : role === "output" ? "outputs" : "references";
}

function uniqueTarget(directory, filename) {
  const extension = extname(filename);
  const stem = basename(filename, extension);
  let candidate = filename;
  let suffix = 2;
  while (existsSync(join(directory, candidate))) {
    candidate = `${stem}-${suffix}${extension}`;
    suffix += 1;
  }
  return join(directory, candidate);
}

export async function prepareTemplateLearningOcr({
  artifacts = [],
  ocrWorkflowArtifact,
  actor = null,
  onProgress = () => {},
  allowCloudOcr = false,
} = {}) {
  const ocrArtifacts = artifacts.filter((artifact) => artifact.extraction?.state === "needs_ocr");
  if (!ocrArtifacts.length) return { processed: 0 };
  if (typeof ocrWorkflowArtifact !== "function") {
    throw { status: 409, body: { error: "template_learning_ocr_required" } };
  }
  onProgress({ completedArtifacts: 0, totalArtifacts: ocrArtifacts.length });
  for (const [index, artifact] of ocrArtifacts.entries()) {
    const ocr = await ocrWorkflowArtifact({
      artifactId: artifact.id,
      expectedRevision: artifact.revision,
      confirmed: true,
      allowCloudOcr: allowCloudOcr === true,
    }, actor);
    if (ocr.status >= 400) {
      if (ocr.body?.error === "workflow_ocr_cloud_confirmation_required") {
        throw {
          status: 409,
          body: { error: "template_learning_cloud_ocr_confirmation_required" },
        };
      }
      const unavailable = [
        "workflow_ocr_platform_unsupported",
        "workflow_ocr_provider_unavailable",
        "workflow_ocr_disabled",
        "workflow_codex_ocr_unavailable",
        "workflow_codex_ocr_not_authenticated",
      ].includes(ocr.body?.error);
      throw {
        status: ocr.status,
        body: { error: unavailable ? "template_learning_ocr_required" : "template_learning_ocr_failed" },
      };
    }
    onProgress({ completedArtifacts: index + 1, totalArtifacts: ocrArtifacts.length });
  }
  return { processed: ocrArtifacts.length };
}

export function createTemplateLearningService({
  state,
  stateStorePath,
  now,
  nextId,
  appendEvent,
  persistStateSoon,
  createWorkflowSource,
  scanWorkflowSource,
  ocrWorkflowArtifact,
  analyzeBusinessDocuments,
  confirmBusinessDocumentClassification,
  discoverBusinessCases,
  reviewBusinessCaseCandidate,
  discoverBusinessRoutine,
  createRoutineDraft,
  createWorkItem,
  updateWorkItem,
  managedRoot,
  store,
} = {}) {
  state.templateLearningTasks ??= [];
  const runTx = makeRunTx({ store, persistStateSoon });
  const persistedDirectory = stateStorePath ? dirname(stateStorePath) : null;
  const applicationDataRoot = persistedDirectory && basename(persistedDirectory).toLowerCase() === "state"
    ? dirname(persistedDirectory)
    : persistedDirectory;
  const root = resolve(managedRoot
    ?? (applicationDataRoot ? join(applicationDataRoot, "template-projects") : join(process.cwd(), ".myagenttool", "template-projects")));
  const runningTaskIds = new Set();

  function ownTask(id, actor) {
    return state.templateLearningTasks.find((item) =>
      item.id === String(id) && item.ownerTeamId === actorTeam(actor)) ?? null;
  }

  function updateTrackingWorkItem(task, actor, changes) {
    const item = (state.workItems ?? []).find((row) => row.id === task.workItemId);
    if (!item) return null;
    const result = updateWorkItem({ workItemId: item.id, expectedRevision: item.revision, ...changes }, actor);
    return result.ok ? result.body.workItem : null;
  }

  function trackingBody(task, message) {
    const caseCount = task.cases.length;
    const fileCount = task.cases.reduce((sum, item) => sum + item.files.length, 0);
    return [
      message,
      `学习进度：${task.progress}%`,
      `已安全复制：${caseCount} 组案例、${fileCount} 个文件。原始文件不会被修改。`,
    ].join("\n");
  }

  function updateLearningProgress(task, actor, progress, message, waitingOn = "ai") {
    return runTx(() => {
      task.progress = progress;
      task.updatedAt = now();
      task.revision += 1;
      return updateTrackingWorkItem(task, actor, {
        status: "in_progress",
        waitingOn,
        body: trackingBody(task, message),
      });
    });
  }

  const STEP_LABELS_ZH = Object.freeze({
    inquiry_registration: "登记收到的需求",
    reference_retrieval: "查找报价所需参考资料",
    quotation_generation: "准备报价单",
    quotation_approval: "确认报价内容",
    quotation_registration: "登记最终报价",
    order_signal: "识别客户确认或订单信号",
    order_handoff: "交接订单处理",
    order_registration: "登记订单",
  });

  const DOCUMENT_TYPE_LABELS = Object.freeze({
    inquiry: "客户询价",
    quotation: "报价单",
    order: "订单",
    contract_review: "合同审查",
    purchase_request: "采购申请",
    customer_complaint: "客户投诉处理",
    weekly_report: "周报整理",
    project_acceptance: "项目验收",
  });

  function readableFileStem(name) {
    return basename(String(name ?? ""), extname(String(name ?? "")))
      .replace(/(?:最终|终稿|定稿|完成|最新版|final|v\d+)[-_ ]*/giu, "")
      .replace(/(?:rfq|no)?[-_ ]?\d{3,}|20\d{2}[-_.]\d{1,2}(?:[-_.]\d{1,2})?/giu, "")
      .replace(/[-_ ]+/g, " ")
      .trim()
      .slice(0, 40);
  }

  function suggestTemplateName(task, classifications, roleByArtifactId) {
    const typeForRole = (role) => classifications.find((row) => roleByArtifactId.get(row.artifactId) === role)?.documentType;
    const inputType = typeForRole("input");
    const outputType = typeForRole("output");
    if (inputType === "inquiry" && outputType === "quotation") return "客户询价报价";
    if (DOCUMENT_TYPE_LABELS[outputType]) return DOCUMENT_TYPE_LABELS[outputType];
    const outputFile = task.cases.flatMap((item) => item.files).find((file) => file.role === "output");
    const inputFile = task.cases.flatMap((item) => item.files).find((file) => file.role === "input");
    return readableFileStem(outputFile?.name) || readableFileStem(inputFile?.name) || "我的工作模板";
  }

  function applySuggestedName(task, actor, name) {
    if (task.name) return;
    task.name = String(name || "我的工作模板").trim().slice(0, 120);
    task.nameSuggested = true;
    const source = (state.workflowSources ?? []).find((item) => item.id === task.sourceId);
    if (source) source.name = task.name;
    updateTrackingWorkItem(task, actor, { title: `创建模板：${task.name}` });
  }

  async function prepareReview(task, actor, scanResult) {
    const canPrepare = [
      analyzeBusinessDocuments,
      confirmBusinessDocumentClassification,
      discoverBusinessCases,
      reviewBusinessCaseCandidate,
      discoverBusinessRoutine,
      createRoutineDraft,
    ].every((action) => typeof action === "function");
    if (!canPrepare) return { source: scanResult.body.source, autoPrepared: false };

    const roleByPath = new Map(task.cases.flatMap((learningCase) =>
      learningCase.files.map((file) => [file.relativePath, file.role])));
    const artifacts = (state.workflowArtifacts ?? []).filter((artifact) =>
      artifact.sourceId === task.sourceId && roleByPath.has(artifact.relativePath));
    await prepareTemplateLearningOcr({
      artifacts,
      ocrWorkflowArtifact,
      actor,
      allowCloudOcr: task.allowCloudOcr === true,
      onProgress: ({ completedArtifacts = 0, totalArtifacts = 1 } = {}) => {
        const progress = 48 + Math.floor((completedArtifacts / Math.max(1, totalArtifacts)) * 6);
        updateLearningProgress(
          task,
          actor,
          progress,
          `正在识别扫描 PDF 或图片中的文字（${completedArtifacts}/${totalArtifacts} 个文件），原文件和安全副本都不会被修改。`,
        );
      },
    });

    updateLearningProgress(task, actor, 55, "正在理解每组历史输入和最终输出。待系统整理完成后，只需检查总结结果。");
    const analysis = await analyzeBusinessDocuments({ sourceId: task.sourceId }, actor);
    if (analysis.status >= 400) throw analysis;

    const roleByArtifactId = new Map(artifacts.map((artifact) =>
      [artifact.id, roleByPath.get(artifact.relativePath)]));
    const relevantClassifications = (state.businessDocumentClassifications ?? []).filter((row) =>
      row.sourceId === task.sourceId && roleByArtifactId.has(row.artifactId));
    applySuggestedName(task, actor, suggestTemplateName(task, relevantClassifications, roleByArtifactId));
    for (const classification of (state.businessDocumentClassifications ?? []).filter((row) =>
      row.sourceId === task.sourceId
      && row.ownerTeamId === task.ownerTeamId
      && row.confirmationState === "proposed"
      && roleByArtifactId.has(row.artifactId))) {
      // The user-declared role is authoritative. A generic classifier may enrich
      // the file's meaning, but an unknown input/output must never be rewritten
      // into the old inquiry/quotation demo domain.
      const documentType = classification.documentType === "unknown"
        ? "other_reference"
        : classification.documentType;
      const confirmed = confirmBusinessDocumentClassification({
        classificationId: classification.id,
        expectedRevision: classification.revision,
        documentType,
      }, actor);
      if (confirmed.status >= 400) throw confirmed;
    }

    updateLearningProgress(task, actor, 70, "正在按你选择的输入和输出关系整理历史案例。无需再次逐个配对。");
    const discoveredCases = discoverBusinessCases({ sourceId: task.sourceId }, actor);
    if (discoveredCases.status >= 400 || discoveredCases.body.count < 1) {
      throw discoveredCases.status >= 400
        ? discoveredCases
        : { status: 409, body: { error: "no_business_cases_found" } };
    }
    for (const candidate of discoveredCases.body.candidates.filter((row) => row.state === "proposed")) {
      const reviewed = reviewBusinessCaseCandidate({
        candidateId: candidate.id,
        expectedRevision: candidate.revision,
        action: "confirm",
      }, actor);
      if (reviewed.status >= 400) throw reviewed;
    }

    updateLearningProgress(task, actor, 82, "正在总结常用步骤，并准备一份可直接检查的模板预览。");
    const routine = discoverBusinessRoutine({ sourceId: task.sourceId }, actor);
    if (routine.status >= 400) throw routine;
    const draft = createRoutineDraft({ discoveryCandidateId: routine.body.candidate.id }, actor);
    if (draft.status >= 400) throw draft;
    const definition = draft.body.routineDefinition;
    runTx(() => {
      definition.name = task.name;
      definition.description = routine.body.candidate.description
        ?? `根据 ${task.cases.length} 组历史输入和最终输出整理的处理方法。`;
      definition.templateContract = routine.body.candidate.templateContract ?? definition.templateContract ?? null;
      definition.templateMaturity = "stable";
      definition.templateLearningTaskId = task.id;
      for (const step of definition.steps ?? []) {
        step.label = STEP_LABELS_ZH[step.key] ?? step.label;
      }
      definition.revision += 1;
      definition.updatedAt = now();
    });
    return { source: scanResult.body.source, autoPrepared: true, definition };
  }

  function createTask({ name, allowCloudOcr = false } = {}, actor = null) {
    const templateName = String(name ?? "").trim();
    if (templateName.length > 120) {
      return { status: 400, body: { error: "invalid_template_learning_name" } };
    }
    const initialDisplayName = templateName || "正在识别的新模板";
    const timestamp = now();
    const templateId = nextId("tpl");
    const taskId = nextId("tlt");
    const teamDirectory = safeSegment(actorTeam(actor), "local");
    const templateRoot = join(root, teamDirectory, templateId);
    mkdirSync(join(templateRoot, "cases"), { recursive: true });
    mkdirSync(join(templateRoot, "runs"), { recursive: true });
    mkdirSync(join(templateRoot, "versions"), { recursive: true });

    const project = createProjectRecord({
      name: `Template workspace ${templateId}`,
      path: templateRoot,
      source: "system",
      ownerTeamId: actorTeam(actor),
      isolation: "shared",
      autoExecutionEnabled: false,
    }, { nextId, now });
    Object.assign(project, { systemManaged: true, purpose: "template_learning", hiddenFromNavigation: true });
    runTx(() => state.projects.unshift(project));

    const createdSource = createWorkflowSource({
      projectId: project.id,
      relativePath: "",
      readMode: "supported_text",
      name: initialDisplayName,
    }, actor);
    if (createdSource.status >= 400) {
      runTx(() => {
        state.projects = state.projects.filter((item) => item.id !== project.id);
      });
      rmSync(templateRoot, { recursive: true, force: true });
      return createdSource;
    }
    const source = createdSource.body.source;
    runTx(() => {
      Object.assign(source, {
        purpose: "template_learning",
        templateId,
        templateLearningTaskId: taskId,
        selectedFileCount: 0,
      });
    });

    const createdWorkItem = createWorkItem({
      projectId: project.id,
      title: `创建模板：${initialDisplayName}`,
      body: "收集历史输入和对应输出，安全复制后识别工作规律，并在确认后启用模板。",
      type: "task",
      status: "in_progress",
      priority: "p2",
      executionPolicy: "manual",
      labels: ["template-learning", "我的模板"],
      waitingOn: "me",
      idempotencyKey: `template-learning:${taskId}`,
    }, actor);
    if (!createdWorkItem.ok) {
      runTx(() => {
        state.workflowSources = state.workflowSources.filter((item) => item.id !== source.id);
        state.projects = state.projects.filter((item) => item.id !== project.id);
      });
      rmSync(templateRoot, { recursive: true, force: true });
      return { status: createdWorkItem.status, body: createdWorkItem.body };
    }

    const task = {
      id: taskId,
      templateId,
      ownerTeamId: actorTeam(actor),
      createdBy: actorUser(actor),
      projectId: project.id,
      sourceId: source.id,
      workItemId: createdWorkItem.body.workItem.id,
      name: templateName,
      allowCloudOcr: allowCloudOcr === true,
      managedRoot: templateRoot,
      stage: "collecting_cases",
      progress: 10,
      cases: [],
      totalBytes: 0,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    return runTx(() => {
      state.templateLearningTasks.unshift(task);
      writeFileSync(join(templateRoot, "manifest.json"), JSON.stringify({
        schemaVersion: 1,
        templateId,
        taskId,
        sourceId: source.id,
        name: templateName || null,
        allowCloudOcr: allowCloudOcr === true,
        createdAt: timestamp,
      }, null, 2), { flag: "wx", mode: 0o600 });
      appendEvent({
        invocationId: null,
        type: "template_learning_created",
        level: "info",
        message: "Template learning task created.",
        data: { taskId, templateId, sourceId: source.id, workItemId: task.workItemId },
      });
      return { status: 201, body: { task: taskView(task), source, workItem: createdWorkItem.body.workItem } };
    });
  }

  function listTasks(_input = {}, actor = null) {
    return {
      status: 200,
      body: { tasks: state.templateLearningTasks.filter((item) => item.ownerTeamId === actorTeam(actor)).map(taskView) },
    };
  }

  function stageFile({ taskId, caseId, role, filename, contentType, bytes } = {}, actor = null) {
    const task = ownTask(taskId, actor);
    if (!task) return { status: 404, body: { error: "template_learning_task_not_found" } };
    if (task.stage !== "collecting_cases") {
      return { status: 409, body: { error: "template_learning_not_collecting_cases" } };
    }
    if (!ROLES.has(role)) return { status: 400, body: { error: "invalid_template_learning_file_role" } };
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_FILE_BYTES) {
      return { status: 400, body: { error: "template_learning_file_size_invalid", maxBytes: MAX_FILE_BYTES } };
    }
    if (task.totalBytes + bytes.length > MAX_TASK_BYTES) {
      return { status: 409, body: { error: "template_learning_total_size_exceeded", maxBytes: MAX_TASK_BYTES } };
    }
    const normalizedCaseId = safeSegment(caseId, "case");
    let learningCase = task.cases.find((item) => item.id === normalizedCaseId);
    const isNewCase = !learningCase;
    if (!learningCase) {
      if (task.cases.length >= MAX_CASES) return { status: 409, body: { error: "template_learning_case_limit_exceeded" } };
      learningCase = { id: normalizedCaseId, files: [], createdAt: now() };
    }
    if (learningCase.files.length >= MAX_FILES_PER_CASE) {
      return { status: 409, body: { error: "template_learning_case_file_limit_exceeded" } };
    }

    let safeName;
    try {
      safeName = safeFilename(filename);
    } catch (error) {
      return { status: error.status ?? 400, body: { error: error.code ?? "template_learning_file_invalid" } };
    }
    const directory = join(task.managedRoot, "cases", normalizedCaseId, "raw", roleDirectory(role));
    mkdirSync(directory, { recursive: true });
    const target = uniqueTarget(directory, safeName);
    const temporary = `${target}.${nextId("upload")}.part`;
    try {
      writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
      renameSync(temporary, target);
    } catch (error) {
      rmSync(temporary, { force: true });
      return { status: 500, body: { error: "template_learning_file_copy_failed" } };
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    const storedName = basename(target);
    const file = {
      id: nextId("tlf"),
      role,
      name: storedName,
      extension: extname(storedName).slice(1).toLowerCase(),
      contentType: String(contentType ?? "application/octet-stream").slice(0, 200),
      size: bytes.length,
      hash,
      storedPath: target,
      relativePath: `cases/${normalizedCaseId}/raw/${roleDirectory(role)}/${storedName}`,
      copiedAt: now(),
    };
    return runTx(() => {
      if (isNewCase) task.cases.push(learningCase);
      learningCase.files.push(file);
      task.totalBytes += bytes.length;
      const source = (state.workflowSources ?? []).find((item) => item.id === task.sourceId);
      if (source) source.selectedFileCount = task.cases.reduce((sum, item) => sum + item.files.length, 0);
      task.progress = Math.min(25, 10 + task.cases.length * 3);
      task.revision += 1;
      task.updatedAt = now();
      writeFileSync(join(task.managedRoot, "cases", normalizedCaseId, "source-manifest.json"), JSON.stringify({
        schemaVersion: 1,
        caseId: normalizedCaseId,
        files: learningCase.files.map(({ storedPath: _storedPath, ...entry }) => entry),
      }, null, 2), { mode: 0o600 });
      const { storedPath: _storedPath, ...publicFile } = file;
      return { status: 201, body: { task: taskView(task), file: publicFile } };
    });
  }

  async function processTask(task, actor) {
    const result = await scanWorkflowSource({ sourceId: task.sourceId }, actor);
    if (result.status >= 400) {
      return runTx(() => {
        task.stage = "failed";
        task.lastError = result.body?.error ?? "template_learning_scan_failed";
        task.updatedAt = now();
        task.revision += 1;
        updateTrackingWorkItem(task, actor, {
          status: "blocked",
          waitingOn: "internal",
          body: trackingBody(task, "识别过程未能完成，可回到“我的模板”重试。"),
        });
        return result;
      });
    }
    let prepared;
    try {
      prepared = await prepareReview(task, actor, result);
    } catch (failure) {
      const recoverableReviewErrors = new Set([
        "no_business_documents",
        "no_business_cases",
        "insufficient_confirmed_business_cases",
      ]);
      if (recoverableReviewErrors.has(failure?.body?.error)) {
        prepared = { source: result.body.source, autoPrepared: false };
      } else {
        return runTx(() => {
          task.stage = "failed";
          task.lastError = failure?.body?.error ?? "template_learning_preparation_failed";
          task.updatedAt = now();
          task.revision += 1;
          updateTrackingWorkItem(task, actor, {
            status: "blocked",
            waitingOn: "internal",
            body: trackingBody(task, "系统未能自动整理完成。已复制的文件仍然安全保留，可以稍后继续或打开调整。"),
          });
          return failure?.status
            ? failure
            : { status: 500, body: { error: task.lastError } };
        });
      }
    }
    return runTx(() => {
      task.stage = "needs_case_review";
      task.progress = prepared.autoPrepared ? 90 : 50;
      task.lastError = null;
      task.updatedAt = now();
      task.revision += 1;
      const workItem = updateTrackingWorkItem(task, actor, {
        status: "review",
        waitingOn: "me",
        body: trackingBody(task, prepared.autoPrepared
          ? "模板预览已经准备好，请检查“收到什么、最后得到什么和处理步骤”，确认后即可启用。"
          : "历史案例已经识别，请确认文件用途、案例关系和处理步骤。"),
      });
      appendEvent({
        invocationId: null,
        type: "template_learning_ready_for_review",
        level: "info",
        message: "Template learning files are ready for review.",
        data: { taskId: task.id, sourceId: task.sourceId, workItemId: task.workItemId },
      });
      return { status: 200, body: { task: taskView(task), source: prepared.source, workItem, autoPrepared: prepared.autoPrepared } };
    });
  }

  function scheduleTask(task, actor) {
    if (runningTaskIds.has(task.id)) return;
    runningTaskIds.add(task.id);
    Promise.resolve()
      .then(() => processTask(task, actor))
      .catch(() => {
        runTx(() => {
          task.stage = "failed";
          task.lastError = "template_learning_background_failed";
          task.updatedAt = now();
          task.revision += 1;
        });
      })
      .finally(() => runningTaskIds.delete(task.id));
  }

  async function startTask({ taskId, background = false, allowCloudOcr = false } = {}, actor = null) {
    const task = ownTask(taskId, actor);
    if (!task) return { status: 404, body: { error: "template_learning_task_not_found" } };
    if (task.stage !== "collecting_cases" && task.stage !== "failed") {
      return { status: 409, body: { error: "template_learning_task_already_started" } };
    }
    const invalidCase = task.cases.find((item) =>
      !item.files.some((file) => file.role === "input") || !item.files.some((file) => file.role === "output"));
    if (!task.cases.length || invalidCase) {
      return {
        status: 400,
        body: { error: "template_learning_input_output_required", caseId: invalidCase?.id ?? null },
      };
    }
    runTx(() => {
      if (allowCloudOcr === true && task.allowCloudOcr !== true) {
        task.allowCloudOcr = true;
        task.revision += 1;
        task.updatedAt = now();
      }
      task.lastError = null;
      task.stage = "analyzing";
      updateLearningProgress(task, actor, 35, "AI 正在识别历史输入、最终输出和处理规律。");
    });
    if (background) {
      scheduleTask(task, actor);
      return { status: 202, body: { task: taskView(task), accepted: true } };
    }
    return processTask(task, actor);
  }

  function completeTask({ sourceId } = {}, actor = null) {
    const task = state.templateLearningTasks.find((item) =>
      item.sourceId === String(sourceId) && item.ownerTeamId === actorTeam(actor));
    if (!task) return { status: 404, body: { error: "template_learning_task_not_found" } };
    return runTx(() => {
      task.stage = "completed";
      task.progress = 100;
      task.completedAt = now();
      task.updatedAt = task.completedAt;
      task.revision += 1;
      const source = (state.workflowSources ?? []).find((item) => item.id === task.sourceId);
      if (source) source.selectedFileCount = task.cases.reduce((sum, item) => sum + item.files.length, 0);
      for (const definition of (state.routineDefinitions ?? []).filter((item) =>
        item.sourceId === task.sourceId && item.ownerTeamId === task.ownerTeamId && item.state === "published")) {
        definition.templateScope = "team";
        definition.templateMaturity = "stable";
        definition.templateLearningTaskId = task.id;
        definition.revision += 1;
        definition.updatedAt = now();
      }
      const workItem = updateTrackingWorkItem(task, actor, {
        status: "done",
        waitingOn: "none",
        body: trackingBody(task, "模板已经确认启用，今后创建相似任务时会自动建议使用。"),
      });
      return { status: 200, body: { task: taskView(task), workItem } };
    });
  }

  for (const task of state.templateLearningTasks.filter((item) => item.stage === "analyzing")) {
    scheduleTask(task, { teamId: task.ownerTeamId, userId: task.createdBy });
  }

  return { completeTask, createTask, listTasks, stageFile, startTask };
}
