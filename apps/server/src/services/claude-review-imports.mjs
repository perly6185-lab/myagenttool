import { isGovernedClaudeReviewAgent } from "./claude-agent.mjs";

const MAX_CLAUDE_REVIEW_FINDINGS = 1000;
const MAX_FINDINGS_PER_REVIEW = 1000;

export function createClaudeReviewImportService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon = () => {},
}) {
  function recordClaudeReviewFindings({ invocation, result, agent }) {
    if (!isGovernedClaudeReviewAgent(agent) || !isClaudeReviewResult(result)) {
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
      id: nextId("clf_demo"),
      source: "claude",
      reviewInvocationId: invocation.id,
      invocationId: invocation.id,
      projectId: invocation.projectId ?? invocation.options?.metadata?.projectId ?? null,
      worktreeId: invocation.worktreeId ?? invocation.options?.metadata?.worktreeId ?? null,
      requestedBy: invocation.requestedBy ?? null,
      agentId: invocation.agentId ?? null,
      reviewAgentName: agent?.name ?? null,
      tool: "claude.review.diff",
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
    state.claudeReviewFindings.unshift(...records);
    state.claudeReviewFindings = state.claudeReviewFindings.slice(0, MAX_CLAUDE_REVIEW_FINDINGS);
    appendEvent({
      invocationId: invocation.id,
      type: "claude_review_findings_recorded",
      level: "info",
      message: `Imported ${records.length} Claude review finding(s).`,
      data: {
        claudeReviewFindingIds: records.map((record) => record.id),
        tool: "claude.review.diff",
        authoritative: false,
        droppedFindingCount,
      },
    });
    persistStateSoon();
    return records;
  }

  return { recordClaudeReviewFindings };
}

function isClaudeReviewResult(result) {
  return result?.output?.source === "claude"
    && result.output.tool === "claude.review.diff"
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
