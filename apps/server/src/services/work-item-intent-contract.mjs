import { createHash } from "node:crypto";
import { workItemIntentContractSchemaVersion } from "@myagenttool/protocol/work-item-intent-contract";
import { analyzeChannelOperationIntent, normalizeChannelOperationIntent } from "./channel-operation-intent.mjs";

export const WORK_ITEM_INTENT_CONTRACT_VERSION = workItemIntentContractSchemaVersion;

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

export function workItemIntentResolutionScopeDigest(item, conflictCode) {
  if (conflictCode === "write_request_exceeds_confirmed_boundary") {
    return digest({
      conflictCode,
      title: bounded(item?.title, 1_000),
      intentStatement: bounded(item?.intentStatement, 2_000),
      body: bounded(item?.body, 4_000),
      taskKind: bounded(item?.taskKind, 80),
      operationIntent: item?.channelTaskContract?.operationIntent ?? null,
    });
  }
  return digest({ conflictCode, workItemId: bounded(item?.id, 200), revision: Number(item?.revision) || 0 });
}

function appliedIntentResolution(item, conflictCode) {
  const scopeDigest = workItemIntentResolutionScopeDigest(item, conflictCode);
  return [...(Array.isArray(item?.intentClarificationResolutions) ? item.intentClarificationResolutions : [])]
    .reverse()
    .find((resolution) => resolution?.code === conflictCode && resolution?.scopeDigest === scopeDigest) ?? null;
}

function fileExtension(value) {
  return bounded(value, 500).toLowerCase().match(/\.[a-z0-9]{1,10}\b/)?.[0] ?? null;
}

function materialVersion(value) {
  if (value == null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : bounded(value, 200) || null;
}

function materialFacts(item) {
  const localContent = Array.isArray(item?.localContentRefs) ? item.localContentRefs : [];
  const resources = Array.isArray(item?.taskResourceRefs) ? item.taskResourceRefs : [];
  const assets = Array.isArray(item?.inputAssets) ? item.inputAssets : [];
  const recordBindings = Array.isArray(item?.recordBindings) ? item.recordBindings : [];
  const inputs = [
    ...assets.map((asset, index) => ({
      id: bounded(asset?.id ?? asset?.contentId ?? `input_asset_${index + 1}`, 200),
      title: bounded(asset?.originalName ?? asset?.name ?? String(asset?.path ?? "").replaceAll("\\", "/").split("/").at(-1) ?? "任务文件", 300),
      purpose: "required_input",
      locality: "local",
      version: materialVersion(asset?.version),
      fingerprint: bounded(asset?.hash, 200) || null,
    })),
    ...localContent.map((reference, index) => ({
      id: bounded(reference?.id ?? reference?.contentId ?? `local_content_${index + 1}`, 200),
      title: bounded(reference?.title ?? "我的资料", 300),
      purpose: reference?.purpose === "required_input" ? "required_input" : "reference",
      locality: "local",
      version: materialVersion(reference?.selectedVersion ?? reference?.version),
      fingerprint: bounded(reference?.selectedFingerprint ?? reference?.fingerprint, 200) || null,
    })),
    ...resources.filter((reference) => reference?.purpose !== "change_target").map((reference, index) => ({
      id: bounded(reference?.id ?? reference?.resourceId ?? `task_resource_${index + 1}`, 200),
      title: bounded(reference?.title ?? "工作资料", 300),
      purpose: reference?.purpose === "query_source" ? "query_source" : "reference",
      locality: reference?.locality === "remote" ? "remote" : "local",
      version: materialVersion(reference?.selectedVersion ?? reference?.version),
      fingerprint: bounded(reference?.selectedFingerprint ?? reference?.fingerprint, 200) || null,
    })),
    ...recordBindings.filter((binding) => binding?.direction !== "output").map((binding, index) => ({
      id: bounded(binding?.id ?? binding?.record?.recordId ?? `record_binding_${index + 1}`, 200),
      title: bounded(binding?.record?.title ?? "业务记录", 300),
      purpose: binding?.role === "required" ? "required_input" : "reference",
      locality: "managed",
      version: materialVersion(binding?.snapshot?.revision ?? binding?.record?.revision),
      fingerprint: bounded(binding?.snapshot?.fingerprint ?? binding?.record?.fingerprint, 200) || null,
    })),
  ].filter((reference) => reference.id && reference.title)
    .sort((left, right) => `${left.purpose}:${left.id}`.localeCompare(`${right.purpose}:${right.id}`));
  const changeTargets = resources
    .filter((reference) => reference.purpose === "change_target")
    .map((reference, index) => ({
      id: bounded(reference.id ?? reference.resourceId ?? `change_target_${index + 1}`, 200),
      title: bounded(reference.title ?? "工作资料", 300),
      purpose: "change_target",
      locality: reference?.locality === "remote" ? "remote" : "local",
      version: materialVersion(reference?.selectedVersion ?? reference?.version),
      fingerprint: bounded(reference?.selectedFingerprint ?? reference?.fingerprint, 200) || null,
      canCommit: Array.isArray(reference.capabilities) && reference.capabilities.includes("commit_change"),
    }))
    .filter((reference) => reference.id)
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    inputCount: inputs.length,
    inputs,
    changeTargets,
  };
}

