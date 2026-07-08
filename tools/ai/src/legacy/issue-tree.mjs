import { PM_BRIEF_SCHEMA } from "./config.mjs";
import {
  issueTreeApplyFailures,
  issueTreeFromBrief,
  issueTreeWithHumanApproval,
  humanApprovalRequiredReasons,
  normalizePmBrief,
} from "../issue-tree-core.mjs";

// The pure generation + governance engine moved to ../issue-tree-core.mjs so the
// server can import it (EPIC_DECOMPOSITION_PLAN.md). This CLI shim keeps the I/O
// bits (brief loading) and the throwing validate wrapper, and re-exports the pure
// surface for existing callers.
export {
  issueTreeApplyFailures,
  issueTreeFromBrief,
  issueTreeWithHumanApproval,
  humanApprovalRequiredReasons,
  normalizePmBrief,
};

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

// Throwing wrapper over the pure issueTreeApplyFailures (which the server uses
// directly). The CLI wants a hard fail; the server wants the failure list.
export function validateIssueTreeForApply(tree, humanApproval = "") {
  const failures = issueTreeApplyFailures(tree, humanApproval);
  if (failures.length > 0) {
    dep("fail")(`Issue tree is not safe to apply:\n${failures.map((failure) => `  - ${failure}`).join("\n")}`);
  }
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
