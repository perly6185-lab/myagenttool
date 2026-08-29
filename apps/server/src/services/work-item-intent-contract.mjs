import { createHash } from "node:crypto";
import { analyzeChannelOperationIntent } from "./channel-operation-intent.mjs";

export const WORK_ITEM_INTENT_CONTRACT_VERSION = 1;

function bounded(value, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function firstText(values, max = 500) {
  for (const value of values) {
    const text = bounded(value, max);
    if (text) return text;
  }
  return "";
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function fileExtension(value) {
  return bounded(value, 500).toLowerCase().match(/\.[a-z0-9]{1,10}\b/)?.[0] ?? null;
}

function materialFacts(item) {
  const localContent = Array.isArray(item?.localContentRefs) ? item.localContentRefs : [];
  const resources = Array.isArray(item?.taskResourceRefs) ? item.taskResourceRefs : [];
  const assets = Array.isArray(item?.inputAssets) ? item.inputAssets : [];
  return {
    inputCount: assets.length + localContent.length + resources.filter((reference) => reference.purpose !== "change_target").length,
    changeTargets: resources
      .filter((reference) => reference.purpose === "change_target")
      .map((reference) => ({
        id: bounded(reference.id ?? reference.resourceId, 200),
        title: bounded(reference.title ?? "工作资料", 300),
        canCommit: Array.isArray(reference.capabilities) && reference.capabilities.includes("commit_change"),
      }))
      .filter((reference) => reference.id),
  };
}

function addConflict(conflicts, conflict) {
  if (!conflicts.some((candidate) => candidate.code === conflict.code)) conflicts.push(conflict);
}

/**
 * One bounded, deterministic statement of what a task is allowed and expected
 * to accomplish. It reconciles the user request, selected method, materials and
 * delivery target before any implementation starts.
 */
export function buildWorkItemIntentContract(item) {
  const channel = item?.channelTaskContract ?? null;
  // Desktop-created tasks do not have a Channel contract, but their natural
  // language still carries the same action boundary. Leaving those tasks at
  // `unknown` made an explicit "只读取 / 不要修改" request enter a writable
  // direct invocation. Reuse the deterministic semantics for every intake.
  const inferredOperation = analyzeChannelOperationIntent(`${item?.title ?? ""}\n${item?.intentStatement ?? ""}\n${item?.body ?? ""}`);
  const suppliedOperation = channel?.operationIntent ?? null;
  const suppliedOperationIsSpecific = suppliedOperation
    && (suppliedOperation.accessMode && suppliedOperation.accessMode !== "unknown"
      || suppliedOperation.action && suppliedOperation.action !== "unknown");
  const operation = suppliedOperationIsSpecific ? {
    ...inferredOperation,
    ...suppliedOperation,
    forbiddenActions: [...new Set([
      ...(Array.isArray(suppliedOperation.forbiddenActions) ? suppliedOperation.forbiddenActions : []),
      ...(inferredOperation.forbiddenActions ?? []).filter((action) => ["commit", "pull_request", "push"].includes(action)),
    ])],
  } : inferredOperation;
  const template = item?.myTemplateBinding ?? null;
  const selectedChannelTemplate = channel?.templateMatch?.state === "matched"
    ? channel.templateMatch
    : null;
  const materials = materialFacts(item);
  const delivery = item?.taskContextControl?.deliveryDestination === "task"
    ? "task"
    : (item?.channelOrigin?.channelId || channel?.source === "channel") ? "channel" : "task";
  const expectedOutput = firstText([
    channel?.outputExpectation,
    template?.expectedOutput,
    channel?.workMode?.expectedOutput,
    (item?.artifactContract?.produces ?? []).join(", "),
  ], 500) || null;
  const method = template ? {
    kind: "template",
    definitionId: bounded(template.definitionId, 200),
    familyId: bounded(template.familyId, 200),
    version: Number(template.version) || null,
    name: bounded(template.name, 300) || null,
  } : {
    kind: "custom",
    definitionId: null,
    familyId: null,
    version: null,
    name: null,
  };
  const conflicts = [];

  if (operation?.accessMode === "read_only" && materials.changeTargets.length) {
    addConflict(conflicts, {
      code: "read_only_with_change_targets",
      severity: "blocking",
      subject: "materials",
      message: `任务要求只读，但 ${materials.changeTargets.length} 项资料被标记为允许修改。`,
      question: "这次只读取并分析，还是允许修改这些资料？",
      resolution: "task_context",
    });
  }
  if (operation?.accessMode === "read_only" && ["content_publish", "wechat_draft_sync"].includes(item?.taskKind)) {
    addConflict(conflicts, {
      code: "read_only_with_external_write",
      severity: "blocking",
      subject: "action",
      message: "任务要求只读，但当前任务类型会写入外部平台。",
      question: "这次只生成可审核结果，还是确认写入外部平台？",
      resolution: "task_definition",
    });
  }
  if (["content_publish", "wechat_draft_sync", "platform_adaptation"].includes(item?.taskKind)
    && !item?.platformTarget?.id) {
    addConflict(conflicts, {
      code: "platform_target_missing",
      severity: "blocking",
      subject: "delivery",
      message: "任务需要面向平台处理，但尚未指定目标平台。",
      question: "这次结果要用于哪个平台？",
      resolution: "task_definition",
    });
  }
  if (selectedChannelTemplate?.familyId && template?.familyId
    && (selectedChannelTemplate.familyId !== template.familyId
      || (selectedChannelTemplate.version && Number(selectedChannelTemplate.version) !== Number(template.version)))) {
    addConflict(conflicts, {
      code: "template_selection_changed",
      severity: "blocking",
      subject: "method",
      message: "Channel 中确认的处理模板与任务当前选择的模板不一致。",
      question: "这次按 Channel 中确认的模板，还是按任务当前模板处理？",
      resolution: "template",
    });
  }
  const requestedExtension = fileExtension(channel?.outputExpectation);
  const templateExtension = fileExtension(template?.expectedOutput);
  if (requestedExtension && templateExtension && requestedExtension !== templateExtension) {
    addConflict(conflicts, {
      code: "output_format_changed",
      severity: "blocking",
      subject: "result",
      message: `用户要求 ${requestedExtension}，但当前模板会生成 ${templateExtension}。`,
      question: `这次结果使用 ${requestedExtension} 还是 ${templateExtension}？`,
      resolution: "template",
    });
  }
  if (materials.changeTargets.some((target) => !target.canCommit)) {
    addConflict(conflicts, {
      code: "change_target_not_writable",
      severity: "blocking",
      subject: "materials",
      message: "至少一项修改目标当前不具备写回能力。",
      question: "改为只生成修改建议，还是换用可写回的资料？",
      resolution: "task_context",
    });
  }

  const missing = [];
  if (!(item?.acceptanceCriteria ?? []).length) missing.push("acceptance_criteria");
  if (!(item?.verificationSop ?? []).length) missing.push("verification_sop");
  const primaryConflict = conflicts.find((conflict) => conflict.severity === "blocking") ?? null;
  const canonical = {
    schemaVersion: WORK_ITEM_INTENT_CONTRACT_VERSION,
    workItemId: bounded(item?.id, 200) || null,
    goal: firstText([channel?.goal, item?.intentStatement, item?.title], 1_000),
    taskKind: bounded(item?.taskKind ?? "general", 80),
    action: {
      accessMode: bounded(operation?.accessMode ?? (materials.changeTargets.length ? "write" : "unknown"), 40),
      operation: bounded(operation?.action ?? "unknown", 80),
      forbiddenActions: Array.isArray(operation?.forbiddenActions)
        ? [...new Set(operation.forbiddenActions.map((action) => bounded(action, 40)).filter(Boolean))].slice(0, 20)
        : [],
    },
    expectedOutput,
    method,
    materials,
    delivery: {
      destination: delivery,
      platformId: bounded(item?.platformTarget?.id, 200) || null,
      platformLabel: bounded(item?.platformTarget?.label, 300) || null,
    },
    acceptanceCriteria: [...(item?.acceptanceCriteria ?? [])].map((value) => bounded(value, 2_000)).filter(Boolean),
    verificationSop: [...(item?.verificationSop ?? [])].map((value) => bounded(value, 2_000)).filter(Boolean),
    conflicts,
    missing,
    clarification: primaryConflict ? {
      code: primaryConflict.code,
      question: primaryConflict.question,
      resolution: primaryConflict.resolution,
    } : null,
    status: primaryConflict ? "needs_clarification" : missing.length ? "incomplete" : "ready",
  };
  return { ...canonical, digest: digest(canonical) };
}

export function freezeWorkItemIntentContract(item, { confirmedAt, confirmedBy } = {}) {
  const contract = buildWorkItemIntentContract(item);
  return {
    ...contract,
    confirmedAt: confirmedAt ?? null,
    confirmedBy: bounded(confirmedBy, 200) || null,
    readOnly: true,
  };
}
