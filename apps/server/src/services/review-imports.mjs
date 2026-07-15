// Shared diff-review import service. codex-review-imports and claude-review-imports
// were byte-for-byte identical apart from the agent name, the finding-id prefix,
// and the collection key — the same normalize-and-store logic maintained in two
// places. This is the one implementation; the two per-agent factories are thin
// specs over it, so a fix (e.g. a normalization rule) can no longer land in only
// one of them.

import { makeRunTx } from "../runtime/store/run-tx.mjs";

const MAX_REVIEW_FINDINGS = 1000;
const MAX_FINDINGS_PER_REVIEW = 1000;

/**
 * @param {object} deps { state, now, nextId, appendEvent, persistStateSoon }
 * @param {object} spec { source, label, tool, collection, idPrefix, isGovernedAgent }
 *   - source: the output.source / record.source discriminator ("codex" | "claude")
 *   - label: human word for events/messages ("Codex" | "Claude")
 *   - tool: the tool contract name (e.g. "claude.review.diff")
 *   - collection: the state array key (e.g. "claudeReviewFindings")
 *   - idPrefix: nextId prefix (e.g. "clf_demo")
 *   - isGovernedAgent: the governed-agent identity gate for this tool
 */
export function createReviewImportService({ state, now, nextId, appendEvent, persistStateSoon = () => {}, store }, spec) {
  const runTx = makeRunTx({ store, persistStateSoon });
  function recordReviewFindings({ invocation, result, agent }) {
    if (!spec.isGovernedAgent(agent) || !isReviewResult(result, spec)) {
      return [];
    }
    const allFindings = normalizeFindings(result.output.findings);
    const droppedFindingCount = Math.max(0, allFindings.length - MAX_FINDINGS_PER_REVIEW);
    const findings = allFindings.slice(0, MAX_FINDINGS_PER_REVIEW);
    if (!findings.length) {
      return [];
    }
    const createdAt = now();
    const records = findings.map((finding, index) => ({
      id: nextId(spec.idPrefix),
      source: spec.source,
      reviewInvocationId: invocation.id,
      invocationId: invocation.id,
      projectId: invocation.projectId ?? invocation.options?.metadata?.projectId ?? null,
      worktreeId: invocation.worktreeId ?? invocation.options?.metadata?.worktreeId ?? null,
      requestedBy: invocation.requestedBy ?? null,
      agentId: invocation.agentId ?? null,
      reviewAgentName: agent?.name ?? null,
      tool: spec.tool,
      mode: String(result.output.mode ?? "diff-review"),
      severityFloor: stringOrNull(result.output.severityFloor),
      summary: stringOrNull(result.output.summary ?? result.summary),
      findingIndex: index,
      severity: finding.severity,
      file: finding.file,
      line: finding.line,
      message: finding.message,
      suggestion: finding.suggestion,
      confidence: finding.confidence,
      authoritative: false,
      raw: finding.raw,
      createdAt,
    }));
    runTx(() => {
      state[spec.collection].unshift(...records);
      state[spec.collection] = state[spec.collection].slice(0, MAX_REVIEW_FINDINGS);
      appendEvent({
        invocationId: invocation.id,
        type: `${spec.source}_review_findings_recorded`,
        level: "info",
        message: `Imported ${records.length} ${spec.label} review finding(s).`,
        data: {
          [`${spec.source}ReviewFindingIds`]: records.map((record) => record.id),
          tool: spec.tool,
          authoritative: false,
          droppedFindingCount,
        },
      });
    });
    return records;
  }

  return { recordReviewFindings };
}

function isReviewResult(result, spec) {
  return result?.output?.source === spec.source
    && result.output.tool === spec.tool
    && !result.output.error;
}

function normalizeFindings(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      severity: enumValue(item.severity, "medium", ["low", "medium", "high"]),
      file: stringOrNull(item.file),
      line: positiveIntegerOrNull(item.line),
      message: stringOrNull(item.message),
      suggestion: stringOrNull(item.suggestion),
      confidence: enumValue(item.confidence, "medium", ["low", "medium", "high"]),
      raw: item,
    }))
    .filter((item) => item.file && item.message);
}

function enumValue(value, fallback, allowed) {
  const text = String(value ?? fallback).trim();
  return allowed.includes(text) ? text : fallback;
}

function stringOrNull(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function positiveIntegerOrNull(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}
