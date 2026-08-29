import { createHash } from "node:crypto";

const RESULT_VERIFICATION_SCHEMA_VERSION = 2;

function extensionOf(asset) {
  const name = String(asset?.path ?? asset?.originalName ?? "").toLowerCase();
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function normalizedRequirements(workItem) {
  const declared = Array.isArray(workItem?.artifactContract?.requirements)
    ? workItem.artifactContract.requirements.filter((requirement) => requirement?.kind)
    : [];
  if (declared.length) return declared;
  const recoveredRepositoryChange = (workItem?.executionArtifacts ?? []).some((artifact) =>
    artifact?.kind === "software_change"
    && artifact?.source === "auto_run"
    && artifact?.legacyExecutionRecovery === true);
  return recoveredRepositoryChange
    ? [{ kind: "software_change", minCount: 1, extensions: [".diff", ".patch", ".md", ".txt"] }]
    : [];
}

const DOCUMENT_EXTENSIONS = new Set([".md", ".txt", ".rst", ".adoc"]);
const CODE_RUNTIME_VERIFICATION_KINDS = new Set(["test", "build", "typecheck", "lint"]);

function documentationOnlyTask(workItem) {
  const text = [workItem?.title, workItem?.body, workItem?.intentStatement, workItem?.intentContract?.goal]
    .filter(Boolean)
    .join("\n");
  const changedFiles = (workItem?.executionArtifacts ?? [])
    .flatMap((artifact) => Array.isArray(artifact?.changedFiles) ? artifact.changedFiles : [])
    .map((path) => extensionOf({ path }))
    .filter(Boolean);
  const explicitlyDocumentationOnly = /文档型(?:代码)?任务|documentation[- ]only/i.test(text);
  const hasDocumentTarget = /(?:^|[\s"'“])(?:docs?\/)?[a-z0-9._/-]+\.(?:md|txt|rst|adoc)(?=$|[\s"'””,，。；;])/i.test(text);
  const constrainsOtherChanges = /不修改其他文件|仅(?:新增|创建|修改|包含)|只(?:新增|创建|修改|包含)|only\s+(?:add|create|change|contain)/i.test(text);
  if (changedFiles.length) {
    const deliveredOnlyDocuments = changedFiles.every((extension) => DOCUMENT_EXTENSIONS.has(extension));
    return deliveredOnlyDocuments
      && (explicitlyDocumentationOnly || (hasDocumentTarget && constrainsOtherChanges));
  }
  return explicitlyDocumentationOnly && hasDocumentTarget;
}

export function requiredRuntimeVerificationKinds(workItem) {
  const kinds = workItem?.artifactContract?.verification?.requiredKinds;
  const normalized = Array.isArray(kinds)
    ? [...new Set(kinds.map((kind) => String(kind).toLowerCase()).filter(Boolean))]
    : [];
  return documentationOnlyTask(workItem)
    ? normalized.filter((kind) => !CODE_RUNTIME_VERIFICATION_KINDS.has(kind))
    : normalized;
}

function taskDomain(taskKind) {
  if (String(taskKind ?? "").startsWith("content_")) return "content";
  if (String(taskKind ?? "").startsWith("software_")) return "development";
  if (String(taskKind ?? "").startsWith("business_")) return "business";
  return "general";
}

function normalizeQuality(quality) {
  return {
    ...quality,
    requiredHeadings: Array.isArray(quality?.requiredHeadings)
      ? quality.requiredHeadings.map((heading) => String(heading).trim().toLowerCase())
      : [],
  };
}

export function resultVerificationContract(workItem, { enforced = false } = {}) {
  const requirements = normalizedRequirements(workItem);
  const verificationKinds = requiredRuntimeVerificationKinds(workItem);
  if (!requirements.length && !verificationKinds.length) return null;
  return {
    schemaVersion: RESULT_VERIFICATION_SCHEMA_VERSION,
    enforced: enforced === true,
    domain: taskDomain(workItem?.taskKind),
    taskKind: String(workItem?.taskKind ?? "general"),
    checks: requirements.map((requirement) => ({
      kind: String(requirement.kind).slice(0, 100),
      minCount: Math.max(1, Number(requirement.minCount) || 1),
      extensions: [...new Set((requirement.extensions ?? []).map((value) => String(value).toLowerCase()))].slice(0, 30),
      families: [...new Set((requirement.families ?? []).map((value) => String(value).toLowerCase()))].slice(0, 20),
      ...(requirement.quality ? { quality: normalizeQuality(requirement.quality) } : {}),
    })),
    verificationChecks: verificationKinds.map((kind) => ({ kind })),
  };
}

export function verifyWorkItemResult(workItem) {
  const contract = resultVerificationContract(workItem);
  if (!contract) {
    return {
      schemaVersion: RESULT_VERIFICATION_SCHEMA_VERSION,
      status: "not_required",
      domain: taskDomain(workItem?.taskKind),
      checks: [],
      verificationChecks: [],
      summary: "当前任务没有声明结果验收。",
      digest: digestFor({ status: "not_required", checks: [], verificationChecks: [] }),
    };
  }
  const outputs = Array.isArray(workItem?.outputAssets) ? workItem.outputAssets : [];
  const executionArtifacts = Array.isArray(workItem?.executionArtifacts) ? workItem.executionArtifacts : [];
  const checks = contract.checks.map((check) => {
    const matching = outputs.filter((asset) => {
      const extensionMatched = !check.extensions.length || check.extensions.includes(extensionOf(asset));
      const familyMatched = !check.families.length || check.families.includes(String(asset?.family ?? "unknown").toLowerCase());
      return extensionMatched && familyMatched;
    });
    const usable = matching.filter((asset) => Boolean(asset?.path ?? asset?.originalName)
      && (asset?.size == null || Number(asset.size) > 0));
    const qualified = usable.filter((asset) => qualityMatches(asset, check.quality));
    // A governed Git Worktree diff is the authoritative software-change
    // artifact. It is not a user-created .diff file, so keep it separate from
    // file assets while allowing the task's software_change contract to consume
    // the real changed-file receipt.
    const qualifiedExecutionArtifacts = executionArtifacts.filter((artifact) =>
      artifact?.kind === check.kind
      && artifact.source === "auto_run"
      && artifact.worktreeId
      && Number(artifact.changedFileCount) > 0
      && Array.isArray(artifact.changedFiles)
      && artifact.changedFiles.length > 0);
    const qualifiedCount = qualified.length + qualifiedExecutionArtifacts.length;
    const passed = qualifiedCount >= check.minCount;
    return {
      kind: check.kind,
      status: passed ? "passed" : "failed",
      expected: {
        minCount: check.minCount,
        extensions: check.extensions,
        families: check.families,
        ...(check.quality ? { quality: check.quality } : {}),
      },
      actual: {
        matchedCount: matching.length + qualifiedExecutionArtifacts.length,
        usableCount: usable.length + qualifiedExecutionArtifacts.length,
        qualifiedCount,
      },
      outputAssetIds: qualified.slice(0, 100).map((asset) => asset.id).filter(Boolean),
      executionArtifactIds: qualifiedExecutionArtifacts.slice(0, 100).map((artifact) => artifact.id).filter(Boolean),
      summary: passed
        ? `${check.kind} 已有 ${qualifiedCount} 个符合格式且内容属性达标的结果。`
        : `${check.kind} 需要至少 ${check.minCount} 个符合格式且内容属性达标的结果，当前只有 ${qualifiedCount} 个。`,
    };
  });
  const verificationChecks = contract.verificationChecks.map((check) => {
    const matching = (workItem?.verificationRecords ?? []).filter((record) => record?.kind === check.kind);
    const passed = matching.some((record) => record.status === "passed");
    return {
      kind: check.kind,
      status: passed ? "passed" : "failed",
      expected: { atLeastOne: "passed" },
      actual: { total: matching.length, passed: matching.filter((record) => record.status === "passed").length },
      verificationIds: matching.filter((record) => record.status === "passed").slice(0, 20).map((record) => record.id).filter(Boolean),
      summary: passed ? `${check.kind} 验证结果已通过。` : `缺少已通过的 ${check.kind} 验证结果。`,
    };
  });
  const status = checks.every((check) => check.status === "passed")
    && verificationChecks.every((check) => check.status === "passed")
    ? "passed" : "failed";
  const failedChecks = [...checks, ...verificationChecks].filter((check) => check.status === "failed");
  return {
    schemaVersion: RESULT_VERIFICATION_SCHEMA_VERSION,
    status,
    domain: contract.domain,
    taskKind: contract.taskKind,
    checks,
    verificationChecks,
    summary: status === "passed"
      ? "结果文件的数量、格式、内容属性以及软件验证结果均已通过检查。"
      : `有 ${checks.filter((check) => check.status === "failed").length + verificationChecks.filter((check) => check.status === "failed").length} 项结果检查未通过。`,
    repair: status === "failed" ? {
      required: true,
      mode: "independent_task",
      reasons: failedChecks.slice(0, 10).map((check) => check.summary),
      suggestedRequest: `修复“${String(workItem?.title ?? workItem?.taskKind ?? "当前任务").slice(0, 120)}”未通过的结果检查，仅处理：${failedChecks.slice(0, 5).map((check) => check.kind).join("、")}`,
    } : null,
    digest: digestFor({ contract, checks, verificationChecks, status }),
  };
}

export function resultVerificationEvidence(workItem, verification = verifyWorkItemResult(workItem)) {
  const assets = new Map((workItem?.outputAssets ?? []).map((asset) => [asset.id, asset]));
  const executionArtifacts = new Map((workItem?.executionArtifacts ?? []).map((artifact) => [artifact.id, artifact]));
  const assetEvidence = verification.checks.flatMap((check) => (check.outputAssetIds ?? []).map((assetId) => {
    const asset = assets.get(assetId);
    return asset ? {
      kind: "asset",
      ref: asset.path ?? asset.originalName,
      summary: `${check.kind}结果验收证据`,
      assetId: asset.id,
      hash: asset.hash ?? null,
      version: asset.version ?? null,
      terminalId: asset.terminalId ?? null,
    } : null;
  }).filter(Boolean));
  const executionEvidence = verification.checks.flatMap((check) => (check.executionArtifactIds ?? []).map((artifactId) => {
    const artifact = executionArtifacts.get(artifactId);
    return artifact ? {
      kind: "artifact",
      ref: artifact.worktreeId,
      summary: `${check.kind} Git Worktree change (${artifact.changedFileCount} files)`,
      artifactId: artifact.id,
    } : null;
  }).filter(Boolean));
  const verificationEvidence = (verification.verificationChecks ?? []).flatMap((check) => (check.verificationIds ?? []).map((verificationId) => {
    const record = (workItem?.verificationRecords ?? []).find((candidate) => candidate.id === verificationId);
    return record ? { kind: "run", ref: record.id, summary: `${check.kind}验证结果` } : null;
  }).filter(Boolean));
  return [...assetEvidence, ...executionEvidence, ...verificationEvidence];
}

function metricOf(asset, field) {
  const value = asset?.contentMetrics?.[field] ?? asset?.[field];
  return value == null ? null : Number(value);
}

function qualityMatches(asset, quality) {
  if (!quality) return true;
  const checks = [
    ["charCount", quality.minChars, quality.maxChars],
    ["sectionCount", quality.minSections, quality.maxSections],
    ["pageCount", quality.minPages, quality.maxPages],
    ["durationSeconds", quality.minDurationSeconds, quality.maxDurationSeconds],
    ["width", quality.minWidth, quality.maxWidth],
    ["height", quality.minHeight, quality.maxHeight],
  ];
  for (const [field, minimum, maximum] of checks) {
    if (minimum == null && maximum == null) continue;
    const actual = metricOf(asset, field);
    if (actual == null || (minimum != null && actual < minimum) || (maximum != null && actual > maximum)) return false;
  }
  if (quality.requiredHeadings?.length) {
    const headings = new Set((asset?.contentMetrics?.headings ?? asset?.headings ?? [])
      .map((heading) => String(heading).trim().toLowerCase()));
    if (quality.requiredHeadings.some((heading) => !headings.has(heading))) return false;
  }
  return true;
}

function digestFor(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
