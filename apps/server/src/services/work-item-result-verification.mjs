import { createHash } from "node:crypto";

const RESULT_VERIFICATION_SCHEMA_VERSION = 2;

function extensionOf(asset) {
  const name = String(asset?.path ?? asset?.originalName ?? "").toLowerCase();
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function normalizedRequirements(workItem) {
  return Array.isArray(workItem?.artifactContract?.requirements)
    ? workItem.artifactContract.requirements.filter((requirement) => requirement?.kind)
    : [];
}

function normalizedVerificationKinds(workItem) {
  const kinds = workItem?.artifactContract?.verification?.requiredKinds;
  return Array.isArray(kinds)
    ? [...new Set(kinds.map((kind) => String(kind).toLowerCase()).filter(Boolean))]
    : [];
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
  const verificationKinds = normalizedVerificationKinds(workItem);
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
  const checks = contract.checks.map((check) => {
    const matching = outputs.filter((asset) => {
      const extensionMatched = !check.extensions.length || check.extensions.includes(extensionOf(asset));
      const familyMatched = !check.families.length || check.families.includes(String(asset?.family ?? "unknown").toLowerCase());
      return extensionMatched && familyMatched;
    });
    const usable = matching.filter((asset) => Boolean(asset?.path ?? asset?.originalName)
      && (asset?.size == null || Number(asset.size) > 0));
    const qualified = usable.filter((asset) => qualityMatches(asset, check.quality));
    const passed = qualified.length >= check.minCount;
    return {
      kind: check.kind,
      status: passed ? "passed" : "failed",
      expected: {
        minCount: check.minCount,
        extensions: check.extensions,
        families: check.families,
        ...(check.quality ? { quality: check.quality } : {}),
      },
      actual: { matchedCount: matching.length, usableCount: usable.length, qualifiedCount: qualified.length },
      outputAssetIds: qualified.slice(0, 100).map((asset) => asset.id).filter(Boolean),
      summary: passed
        ? `${check.kind} 已有 ${qualified.length} 个符合格式且内容属性达标的结果。`
        : `${check.kind} 需要至少 ${check.minCount} 个符合格式且内容属性达标的结果，当前只有 ${qualified.length} 个。`,
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
  const verificationEvidence = (verification.verificationChecks ?? []).flatMap((check) => (check.verificationIds ?? []).map((verificationId) => {
    const record = (workItem?.verificationRecords ?? []).find((candidate) => candidate.id === verificationId);
    return record ? { kind: "run", ref: record.id, summary: `${check.kind}验证结果` } : null;
  }).filter(Boolean));
  return [...assetEvidence, ...verificationEvidence];
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