function resolveOperationIntent(inferredOperation, suppliedOperation, item) {
  const supplied = normalizeChannelOperationIntent(suppliedOperation);
  const suppliedIsSpecific = supplied
    && (supplied.accessMode !== "unknown" || supplied.action !== "unknown");
  const conflicts = [];
  let operation = inferredOperation;
  const explicitDeliveryProhibition = (inferredOperation.forbiddenActions ?? [])
    .some((action) => ["commit", "pull_request", "push"].includes(action));
  let source = inferredOperation.accessMode === "unknown"
    ? "safe_default"
    : explicitDeliveryProhibition ? "current_user" : "deterministic_inference";
  const resolutions = [];

  if (inferredOperation.explicitReadOnly) {
    source = "current_user";
    if (suppliedIsSpecific && supplied.accessMode === "write") {
      conflicts.push({
        code: "operation_intent_restricted_by_user",
        severity: "warning",
        subject: "action",
        message: "当前用户要求明确限制为只读；先前的可写判断已被收紧。",
        question: "",
        resolution: "task_definition",
      });
    }
  } else if (suppliedIsSpecific && supplied.accessMode === "read_only") {
    const applied = inferredOperation.accessMode === "write"
      ? appliedIntentResolution(item, "write_request_exceeds_confirmed_boundary")
      : null;
    if (applied?.choiceId === "allow_write") {
      operation = inferredOperation;
      source = "confirmed_task_context";
      resolutions.push({
        code: applied.code,
        choiceId: applied.choiceId,
        targetFields: ["action.accessMode", "action.operation", "action.forbiddenActions"],
      });
    } else {
      operation = { ...inferredOperation, ...supplied };
      source = applied?.choiceId === "keep_read_only" ? "confirmed_task_context" : "channel_contract";
      if (applied?.choiceId === "keep_read_only") resolutions.push({
        code: applied.code,
        choiceId: applied.choiceId,
        targetFields: ["action.accessMode", "action.operation"],
      });
    }
    if (inferredOperation.accessMode === "write" && !applied) {
      conflicts.push({
        code: "write_request_exceeds_confirmed_boundary",
        severity: "blocking",
        subject: "action",
        message: "当前任务文字要求产生变更，但已确认的操作边界仍是只读。",
        question: "这次继续只读处理，还是明确扩大为允许产生变更？",
        resolution: "task_definition",
      });
    }
  } else if (suppliedIsSpecific) {
    operation = { ...inferredOperation, ...supplied };
    source = "channel_contract";
  }

  const expandSuppliedReadOnly = resolutions.some((resolution) => resolution.choiceId === "allow_write");
  const suppliedRestrictions = Array.isArray(supplied?.forbiddenActions) ? supplied.forbiddenActions : [];
  operation = {
    ...operation,
    forbiddenActions: [...new Set([
      ...(expandSuppliedReadOnly
        ? suppliedRestrictions.filter((action) => ["commit", "pull_request", "push"].includes(action))
        : suppliedRestrictions),
      ...(Array.isArray(inferredOperation?.forbiddenActions) ? inferredOperation.forbiddenActions : []),
    ])],
  };
  return { operation, source, conflicts, resolutions };
}

function localized(zh, en) {
  return { zh, en };
}

function clarificationOption(id, label, description, impact, {
  recommended = false,
  applyMode = "manual",
  targetFields = [],
} = {}) {
  return { id, label, description, impact, recommended, applyMode, targetFields };
}

