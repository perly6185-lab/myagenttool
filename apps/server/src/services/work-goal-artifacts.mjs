import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { assetCapabilityMatrix, classifyAsset } from "./asset-capabilities.mjs";

function cleanRelativePath(value) {
  const path = String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || path.length > 1_000 || path.split("/").includes("..")) return null;
  return path;
}

function latestBoundAutoRun(state, item) {
  const runIds = new Set((item.executionBindings ?? [])
    .filter((binding) => binding.kind === "auto_run" && binding.targetId)
    .map((binding) => binding.targetId));
  return (state.autoRuns ?? [])
    .filter((run) => runIds.has(run.id) || run.localIssueId === item.id || run.executionChainId === item.id)
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))[0] ?? null;
}

function deliveryOutputAssets(state, item) {
  const run = latestBoundAutoRun(state, item);
  const changedFiles = run?.deliveryReport?.changedFiles ?? [];
  const project = (state.projects ?? []).find((candidate) => candidate.id === item.projectId) ?? null;
  const matrix = assetCapabilityMatrix();
  const seen = new Set((item.outputAssets ?? []).map((asset) => asset.path));
  const assets = [];
  for (const candidate of changedFiles) {
    const path = cleanRelativePath(candidate);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const classified = classifyAsset(path);
    const digest = createHash("sha256").update(`${run?.id ?? item.id}:${path}`).digest("hex").slice(0, 32);
    assets.push({
      id: `delivery_${digest}`,
      originalName: path.split("/").at(-1),
      path,
      family: classified.family,
      mimeType: classified.mimeType,
      terminalId: item.terminalId,
      size: null,
      resourceClass: "unknown",
      hash: projectFileHash(project?.path, path),
      version: run?.localDelivery?.commit ?? run?.deliveryReport?.changedFilesBaseCommit ?? null,
      worktreeId: null,
      capabilities: [...(matrix[classified.family]?.capabilities ?? matrix.unknown.capabilities)],
      readiness: { state: "ready", reason: "task_delivery_output" },
    });
  }
  return assets;
}

function projectFileHash(projectPath, relativePath) {
  if (!projectPath) return null;
  try {
    const root = realpathSync(projectPath);
    const target = resolve(root, relativePath);
    if (!(target === root || target.startsWith(`${root}${sep}`)) || !existsSync(target) || lstatSync(target).isSymbolicLink()) return null;
    const actual = realpathSync(target);
    if (!(actual === root || actual.startsWith(`${root}${sep}`))) return null;
    return `sha256:${createHash("sha256").update(readFileSync(actual)).digest("hex")}`;
  } catch {
    return null;
  }
}

function normalizedRequirements(item) {
  return Array.isArray(item?.artifactContract?.requirements)
    ? item.artifactContract.requirements.filter((requirement) => requirement?.kind)
    : [];
}

