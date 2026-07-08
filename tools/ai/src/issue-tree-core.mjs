// Pure issue-tree engine — generation + governance validation, no I/O, no CLI
// deps. Shared by the `ai:issue-tree` CLI (tools/ai/src/legacy/issue-tree.mjs)
// AND the server's epic-decomposition flow (EPIC_DECOMPOSITION_PLAN.md). Keep it
// side-effect-free so the server can import it directly.

import { normalizeProductFlow, stringArrayOr } from "./legacy/formatters.mjs";
import { labelsFromProjectFields, normalizeLabelValue } from "./legacy/pm-helpers.mjs";

export function normalizePmBrief(brief) {
  const projectFields = brief.projectFields ?? {};
  return {
    outcome: brief.outcome ?? "TODO",
    primaryUser: brief.primaryUser ?? "Non-professional user first.",
    problem: brief.problem ?? "TODO",
    userStory: brief.userStory ?? "TODO",
    nonGoals: stringArrayOr(brief.nonGoals, ["No hidden local command execution.", "No production release without approval."]),
    acceptanceCriteria: stringArrayOr(brief.acceptanceCriteria, []),
    riskFlags: stringArrayOr(brief.riskFlags, ["Review security, data, cost, local execution, and release impact manually."]),
    issueTitle: brief.issueTitle ?? "[Task]: TODO",
    suggestedLabels: stringArrayOr(brief.suggestedLabels, []),
    openQuestions: stringArrayOr(brief.openQuestions, []),
    productFlow: normalizeProductFlow(brief.productFlow),
    projectFields: {
      milestone: projectFields.milestone ?? "M0",
      area: projectFields.area ?? "cross-cutting",
      type: projectFields.type ?? "task",
      status: "backlog",
      risk: projectFields.risk ?? "medium",
      acceptance: projectFields.acceptance ?? "defined",
      platform: projectFields.platform ?? "all",
      agentTarget: projectFields.agentTarget ?? "platform",
      priority: projectFields.priority ?? "p1",
      sourceDoc: projectFields.sourceDoc ?? "docs/engineering/FULL_FLOW_AI_DELIVERY.md",
    },
  };
}

// One governed issue spec from a (partial) brief. `role` distinguishes the single
// root of a PM brief from a child of a decomposition — the shape is identical so
// the same validation applies to both.
export function issueSpecFromBrief(brief, role = "root") {
  const normalized = normalizePmBrief(brief);
  const labels = mergeGovernanceLabels(normalized.suggestedLabels, normalized.projectFields);
  return {
    role,
    title: normalizeIssueTitle(normalized.issueTitle, normalized.projectFields.type),
    outcome: normalized.outcome,
    primaryUser: normalized.primaryUser,
    problem: normalized.problem,
    userStory: normalized.userStory,
    nonGoals: normalized.nonGoals,
    acceptanceCriteria: normalized.acceptanceCriteria,
    riskFlags: normalized.riskFlags,
    openQuestions: normalized.openQuestions,
    productFlow: normalized.productFlow,
    labels,
    milestone: normalized.projectFields.milestone,
    projectFields: normalized.projectFields,
    sourceDoc: normalized.projectFields.sourceDoc,
  };
}

function treeGovernance() {
  return {
    dryRunDefault: true,
    applyRequiresExplicitFlag: true,
    humanApprovalProvided: false,
    humanApprovalEvidence: "",
    humanApprovalRequiredFor: ["roadmap-changing work", "security", "billing", "local execution", "release"],
    followUp: ["Run pnpm github:check:issues.", "Run sync-project-fields dry-run before moving issues to ready."],
  };
}

export function issueTreeFromBrief(brief) {
  return {
    version: "2026-06-19",
    mode: "dry-run",
    source: "pm-brief",
    issues: [issueSpecFromBrief(brief, "root")],
    governance: treeGovernance(),
  };
}

// Epic/initiative decomposition: N governed child specs under a parent. Each child
// is a (partial) brief; the same normalization + governance validation as a root
// issue applies to every child (issueTreeApplyFailures loops over tree.issues).
export function decompositionTree({ parentLink = null, children = [] } = {}) {
  const issues = (Array.isArray(children) ? children : []).map((child) => issueSpecFromBrief(child, "child"));
  return {
    version: "2026-06-19",
    mode: "dry-run",
    source: "decomposition",
    parent: parentLink ? { number: parentLink.number ?? null, title: parentLink.title ?? null } : null,
    issues,
    governance: treeGovernance(),
  };
}

export function issueTreeWithHumanApproval(tree, humanApproval) {
  const evidence = String(humanApproval ?? "").trim();
  if (!evidence) return tree;
  return {
    ...tree,
    governance: {
      ...tree.governance,
      humanApprovalProvided: true,
      humanApprovalEvidence: evidence,
    },
    issues: tree.issues.map((issueSpec) => ({
      ...issueSpec,
      humanApproval: evidence,
    })),
  };
}