function clarificationFor(conflict) {
  const definitions = {
    write_request_exceeds_confirmed_boundary: {
      questionCopy: localized("这次继续只读处理，还是明确扩大为允许产生变更？", "Should this run remain read-only, or may it explicitly produce changes?"),
      reason: localized("当前任务文字要求产生变更，但之前确认的操作边界是只读。", "The current task asks for changes, while its previously confirmed operation boundary is read-only."),
      recommendation: localized("如果只是需要分析或建议，保持只读更安全；只有确实需要产生变更时才扩大权限。", "Keep the task read-only for analysis or recommendations; expand permission only when actual changes are required."),
      options: [
        clarificationOption("keep_read_only",
          localized("保持只读", "Keep read-only"),
          localized("只分析并给出建议，不创建或修改结果文件。", "Analyze and provide recommendations without creating or modifying result files."),
          localized("不会扩大当前操作权限。", "The current operation permission is not expanded."),
          { recommended: true, applyMode: "automatic", targetFields: ["action.accessMode", "action.operation"] }),
        clarificationOption("allow_write",
          localized("允许产生变更", "Allow changes"),
          localized("允许 AI 在已声明的任务和资料边界内创建或修改结果。", "Allow AI to create or modify results within the declared task and material boundary."),
          localized("扩大为写入权限；交付、发布和外部操作仍需各自确认。", "Expands to write permission; delivery, publishing, and external operations still require their own confirmation."),
          { applyMode: "automatic", targetFields: ["action.accessMode", "action.operation", "action.forbiddenActions"] }),
      ],
    },
    read_only_with_change_targets: {
      questionCopy: localized(conflict.question, "Should this run only read and analyze, or may it modify these materials?"),
      reason: localized("任务要求只读，但部分资料被标记为修改目标。", "The task is read-only, but some materials are marked as change targets."),
      recommendation: localized("先检查资料角色，并把无需写回的资料改为查询来源。", "Review the material roles and change materials that do not need write-back into query sources."),
      options: [
        clarificationOption("review_material_roles",
          localized("调整资料权限", "Adjust material access"),
          localized("检查哪些资料只是参考或查询来源。", "Review which materials are references or query sources only."),
          localized("只修改资料角色，不扩大任务动作权限。", "Changes material roles without expanding task action permission."),
          { recommended: true, targetFields: ["materials.roles"] }),
        clarificationOption("edit_request_for_changes",
          localized("修改任务要求", "Edit the task request"),
          localized("明确说明允许修改哪些资料及期望结果。", "Explicitly state which materials may be changed and the expected result."),
          localized("需要重新确认任务定义和写入范围。", "Requires reconfirming the task definition and write scope."),
          { targetFields: ["task.definition", "action.accessMode"] }),
      ],
    },
    read_only_with_external_write: {
      questionCopy: localized(conflict.question, "Should this run prepare a reviewable result only, or write to the external platform?"),
      reason: localized("只读边界与外部写入任务类型冲突。", "The read-only boundary conflicts with an external-write task type."),
      recommendation: localized("先生成可审核结果，再单独确认外部写入。", "Prepare a reviewable result first, then confirm the external write separately."),
      options: [
        clarificationOption("prepare_only", localized("只准备结果", "Prepare only"), localized("生成可审核结果但不写入外部平台。", "Create a reviewable result without writing to the external platform."), localized("保留只读边界。", "Keeps the read-only boundary."), { recommended: true, targetFields: ["task.definition", "action.accessMode"] }),
        clarificationOption("edit_external_action", localized("修改外部动作要求", "Edit external action"), localized("明确目标平台和授权动作。", "Specify the target platform and authorized action."), localized("需要重新确认外部写入。", "Requires reconfirming the external write."), { targetFields: ["task.definition", "delivery.platform"] }),
      ],
    },
    platform_target_missing: {
      questionCopy: localized(conflict.question, "Which platform is this result intended for?"),
      reason: localized("任务需要平台相关处理，但没有明确目标平台。", "The task needs platform-specific work, but no target platform is selected."),
      recommendation: localized("选择实际使用的平台；不要让系统根据内容自行猜测。", "Select the platform that will actually be used instead of letting the system guess."),
      options: [clarificationOption("choose_platform", localized("选择目标平台", "Choose platform"), localized("从已连接或支持的平台中选择一个明确目标。", "Select one explicit target from connected or supported platforms."), localized("只修改结果目标，不自动发布。", "Changes only the result target and does not publish automatically."), { targetFields: ["delivery.platform"] })],
    },
    template_selection_changed: {
      questionCopy: localized(conflict.question, "Should this run use the Channel-confirmed template or the task's current template?"),
      reason: localized("Channel 中确认的模板与任务当前模板不一致。", "The Channel-confirmed template differs from the task's current template."),
      recommendation: localized("检查两个模板的输出差异后再选择。", "Review the output differences between the templates before choosing."),
      options: [clarificationOption("choose_template", localized("选择处理模板", "Choose method template"), localized("选择本次运行唯一使用的模板版本。", "Select the single template version for this run."), localized("会改变处理方法和预计输出。", "Changes the method and expected output."), { targetFields: ["method.selection", "expectedOutput"] })],
    },
    output_format_changed: {
      questionCopy: localized(conflict.question, "Which output format should this run produce?"),
      reason: localized("用户要求的格式与模板输出格式不一致。", "The requested format differs from the template output format."),
      recommendation: localized("以实际使用场景需要的格式为准，并同步调整模板或任务要求。", "Use the format required by the real use case and align the template or task request."),
      options: [clarificationOption("choose_output_format", localized("选择输出格式", "Choose output format"), localized("明确本次结果的唯一格式。", "Select one output format for this result."), localized("会改变预期结果格式。", "Changes the expected output format."), { targetFields: ["expectedOutput", "method.selection"] })],
    },
    change_target_not_writable: {
      questionCopy: localized(conflict.question, "Should AI prepare suggestions only, or use a write-enabled material?"),
      reason: localized("至少一项修改目标当前不具备安全写回能力。", "At least one change target does not support governed write-back."),
      recommendation: localized("优先改为建议模式，或选择具备受控写回能力的资料。", "Prefer suggestion mode or select a material with governed write-back capability."),
      options: [clarificationOption("review_change_target", localized("检查修改目标", "Review change target"), localized("调整资料角色或更换可写回资料。", "Adjust the material role or select a write-enabled material."), localized("不会绕过资料能力限制。", "Does not bypass material capability restrictions."), { recommended: true, targetFields: ["materials.roles"] })],
    },
  };
  const definition = definitions[conflict.code] ?? {
    questionCopy: localized(conflict.question, "Which interpretation should AI use for this run?"),
    reason: localized("任务意图存在当前无法安全消除的冲突。", "The task intent contains a conflict that cannot be resolved safely yet."),
    recommendation: localized("先检查任务定义，再继续执行。", "Review the task definition before continuing."),
    options: [clarificationOption("review_task_definition", localized("检查任务定义", "Review task definition"), localized("检查目标、范围和权限。", "Review the goal, scope, and permissions."), localized("不会自动修改任务。", "Does not modify the task automatically."), { targetFields: ["task.definition"] })],
  };
  return {
    code: conflict.code,
    question: definition.questionCopy.zh,
    ...definition,
    targetFields: [...new Set(definition.options.flatMap((option) => option.targetFields))],
    resolution: conflict.resolution,
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
  const operationResolution = resolveOperationIntent(inferredOperation, channel?.operationIntent ?? null, item);
  const operation = operationResolution.operation;
  const template = item?.myTemplateBinding ?? null;
  const selectedChannelTemplate = channel?.templateMatch?.state === "matched"
    ? channel.templateMatch
    : null;
  const materials = materialFacts(item);
  const delivery = item?.taskContextControl?.deliveryDestination === "task"
    ? "task"
    : (item?.channelOrigin?.channelId || channel?.source === "channel") ? "channel" : "task";
  const expectedOutput = firstText([channel?.outputExpectation, template?.expectedOutput,
    channel?.workMode?.expectedOutput, (item?.artifactContract?.produces ?? []).join(", ")], 500) || null;
  const expectedOutputSource = bounded(channel?.outputExpectation)
    ? "channel_contract"
    : bounded(template?.expectedOutput)
      ? "template"
      : bounded(channel?.workMode?.expectedOutput)
        ? "channel_contract"
        : (item?.artifactContract?.produces ?? []).length ? "task_definition" : "safe_default";
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
  const conflicts = [...operationResolution.conflicts];

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
  const goal = firstText([channel?.goal, item?.intentStatement, item?.title], 1_000);
  const goalSource = bounded(channel?.goal)
    ? "channel_contract"
    : bounded(item?.intentStatement) ? "current_user" : "task_definition";
  const canonical = {
    schemaVersion: WORK_ITEM_INTENT_CONTRACT_VERSION,
    workItemId: bounded(item?.id, 200) || null,
    goal,
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
    sources: {
      goal: goalSource,
      action: operationResolution.source,
      expectedOutput: expectedOutputSource,
      method: template ? "template" : channel?.workMode ? "channel_contract" : "safe_default",
      materials: "confirmed_task_context",
      delivery: item?.taskContextControl?.deliveryDestination === "task"
        ? "confirmed_task_context"
        : delivery === "channel" ? "channel_contract" : "safe_default",
    },
    acceptanceCriteria: [...(item?.acceptanceCriteria ?? [])].map((value) => bounded(value, 2_000)).filter(Boolean),
    verificationSop: [...(item?.verificationSop ?? [])].map((value) => bounded(value, 2_000)).filter(Boolean),
    conflicts,
    missing,
    resolutions: operationResolution.resolutions,
    clarification: primaryConflict ? clarificationFor(primaryConflict) : null,
    status: primaryConflict ? "needs_clarification" : missing.length ? "incomplete" : "ready",
  };
  return { ...canonical, snapshotKind: "current", digest: digest(canonical) };
}

export function freezeWorkItemIntentContract(item, { confirmedAt, confirmedBy } = {}) {
  const contract = buildWorkItemIntentContract(item);
  return {
    ...contract,
    snapshotKind: "execution_snapshot",
    confirmedAt: confirmedAt ?? null,
    confirmedBy: bounded(confirmedBy, 200) || null,
    readOnly: true,
  };
}
