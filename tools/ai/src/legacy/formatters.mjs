export function formatIssueTree(tree, { applied }) {
  const created = tree.created ?? [];
  return `# AI Issue Tree ${applied ? "Apply Result" : "Dry Run"}

Generated: ${new Date().toISOString()}
Version: ${tree.version}

## Issues

${tree.issues.map((issueSpec, index) => formatIssueTreeItem(issueSpec, created[index])).join("\n\n")}

## Governance

- Dry-run by default: yes
- Apply requires explicit flag: yes
- Human approval required for: ${tree.governance.humanApprovalRequiredFor.join(", ")}
- Human approval provided: ${tree.governance.humanApprovalProvided ? "yes" : "no"}
${tree.governance.humanApprovalEvidence ? `- Human approval evidence: ${tree.governance.humanApprovalEvidence}` : ""}

## Follow-up Checks

${list(tree.governance.followUp)}
`;
}

function formatIssueTreeItem(issueSpec, created) {
  return `### ${issueSpec.title}

${created ? `Created: ${created.url}\n` : ""}Labels: ${issueSpec.labels.join(", ")}
Milestone: ${issueSpec.milestone}
Source Doc: ${issueSpec.sourceDoc}

${formatIssueBody(issueSpec, undefined)}`;
}

export function formatIssueBody(issueSpec, parentNumber) {
  return `${parentNumber ? `## Parent\n#${parentNumber}\n\n` : ""}## Outcome
${issueSpec.outcome}

## Primary User
${issueSpec.primaryUser}

## Problem
${issueSpec.problem}

## User Story
${issueSpec.userStory}

## Non-goals
${list(issueSpec.nonGoals)}

## Acceptance
${checklist(issueSpec.acceptanceCriteria)}

## Product Flow
${formatProductFlow(issueSpec.productFlow)}

## Risk Flags
${list(issueSpec.riskFlags)}

## Human Approval
${issueSpec.humanApproval ? issueSpec.humanApproval : "Not recorded. Required before apply for high-risk, security/data, billing/cost, local execution, roadmap, or release/deploy work."}

## Open Questions
${list(issueSpec.openQuestions)}

## Project Fields
${formatProjectFields(issueSpec.projectFields)}
`;
}

export function formatPmBrief(brief) {
  return `# Model-backed PM Brief

## Outcome

${brief.outcome}

## Primary User

${brief.primaryUser}

## Problem

${brief.problem}

## User Story

${brief.userStory}

## Non-goals

${list(brief.nonGoals)}

## Acceptance Criteria

${checklist(brief.acceptanceCriteria)}

## Risk Flags

${list(brief.riskFlags)}

## Suggested Issue

Title: ${brief.issueTitle ?? "TODO"}

Labels:
${list(brief.suggestedLabels ?? [])}

## Project Fields

${formatProjectFields(brief.projectFields)}

## Product Flow

${formatProductFlow(normalizeProductFlow(brief.productFlow))}

## Open Questions

${list(brief.openQuestions)}
`;
}

export function formatCodePlan(plan) {
  return `# AI Code Plan

## Branch

${plan.branch}

## Summary

${plan.summary}

## Product Flow

${formatProductFlow(plan.productFlow)}

## Affected Surfaces

${list(plan.affectedSurfaces ?? [])}

## Prototype States

${list(plan.prototypeStates ?? [])}

## Acceptance Signals

${list(plan.acceptanceSignals ?? [])}

## What Not To Show

${list(plan.whatNotToShow ?? [])}

## Visual QA Tasks

${list(plan.visualQaTasks ?? [])}

## Files To Touch

${list(plan.filesToTouch)}

## Steps

${orderedList(plan.steps)}

## Verification Commands

${list(plan.commands)}

## Risks

${list(plan.risks)}

## Follow-up Issues

${list(plan.followUpIssues)}

## PR Summary

${plan.prSummary}
`;
}

export function formatReview(review) {
  const findings =
    review.findings.length === 0
      ? "- No blocking findings reported by the AI reviewer."
      : review.findings
          .map((finding) => `- ${finding.severity}: ${finding.file}:${finding.line} ${finding.title}\n  Rationale: ${finding.rationale}\n  Recommendation: ${finding.recommendation}`)
          .join("\n");

  return `# AI Review

## Findings

${findings}

## Summary

${review.summary}

## Verification Gaps

${list(review.verificationGaps)}

## Risk Gates

${list(review.riskGates)}

## Approval Signal

${review.approve ? "AI reviewer sees no blocking issue, but human approval is still required." : "AI reviewer does not approve automatic merge."}
`;
}

export function formatCodingAdapterContract(contract) {
  return `# Trusted Coding Adapter Contract

Version: ${contract.version}

## Adapter

- Name: ${contract.adapter.name}
- Label: ${contract.adapter.label}
- Kind: ${contract.adapter.kind}
- Command environment: ${contract.adapter.commandEnv ?? "none"}

## Required Inputs

${list(contract.requiredInputs)}

## Required Evidence

${list(contract.requiredEvidence)}

## Safety Rules

${list(contract.safetyRules)}

## Environment

${Object.entries(contract.environment)
  .map(([name, value]) => `- ${name}: ${value}`)
  .join("\n")}
`;
}

export function formatProjectFields(fields) {
  if (!fields) return "TODO";
  return [
    `Milestone: ${fields.milestone}`,
    `Area: ${fields.area}`,
    `Type: ${fields.type}`,
    `Status: ${fields.status}`,
    `Risk: ${fields.risk}`,
    `Acceptance: ${fields.acceptance}`,
    `Platform: ${fields.platform}`,
    `Agent Target: ${fields.agentTarget}`,
    `Priority: ${fields.priority}`,
    `Source Doc: ${fields.sourceDoc}`,
  ].join("\n");
}

export function normalizeProductFlow(productFlow) {
  const flow = productFlow && typeof productFlow === "object" ? productFlow : {};
  return {
    roleFlow: stringOr(flow.roleFlow, "Not applicable or requires product-flow triage"),
    scenario: stringOr(flow.scenario, "Not applicable unless this changes UI, workflow, or user-facing behavior"),
    frequency: stringOr(flow.frequency, "Not applicable"),
    ownerSurface: stringOr(flow.ownerSurface, "Not applicable"),
    usabilityTask: stringOr(flow.usabilityTask, "Not applicable"),
    whatNotToShow: stringOr(flow.whatNotToShow, "Internal implementation details in product-facing surfaces"),
    partialAcceptanceOrFollowUp: stringOr(flow.partialAcceptanceOrFollowUp, "Product-facing changes must cite docs/design/PRODUCT_FLOWS.md before review"),
  };
}

export function formatProductFlow(productFlow) {
  const flow = normalizeProductFlow(productFlow);
  return [
    `- Role flow: ${flow.roleFlow}`,
    `- Scenario: ${flow.scenario}`,
    `- Frequency: ${flow.frequency}`,
    `- Owner surface: ${flow.ownerSurface}`,
    `- Usability task: ${flow.usabilityTask}`,
    `- What not to show: ${flow.whatNotToShow}`,
    `- Partial acceptance or follow-up: ${flow.partialAcceptanceOrFollowUp}`,
  ].join("\n");
}

export function checklist(items) {
  return items.length > 0 ? items.map((item) => `- [ ] ${item}`).join("\n") : "- [ ] TODO";
}

export function list(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None.";
}

export function orderedList(items) {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item}`).join("\n") : "1. TODO";
}

export function stringOr(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function stringArrayOr(value, fallback) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : fallback;
}
