import { basename, dirname, extname } from "node:path";

const TEXT_EXTENSIONS = new Set([
  ".md", ".mdx", ".txt", ".html", ".htm", ".json", ".yaml", ".yml", ".csv",
]);

function businessIdentifiers(value) {
  return new Set(
    String(value ?? "")
      .toLowerCase()
      .match(/[a-z]{2,}[-_]?\d{2,}|\d{4,}/g) ?? [],
  );
}

export function scoreWorkflowPair(requirement, delivery) {
  let score = 0;
  const reasons = [];
  const requirementIds = businessIdentifiers(requirement.relativePath);
  const deliveryIds = businessIdentifiers(delivery.relativePath);
  if ([...requirementIds].some((value) => deliveryIds.has(value))) {
    score += 0.45;
    reasons.push("shared_identifier");
  }
  const requirementParent = dirname(requirement.relativePath);
  const deliveryParent = dirname(delivery.relativePath);
  if (requirementParent === deliveryParent) {
    score += 0.3;
    reasons.push("same_directory");
  } else if (
    deliveryParent.startsWith(`${requirementParent}/`)
    || requirementParent.startsWith(`${deliveryParent}/`)
  ) {
    score += 0.2;
    reasons.push("related_directory");
  }
  const requirementStem = basename(requirement.relativePath, extname(requirement.relativePath))
    .replace(/需求|要求|request|requirements?|brief|prd/gi, "")
    .replace(/[^a-z0-9\u3400-\u9fff]+/gi, "");
  const deliveryStem = basename(delivery.relativePath, extname(delivery.relativePath))
    .replace(/交付|最终|final|方案|报告|delivery|report|proposal/gi, "")
    .replace(/[^a-z0-9\u3400-\u9fff]+/gi, "");
  if (requirementStem.length >= 2 && deliveryStem.length >= 2
    && (requirementStem.includes(deliveryStem) || deliveryStem.includes(requirementStem))) {
    score += 0.25;
    reasons.push("related_filename");
  }
  if (
    requirement.modifiedAt
    && delivery.modifiedAt
    && Date.parse(delivery.modifiedAt) >= Date.parse(requirement.modifiedAt)
  ) {
    score += 0.1;
    reasons.push("delivery_after_requirement");
  }
  return { score: Math.min(1, Number(score.toFixed(2))), reasons };
}