export function mergeGovernanceLabels(labels, fields) {
  const governancePrefixes = ["type/", "status/", "area/", "risk/", "acceptance/", "platform/", "agent/", "priority/"];
  const customLabels = labels.filter((label) => !governancePrefixes.some((prefix) => label.startsWith(prefix)));
  return [...labelsFromProjectFields(fields), ...customLabels];
}

export function issueTreeApplyFailures(tree, humanApproval = "") {
  const failures = [];
  const approvalReasons = humanApprovalRequiredReasons(tree);
  const approvalEvidence = String(humanApproval || tree.governance?.humanApprovalEvidence || "").trim();
  for (const issueSpec of tree.issues ?? []) {
    if (!issueSpec.title || issueSpec.title.includes("TODO")) failures.push(`${issueSpec.title || "(untitled)"}: title is missing or TODO`);
    if (!issueSpec.milestone) failures.push(`${issueSpec.title}: milestone is missing`);
    if (!issueSpec.acceptanceCriteria?.length) failures.push(`${issueSpec.title}: acceptance criteria are missing`);
    if (requiresConcreteProductFlowForIssue(issueSpec) && !hasConcreteProductFlow(issueSpec.productFlow)) {
      failures.push(`${issueSpec.title}: UI/workflow issue requires concrete Product Flow from docs/design/PRODUCT_FLOWS.md`);
    }
    for (const group of ["type/", "status/", "area/", "risk/", "acceptance/", "platform/", "agent/"]) {
      if (!(issueSpec.labels ?? []).some((label) => label.startsWith(group))) {
        failures.push(`${issueSpec.title}: missing ${group} label`);
      }
    }
  }
  if (approvalReasons.length > 0 && !approvalEvidence) {
    failures.push(`human approval is required for ${approvalReasons.join(", ")}; pass --human-approved "approval reason" or set MYAGENTTOOL_HUMAN_APPROVED`);
  }
  return failures;
}

export function humanApprovalRequiredReasons(tree) {
  const reasons = new Set();
  for (const issueSpec of tree.issues ?? []) {
    const labels = issueSpec.labels ?? [];
    const fields = issueSpec.projectFields ?? {};
    const text = [
      issueSpec.title,
      issueSpec.outcome,
      issueSpec.problem,
      issueSpec.userStory,
      ...(issueSpec.riskFlags ?? []),
      ...(issueSpec.nonGoals ?? []),
      fields.area,
      fields.type,
      fields.risk,
      fields.sourceDoc,
      ...labels,
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();

    if (labels.some((label) => ["risk/high", "risk/critical"].includes(label)) || ["high", "critical"].includes(normalizeLabelValue(fields.risk))) {
      reasons.add("high-risk work");
    }
    if (/security|auth|credential|secret|permission|privacy|data retention|data-retention/.test(text)) reasons.add("security or data/privacy impact");
    if (/billing|cost|quota|settlement|chargeback|payment/.test(text)) reasons.add("billing or cost impact");
    if (/local execution|local-execution|desktop|process execution|child process|subprocess|shell|command execution|cancellation/.test(text)) reasons.add("local execution impact");
    if (/release|deploy|deployment|rollback|production/.test(text)) reasons.add("release or deploy impact");
    if (/roadmap|initiative|milestone|lifecycle|distribution/.test(text)) reasons.add("roadmap-changing work");
  }
  return [...reasons];
}

export function normalizeIssueTitle(title, type) {
  if (!title || title === "TODO") {
    const prefix = type === "risk" ? "[Risk]" : type === "adr" ? "[ADR]" : type === "epic" ? "[Epic]" : "[Task]";
    return `${prefix}: TODO`;
  }
  return title;
}

function requiresConcreteProductFlowForIssue(issueSpec) {
  const fields = issueSpec.projectFields ?? {};
  const text = [
    issueSpec.title,
    issueSpec.outcome,
    issueSpec.problem,
    issueSpec.userStory,
    fields.area,
    fields.platform,
    fields.sourceDoc,
    ...(issueSpec.labels ?? []),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return /\b(web|ui|ux|workflow|user-facing|console|homepage|visual|design)\b/.test(text)
    || String(fields.sourceDoc ?? "").startsWith("docs/design/")
    || ["web"].includes(normalizeLabelValue(fields.area))
    || ["web"].includes(normalizeLabelValue(fields.platform));
}

function hasConcreteProductFlow(productFlow) {
  const flow = normalizeProductFlow(productFlow);
  return [
    flow.roleFlow,
    flow.scenario,
    flow.frequency,
    flow.ownerSurface,
    flow.usabilityTask,
    flow.whatNotToShow,
    flow.partialAcceptanceOrFollowUp,
  ].every((value) => !isPlaceholderProductFlowValue(value));
}

function isPlaceholderProductFlowValue(value) {
  return /not applicable|requires product-flow triage|update if|must cite docs\/design\/product_flows|todo|n\/a/i.test(String(value ?? ""));
}
