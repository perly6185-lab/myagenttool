import { PM_BRIEF_SCHEMA } from "./config.mjs";
import {
  normalizeProductFlow,
  stringArrayOr,
} from "./formatters.mjs";
import {
  labelsFromProjectFields,
  normalizeLabelValue,
} from "./pm-helpers.mjs";

const issueTreeContext = {};

export function configureIssueTreeContext(context) {
  Object.assign(issueTreeContext, context);
}

function dep(name) {
  const value = issueTreeContext[name];
  if (!value) throw new Error(`Issue tree dependency ${name} has not been configured.`);
  return value;
}

export async function loadPmBriefForIssueTree(args) {
  const option = dep("option");
  const briefFile = option(args, "--brief-file");
  if (briefFile) {
    const content = dep("readRepoFile")(briefFile);
    try {
      return normalizePmBrief(JSON.parse(content));
    } catch {
      return normalizePmBrief(parsePmBriefMarkdown(content));
    }
  }

  const idea = option(args, "--idea");
  if (!idea) dep("fail")("Missing --idea or --brief-file.");
  const brief = await dep("runStructuredAgent")({
    args,
    agentName: "pm-brief",
    schema: PM_BRIEF_SCHEMA,
    systemPrompt: [
      "You are the MyAgentTool PM agent.",
      "Turn plain-language ideas into milestone-aligned, non-professional-first engineering slices.",
      "Prefer M0 unless the idea clearly requires billing, lifecycle automation, distribution, or later roadmap work.",
      "Do not hide security, data, cost, release, or local execution risk.",
      "For UI, workflow, or user-facing work, include productFlow using docs/design/PRODUCT_FLOWS.md; otherwise mark it Not applicable.",
      "Return only JSON that matches the schema.",
    ].join("\n"),
    userPrompt: [
      `Idea:\n${idea}`,
      dep("docsContext")(["docs/vision/PRODUCT.md", "docs/engineering/FULL_FLOW_AI_DELIVERY.md", "docs/engineering/PM_DESIGN_SKILLS.md", "docs/design/PRODUCT_FLOWS.md"]),
    ].join("\n\n"),
  });
  return normalizePmBrief(brief);
}

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

function parsePmBriefMarkdown(content) {
  return {
    outcome: markdownSection(content, "Outcome") || markdownSection(content, "Plain-language Outcome"),
    primaryUser: markdownSection(content, "Primary User"),
    problem: markdownSection(content, "Problem"),
    userStory: markdownSection(content, "User Story"),
    nonGoals: markdownListSection(content, "Non-goals"),
    acceptanceCriteria: markdownChecklistSection(content, "Acceptance Criteria"),
    riskFlags: markdownListSection(content, "Risk Flags"),
    issueTitle: (content.match(/Title:\s*(.+)/i)?.[1] ?? "").trim(),
    suggestedLabels: markdownListAfter(content, "Labels:"),
    openQuestions: markdownListSection(content, "Open Questions"),
    productFlow: parseProductFlowFromText(content),
    projectFields: parseProjectFieldsFromText(content),
  };
}

export function issueTreeFromBrief(brief) {
  const normalized = normalizePmBrief(brief);
  const labels = mergeGovernanceLabels(normalized.suggestedLabels, normalized.projectFields);
  const rootIssue = {
    role: "root",
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
  return {
    version: "2026-06-19",
    mode: "dry-run",
    source: "pm-brief",
    issues: [rootIssue],
    governance: {
      dryRunDefault: true,
      applyRequiresExplicitFlag: true,
      humanApprovalProvided: false,
      humanApprovalEvidence: "",
      humanApprovalRequiredFor: ["roadmap-changing work", "security", "billing", "local execution", "release"],
      followUp: ["Run pnpm github:check:issues.", "Run sync-project-fields dry-run before moving issues to ready."],
    },
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

function mergeGovernanceLabels(labels, fields) {
  const governancePrefixes = ["type/", "status/", "area/", "risk/", "acceptance/", "platform/", "agent/", "priority/"];
  const customLabels = labels.filter((label) => !governancePrefixes.some((prefix) => label.startsWith(prefix)));
  return [...labelsFromProjectFields(fields), ...customLabels];
}

export function validateIssueTreeForApply(tree, humanApproval = "") {
  const failures = issueTreeApplyFailures(tree, humanApproval);
  if (failures.length > 0) {
    dep("fail")(`Issue tree is not safe to apply:\n${failures.map((failure) => `  - ${failure}`).join("\n")}`);
  }
}

export function issueTreeApplyFailures(tree, humanApproval = "") {
  const failures = [];
  const approvalReasons = humanApprovalRequiredReasons(tree);
  const approvalEvidence = String(humanApproval || tree.governance?.humanApprovalEvidence || "").trim();
  for (const issueSpec of tree.issues) {
    if (!issueSpec.title || issueSpec.title.includes("TODO")) failures.push(`${issueSpec.title || "(untitled)"}: title is missing or TODO`);
    if (!issueSpec.milestone) failures.push(`${issueSpec.title}: milestone is missing`);
    if (!issueSpec.acceptanceCriteria.length) failures.push(`${issueSpec.title}: acceptance criteria are missing`);
    if (requiresConcreteProductFlowForIssue(issueSpec) && !hasConcreteProductFlow(issueSpec.productFlow)) {
      failures.push(`${issueSpec.title}: UI/workflow issue requires concrete Product Flow from docs/design/PRODUCT_FLOWS.md`);
    }
    for (const group of ["type/", "status/", "area/", "risk/", "acceptance/", "platform/", "agent/"]) {
      if (!issueSpec.labels.some((label) => label.startsWith(group))) {
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

function normalizeIssueTitle(title, type) {
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

function markdownSection(content, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?:\\n##\\s+|$)`, "i"));
  return match?.[1]?.trim() ?? "";
}

function markdownListSection(content, heading) {
  return markdownSection(content, heading)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*-\s+/, "").trim())
    .filter(Boolean);
}

function markdownChecklistSection(content, heading) {
  return markdownSection(content, heading)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*-\s+\[[ x]\]\s+/i, "").replace(/^\s*-\s+/, "").trim())
    .filter(Boolean);
}

function markdownListAfter(content, marker) {
  const index = content.indexOf(marker);
  if (index === -1) return [];
  return content
    .slice(index + marker.length)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*-\s+/, "").trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("##"));
}

function parseProjectFieldsFromText(content) {
  const fields = {};
  const section = markdownSection(content, "Project Fields");
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z ]+):\s*(.+?)\s*$/);
    if (!match) continue;
    const rawKey = match[1].trim().toLowerCase();
    const key = rawKey === "agent target" ? "agentTarget" : rawKey === "source doc" ? "sourceDoc" : rawKey.replace(/\s+([a-z])/g, (_, letter) => letter.toUpperCase());
    fields[key] = match[2].trim();
  }
  return fields;
}

function parseProductFlowFromText(content) {
  const fields = {};
  const section = markdownSection(content, "Product Flow");
  const keyMap = {
    "role flow": "roleFlow",
    scenario: "scenario",
    frequency: "frequency",
    "owner surface": "ownerSurface",
    "usability task": "usabilityTask",
    "what not to show": "whatNotToShow",
    "partial acceptance or follow-up": "partialAcceptanceOrFollowUp",
  };
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^\s*-?\s*([A-Za-z ]+(?:or follow-up)?):\s*(.+?)\s*$/);
    if (!match) continue;
    const key = keyMap[match[1].trim().toLowerCase()];
    if (key) fields[key] = match[2].trim();
  }
  return fields;
}