function extensionOf(asset) {
  const name = String(asset?.path ?? asset?.originalName ?? "").toLowerCase();
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function assetsForKind(item, kind, outputs) {
  const requirement = normalizedRequirements(item).find((candidate) => candidate.kind === kind) ?? null;
  if (!requirement) return { assets: outputs, requirement: null, errors: [] };
  const extensions = new Set((requirement.extensions ?? []).map((value) => String(value).toLowerCase()));
  const families = new Set((requirement.families ?? []).map((value) => String(value).toLowerCase()));
  const matching = outputs.filter((asset) =>
    (!extensions.size || extensions.has(extensionOf(asset)))
    && (!families.size || families.has(String(asset?.family ?? "unknown").toLowerCase())));
  const minCount = Math.max(1, Number(requirement.minCount) || 1);
  const errors = matching.length >= minCount
    ? []
    : [`${kind} 需要至少 ${minCount} 个符合格式的产物，当前只有 ${matching.length} 个`];
  return { assets: matching, requirement, errors };
}

/**
 * Builds the only supported handoff shape for an already completed result.
 * Callers may copy the returned assets into the dependent task, but must not
 * label an output as a produced kind unless it passed that kind's contract.
 */
export function validatedArtifactTransfer({ source, kinds = null, at = null } = {}) {
  const requestedKinds = [...new Set((Array.isArray(kinds) ? kinds : source?.artifactContract?.produces ?? [])
    .map((kind) => String(kind ?? "").trim())
    .filter(Boolean))];
  const outputs = (source?.outputAssets ?? [])
    .filter((asset) => asset?.id && (asset?.path || asset?.originalName))
    .map((asset) => ({ ...asset }));
  const validations = requestedKinds.map((kind) => {
    const validation = assetsForKind(source, kind, outputs);
    return {
      kind,
      assets: validation.assets,
      errors: validation.errors,
      status: validation.errors.length ? "invalid" : "ready",
    };
  });
  const ready = validations.filter((validation) => validation.status === "ready");
  const assetIds = [...new Set(ready.flatMap((validation) => validation.assets.map((asset) => asset.id).filter(Boolean)))];
  const selectedIds = new Set(assetIds);
  const assets = outputs.filter((asset) => selectedIds.has(asset.id));
  const readyKinds = ready.map((validation) => validation.kind);
  const validationErrors = validations.flatMap((validation) => validation.errors);
  return {
    assets,
    validations: validations.map(({ assets: matchingAssets, ...validation }) => ({
      ...validation,
      assetIds: matchingAssets.map((asset) => asset.id).filter(Boolean),
    })),
    handoff: {
      sourceWorkItemId: source?.id ?? null,
      kinds: readyKinds,
      assetIds,
      status: readyKinds.length === requestedKinds.length && readyKinds.length > 0 && assetIds.length > 0
        ? "attached"
        : "awaiting_artifact",
      validationErrors,
      at,
    },
  };
}

export function artifactDependencyReadiness(item, dependency) {
  const taskResolved = Boolean(dependency && (dependency.status === "done" || dependency.state === "closed"));
  if (!dependency) return { resolved: false, taskResolved: false, artifactResolved: false, unresolvedArtifactKinds: [] };
  const handoff = (item?.artifactHandoffs ?? []).find((candidate) => candidate.sourceWorkItemId === dependency.id) ?? null;
  const consumed = new Set(item?.artifactContract?.consumes ?? []);
  const relevantKinds = [...new Set([
    ...(dependency.artifactContract?.produces ?? []).filter((kind) => consumed.has(kind)),
    ...(handoff?.kinds ?? []).filter((kind) => consumed.has(kind)),
  ])];
  const attachedKinds = new Set(handoff?.status === "attached" && (handoff.assetIds ?? []).length
    ? handoff.kinds ?? []
    : []);
  const unresolved = relevantKinds.filter((kind) => !attachedKinds.has(kind));
  const handoffFailed = Boolean(handoff && handoff.status !== "attached");
  const artifactResolved = !handoffFailed && unresolved.length === 0;
  return {
    resolved: taskResolved && artifactResolved,
    taskResolved,
    artifactResolved,
    unresolvedArtifactKinds: unresolved,
  };
}

function stableApprovalInput(item) {
  return {
    workItemId: item?.id ?? null,
    platform: item?.platformTarget
      ? { id: item.platformTarget.id ?? null, label: item.platformTarget.label ?? null }
      : null,
    artifacts: (item?.inputAssets ?? [])
      .filter((asset) => asset?.id)
      .map((asset) => ({
        id: asset.id,
        path: asset.path ?? asset.originalName ?? null,
        hash: asset.hash ?? null,
        version: asset.version ?? null,
        family: asset.family ?? null,
      }))
      .sort((left, right) => String(left.id).localeCompare(String(right.id))),
    handoffs: (item?.artifactHandoffs ?? [])
      .filter((handoff) => handoff?.status === "attached")
      .map((handoff) => ({
        sourceWorkItemId: handoff.sourceWorkItemId ?? null,
        kinds: [...(handoff.kinds ?? [])].sort(),
        assetIds: [...(handoff.assetIds ?? [])].sort(),
      }))
      .sort((left, right) => String(left.sourceWorkItemId).localeCompare(String(right.sourceWorkItemId))),
  };
}

export function artifactApprovalSnapshot(item, { createdAt = null } = {}) {
  if (!item) return null;
  const input = stableApprovalInput(item);
  if (!input.artifacts.length || unresolvedArtifactKinds(item).length) return null;
  const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return {
    schemaVersion: 1,
    digest,
    platform: input.platform,
    artifacts: input.artifacts,
    sourceWorkItemIds: [...new Set(input.handoffs.map((handoff) => handoff.sourceWorkItemId).filter(Boolean))],
    createdAt,
  };
}

export function publicationApprovalSnapshot(item, options = {}) {
  if (!item || item.taskKind !== "content_publish" || !item.platformTarget?.id) return null;
  return artifactApprovalSnapshot(item, options);
}

function promoteArtifactApproval(state, dependent, timestamp) {
  if (unresolvedArtifactKinds(dependent).length) return false;
  const snapshot = dependent.taskKind === "content_publish"
    ? publicationApprovalSnapshot(dependent, { createdAt: timestamp })
    : artifactApprovalSnapshot(dependent, { createdAt: timestamp });
  if (!snapshot) return false;
  const request = (state.channelTaskRequests ?? []).find((candidate) =>
    candidate.workItemId === dependent.id && ["waiting_artifacts", "pending"].includes(candidate.status)) ?? null;
  if (!request) return false;
  const previousDigest = request.previewDigest ?? request.approvalSnapshot?.digest ?? null;
  const versionChanged = Boolean(previousDigest && previousDigest !== snapshot.digest);
  request.status = "pending";
  request.approvalSnapshot = snapshot;
  request.previewDigest = snapshot.digest;
  request.previewReady = true;
  request.updatedAt = timestamp;
  const thread = (state.channelTaskThreads ?? []).find((candidate) =>
    candidate.id === request.threadId || candidate.workItemId === dependent.id) ?? null;
  if (thread) {
    thread.statusHistory = [...(thread.statusHistory ?? []), {
      status: "waiting_approval",
      reason: versionChanged ? "upstream_artifact_version_changed" : "publication_artifacts_ready",
      at: timestamp,
    }].slice(-30);
    thread.status = "waiting_approval";
    thread.waitingFor = dependent.taskKind === "content_publish" ? "publication_review" : "artifact_review";
    thread.publicationPreview = dependent.taskKind === "content_publish" ? snapshot : null;
    thread.artifactReviewPreview = dependent.taskKind === "content_publish" ? null : snapshot;
    thread.riskPreviewDigest = snapshot.digest;
    if (versionChanged) {
      thread.previousRiskPreviewDigest = previousDigest;
      thread.artifactVersionChangedAt = timestamp;
      thread.artifactVersionChangeNotice = dependent.taskKind === "content_publish"
        ? `发布内容已更新，请重新核对将发布到${snapshot.platform?.label ?? "目标平台"}的最终版本。`
        : "上游成品已更新，请重新核对最新版本。";
    }
    thread.nextAction = dependent.taskKind === "content_publish"
      ? `请核对将发布到${snapshot.platform?.label ?? "目标平台"}的 ${snapshot.artifacts.length} 个最终文件，回复“确认发布”继续`
      : `上游产物已准备好，请核对 ${snapshot.artifacts.length} 个文件并回复“确认”继续`;
    thread.lastProgressAt = timestamp;
    thread.lastProgressSummary = versionChanged
      ? thread.artifactVersionChangeNotice
      : `发布成品已准备好，等待确认最终版本（${snapshot.artifacts.length} 个文件）`;
    thread.lastActivityAt = timestamp;
    thread.updatedAt = timestamp;
  }
  return true;
}

/**
 * Registers files from the latest delivery as task outputs and hands them to
 * dependent tasks in the same user-visible goal. The caller owns persistence
 * and may provide activity/notification hooks.
 */
export function propagateCompletedWorkGoalTask({
  state,
  source,
  now,
  recordActivity = null,
} = {}) {
  if (!source || source.status !== "done" || !source.workGoalId) {
    return { sourceChanged: false, dependents: [], goal: null };
  }
  const goal = (state.workGoals ?? []).find((candidate) =>
    candidate.id === source.workGoalId && candidate.ownerTeamId === source.ownerTeamId) ?? null;
  if (!goal) return { sourceChanged: false, dependents: [], goal: null };

  const timestamp = now();
  const derived = source.terminalId ? deliveryOutputAssets(state, source) : [];
  if (derived.length) {
    source.outputAssets = [...(source.outputAssets ?? []), ...derived].slice(0, 100);
    source.revision = (Number(source.revision) || 0) + 1;
    source.updatedAt = timestamp;
    recordActivity?.(source, "delivery_outputs_registered", {
      assetIds: derived.map((asset) => asset.id),
      paths: derived.map((asset) => asset.path),
    });
  }
  source.completedAt ??= timestamp;
  const producedKinds = source.artifactContract?.produces ?? [];
  const outputs = (source.outputAssets ?? []).map((asset) => ({ ...asset }));
  const manifests = producedKinds.map((kind) => {
    const validation = assetsForKind(source, kind, outputs);
    return {
      kind,
      assetIds: validation.assets.map((asset) => asset.id).filter(Boolean),
      status: validation.errors.length ? "invalid" : "ready",
      expectedMinCount: Math.max(1, Number(validation.requirement?.minCount) || 1),
      actualCount: validation.assets.length,
      errors: validation.errors,
      validatedAt: timestamp,
    };
  });
  source.artifactManifest = manifests;
  goal.updatedAt = timestamp;
  goal.artifacts = [
    ...(goal.artifacts ?? []).filter((entry) => entry.sourceWorkItemId !== source.id),
    ...manifests.map((manifest) => ({
      ...manifest,
      sourceWorkItemId: source.id,
      producedAt: source.completedAt ?? source.updatedAt,
    })),
  ].slice(-100);

  const changed = [];
  for (const dependent of (state.workItems ?? []).filter((candidate) =>
    candidate.ownerTeamId === source.ownerTeamId
    && candidate.workGoalId === source.workGoalId
    && (candidate.dependencyIds ?? []).includes(source.id))) {
    const consumes = dependent.artifactContract?.consumes ?? [];
    const matchingManifests = manifests.filter((manifest) =>
      consumes.includes(manifest.kind) && manifest.status === "ready");
    const matchingKinds = matchingManifests.map((manifest) => manifest.kind);
    const matchingAssetIds = new Set(matchingManifests.flatMap((manifest) => manifest.assetIds));
    const matchingOutputs = outputs.filter((asset) => matchingAssetIds.has(asset.id));
    const previousHandoff = (dependent.artifactHandoffs ?? []).find((handoff) => handoff.sourceWorkItemId === source.id) ?? null;
    const previousAssetIds = new Set(previousHandoff?.assetIds ?? []);
    const retainedInputs = (dependent.inputAssets ?? []).filter((asset) => !previousAssetIds.has(asset.id));
    const existingAssetIds = new Set(retainedInputs.map((asset) => asset.id).filter(Boolean));
    const additions = matchingOutputs.filter((asset) => !existingAssetIds.has(asset.id));
    dependent.inputAssets = [...retainedInputs, ...additions].slice(0, 100);
    const attachedAssetIds = matchingOutputs.map((asset) => asset.id).filter(Boolean);
    dependent.artifactHandoffs = [
      ...(dependent.artifactHandoffs ?? []).filter((handoff) => handoff.sourceWorkItemId !== source.id),
      {
        sourceWorkItemId: source.id,
        kinds: matchingKinds,
        assetIds: attachedAssetIds,
        status: matchingKinds.length && attachedAssetIds.length ? "attached" : "awaiting_artifact",
        validationErrors: manifests.filter((manifest) => consumes.includes(manifest.kind) && manifest.status !== "ready")
          .flatMap((manifest) => manifest.errors),
        at: timestamp,
      },
    ].slice(-50);
    dependent.revision = (Number(dependent.revision) || 0) + 1;
    dependent.updatedAt = timestamp;
    changed.push(dependent);
    recordActivity?.(dependent, "goal_artifact_handoff", {
      sourceWorkItemId: source.id,
      kinds: matchingKinds,
      assetIds: attachedAssetIds,
    });
    promoteArtifactApproval(state, dependent, timestamp);
  }

  const goalTasks = (state.workItems ?? []).filter((candidate) =>
    candidate.ownerTeamId === source.ownerTeamId && candidate.workGoalId === source.workGoalId);
  goal.status = (goal.failedSteps ?? []).length
    ? "needs_repair"
    : goalTasks.length && goalTasks.every((candidate) => candidate.status === "done" || candidate.state === "closed")
      ? "completed"
      : "active";
  return { sourceChanged: derived.length > 0, dependents: changed, goal };
}

export function unresolvedArtifactKinds(item) {
  if (!item?.workGoalId || !(item.dependencyIds ?? []).length) return [];
  const required = item.artifactContract?.consumes ?? [];
  if (!required.length) return [];
  const attached = new Set((item.artifactHandoffs ?? [])
    .filter((handoff) => handoff.status === "attached" && (handoff.assetIds ?? []).length)
    .flatMap((handoff) => handoff.kinds ?? []));
  return required.filter((kind) => !attached.has(kind));
}
