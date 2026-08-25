export const RESULT_REPAIR_EVIDENCE_KIND = "failed_output_evidence";

function usableAssets(assets) {
  return (assets ?? [])
    .filter((asset) => asset?.id && (asset?.path || asset?.originalName))
    .map((asset) => ({ ...asset }));
}

export function buildResultRepairTaskSpec({ source, verification, at = null } = {}) {
  if (!source || verification?.status !== "failed" || !verification?.repair?.suggestedRequest) return null;
  const sourceOutputs = usableAssets(source.outputAssets);
  const sourceInputs = usableAssets(source.inputAssets);
  const inputAssets = [...new Map([...sourceInputs, ...sourceOutputs]
    .map((asset) => [asset.id, asset])).values()].slice(0, 100);
  const consumes = [...new Set([
    ...(source.artifactContract?.consumes ?? []),
    ...(sourceOutputs.length ? [RESULT_REPAIR_EVIDENCE_KIND] : []),
  ])];
  const artifactContract = source.artifactContract ? {
    ...source.artifactContract,
    consumes,
    produces: [...new Set(source.artifactContract.produces ?? [])],
    requirements: Array.isArray(source.artifactContract.requirements)
      ? source.artifactContract.requirements.map((requirement) => ({ ...requirement }))
      : [],
  } : {
    consumes,
    produces: [],
    requirements: [],
  };
  const description = [
    verification.repair.suggestedRequest,
    `原任务：${source.title}`,
    `未通过原因：${verification.repair.reasons.join("；")}`,
    "这是独立返工任务。保留原结果，只修复列出的检查项，不扩大原任务范围。",
  ].join("\n\n");
  return {
    title: `${source.title}返工`.slice(0, 200),
    description,
    taskKind: source.taskKind ?? "general",
    inputAssets,
    // A failed/blocked source must never block the work intended to repair it.
    // repairOfWorkItemId + the evidence handoff preserve provenance without
    // turning that provenance edge into an execution dependency.
    dependencyIds: [],
    artifactContract,
    handoff: sourceOutputs.length ? {
      sourceWorkItemId: source.id,
      kinds: [RESULT_REPAIR_EVIDENCE_KIND],
      assetIds: sourceOutputs.map((asset) => asset.id),
      status: "attached",
      validationErrors: [],
      evidenceOnly: true,
      at,
    } : null,
    repairOfWorkItemId: source.id,
    reasons: verification.repair.reasons.slice(0, 10),
  };
}

export function applyResultRepairSpec(item, spec) {
  if (!item || !spec) return item;
  item.repairOfWorkItemId = spec.repairOfWorkItemId;
  item.resultRepairReasons = [...spec.reasons];
  if (spec.handoff) {
    item.artifactHandoffs = [
      ...(item.artifactHandoffs ?? []).filter((handoff) => handoff.sourceWorkItemId !== spec.handoff.sourceWorkItemId),
      { ...spec.handoff, kinds: [...spec.handoff.kinds], assetIds: [...spec.handoff.assetIds] },
    ].slice(-50);
  }
  return item;
}