export function assessDeliveryCaseQuality(deliveryCase, artifactById) {
  const artifacts = artifactById instanceof Map
    ? artifactById
    : new Map((artifactById ?? []).map((artifact) => [artifact.id, artifact]));
  const requirementArtifacts = (deliveryCase?.requirementArtifactIds ?? [])
    .map((id) => artifacts.get(id))
    .filter(Boolean);
  const deliveryArtifacts = (deliveryCase?.deliveryArtifactIds ?? [])
    .map((id) => artifacts.get(id))
    .filter(Boolean);
  const coreArtifacts = [...requirementArtifacts, ...deliveryArtifacts];
  const expectedCoreCount = (deliveryCase?.requirementArtifactIds?.length ?? 0)
    + (deliveryCase?.deliveryArtifactIds?.length ?? 0);
  const blockers = [];
  const warnings = [];

  if (!requirementArtifacts.length) blockers.push("missing_requirement");
  if (!deliveryArtifacts.length) blockers.push("missing_delivery");
  if (coreArtifacts.length !== expectedCoreCount) blockers.push("missing_artifact");
  if (coreArtifacts.some((artifact) => artifact.availability !== "available")) {
    blockers.push("artifact_unavailable");
  }
  if (coreArtifacts.some((artifact) => artifact.exclusion)) blockers.push("artifact_excluded");

  const snapshots = deliveryCase?.evidenceSnapshots ?? [];
  const validSnapshots = snapshots.filter((snapshot) => {
    const artifact = artifacts.get(snapshot.artifactId);
    return artifact
      && artifact.availability === "available"
      && !artifact.exclusion
      && artifact.fingerprint === snapshot.fingerprint;
  });
  const evidenceIntegrity = snapshots.length
    ? validSnapshots.length / snapshots.length
    : 0;
  if (evidenceIntegrity < 1) blockers.push("evidence_changed");

  const parsedArtifacts = coreArtifacts.filter((artifact) =>
    artifact.extraction?.state === "ready"
    || (
      artifact.extraction?.reason === "native_text_or_unsupported"
      && TEXT_EXTENSIONS.has(`.${artifact.extension}`)
    ));
  const parsingCoverage = coreArtifacts.length
    ? parsedArtifacts.length / coreArtifacts.length
    : 0;
  if (parsingCoverage < 1) warnings.push("content_not_fully_parsed");
  if (coreArtifacts.some((artifact) =>
    ["failed", "needs_ocr", "limited"].includes(artifact.extraction?.state))) {
    warnings.push("parsing_attention_required");
  }

  const confirmedRoleCount = coreArtifacts.filter((artifact) =>
    artifact.confirmationState === "confirmed").length;
  const roleConfidence = coreArtifacts.length
    ? coreArtifacts.reduce((sum, artifact) =>
        sum + (
          artifact.confirmationState === "confirmed"
            ? 1
            : Number(artifact.roleInference?.confidence ?? 0)
        ), 0) / coreArtifacts.length
    : 0;
  if (confirmedRoleCount < coreArtifacts.length) warnings.push("roles_not_fully_confirmed");

  const pairScores = requirementArtifacts.map((requirement) =>
    deliveryArtifacts.reduce(
      (best, delivery) => Math.max(best, scoreWorkflowPair(requirement, delivery).score),
      0,
    ));
  const pairingConfidence = pairScores.length
    ? pairScores.reduce((sum, score) => sum + score, 0) / pairScores.length
    : 0;
  if (pairingConfidence < 0.45) warnings.push("low_pairing_confidence");

  let score = (
    evidenceIntegrity * 0.35
    + pairingConfidence * 0.25
    + parsingCoverage * 0.2
    + roleConfidence * 0.2
  );
  if (blockers.length) score = Math.min(score, 0.39);
  score = Number(Math.max(0, Math.min(1, score)).toFixed(2));
  const status = blockers.length
    ? "blocked"
    : score >= 0.8
      ? "trusted"
      : "review";

  return {
    version: 1,
    score,
    status,
    metrics: {
      evidenceIntegrity: Number(evidenceIntegrity.toFixed(2)),
      pairingConfidence: Number(pairingConfidence.toFixed(2)),
      parsingCoverage: Number(parsingCoverage.toFixed(2)),
      roleConfidence: Number(roleConfidence.toFixed(2)),
    },
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
  };
}

export function summarizeDeliveryCaseQualities(qualities = []) {
  const totalCaseCount = qualities.length;
  const trustedCaseCount = qualities.filter((quality) => quality.status === "trusted").length;
  const reviewCaseCount = qualities.filter((quality) => quality.status === "review").length;
  const blockedCaseCount = qualities.filter((quality) => quality.status === "blocked").length;
  const score = totalCaseCount
    ? Number((qualities.reduce((sum, quality) => sum + quality.score, 0) / totalCaseCount).toFixed(2))
    : 0;
  return {
    version: 1,
    score,
    status: blockedCaseCount ? "blocked" : score >= 0.8 ? "trusted" : "review",
    totalCaseCount,
    trustedCaseCount,
    reviewCaseCount,
    blockedCaseCount,
    blockers: [...new Set(qualities.flatMap((quality) => quality.blockers))],
    warnings: [...new Set(qualities.flatMap((quality) => quality.warnings))],
  };
}

export function summarizeWorkflowRetrievalRanks(ranks = []) {
  const bounded = ranks.filter((rank) => Number.isInteger(rank) && rank > 0);
  const sampleCount = ranks.length;
  return {
    sampleCount,
    top1: sampleCount
      ? Number((bounded.filter((rank) => rank <= 1).length / sampleCount).toFixed(3))
      : null,
    top5: sampleCount
      ? Number((bounded.filter((rank) => rank <= 5).length / sampleCount).toFixed(3))
      : null,
    mrr: sampleCount
      ? Number((bounded.reduce((sum, rank) => sum + (1 / rank), 0) / sampleCount).toFixed(3))
      : null,
    noResultRate: sampleCount
      ? Number(((sampleCount - bounded.length) / sampleCount).toFixed(3))
      : null,
  };
}

export function normalizedEmbedding(value) {
  if (!Array.isArray(value) || value.length < 8 || value.length > 2_048) return null;
  const vector = value.map(Number);
  if (vector.some((item) => !Number.isFinite(item))) return null;
  const magnitude = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  if (!magnitude) return null;
  return vector.map((item) => Number((item / magnitude).toFixed(8)));
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || left.length !== right?.length) return 0;
  return Math.max(
    -1,
    Math.min(1, left.reduce((sum, value, index) => sum + value * right[index], 0)),
  );
}
