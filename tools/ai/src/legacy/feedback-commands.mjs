import {
  inferArea,
  inferPlatform,
  inferRiskFlags,
  labelsFromProjectFields,
  targetToType,
} from "./pm-helpers.mjs";

const feedbackCommandsContext = {};

export function configureFeedbackCommandsContext(context) {
  Object.assign(feedbackCommandsContext, context);
}

function dep(name) {
  const value = feedbackCommandsContext[name];
  if (!value) throw new Error(`Feedback command dependency ${name} has not been configured.`);
  return value;
}

export function feedbackConvert(args) {
  const option = dep("option");
  const fail = dep("fail");
  const writeOrPrint = dep("writeOrPrint");
  const feedback = option(args, "--feedback");
  const target = option(args, "--target") ?? "needs investigation";
  if (!feedback) fail("Missing --feedback.");

  const type = targetToType(target);
  const area = inferArea(feedback);
  const platform = inferPlatform(feedback);
  const riskFlags = inferRiskFlags(feedback);
  const risk = target === "risk" || riskFlags.length > 0 ? "high" : "medium";
  const titlePrefix = type === "bug" ? "[Bug]" : type === "risk" ? "[Risk]" : "[Task]";
  const brief = feedbackBrief({ feedback, type, area, platform, risk, riskFlags, titlePrefix });

  if (args.includes("--issue-tree") || args.includes("--json")) {
    const content = `${JSON.stringify(brief, null, 2)}\n`;
    writeOrPrint(content, option(args, "--out"));
    return;
  }

  const draft = `# Feedback Conversion Draft

## Suggested Issue Title

${titlePrefix}: TODO short title from feedback

## Suggested Labels

- type/${type}
- status/backlog
- area/${area}
- risk/${risk}
- acceptance/not-defined
- platform/${platform}
- agent/platform

## Issue Body

## Feedback

${feedback}

## Triage

- Target: ${target}
- User outcome: TODO
- Evidence: TODO

## Acceptance

- [ ] TODO

## Project Fields

Milestone: M0
Area: ${area}
Type: ${type}
Status: backlog
Risk: ${risk}
Acceptance: not defined
Platform: ${platform}
Agent Target: platform
Priority: p2
Source Doc: docs/engineering/FULL_FLOW_AI_DELIVERY.md

## Issue Tree Handoff

To create a governed issue dry-run from this feedback, run:

\`\`\`text
pnpm ai:feedback -- --feedback "..." --target ${target} --issue-tree --out .myagenttool/runs/feedback-brief.json
pnpm ai:issue-tree -- --brief-file .myagenttool/runs/feedback-brief.json --repo OWNER/REPO
\`\`\`
`;

  writeOrPrint(draft, option(args, "--out"));
}

function feedbackBrief({ feedback, type, area, platform, risk, riskFlags, titlePrefix }) {
  const acceptance = type === "bug"
    ? ["A reproduction or evidence note is recorded.", "The expected user outcome is restored or a follow-up risk is filed."]
    : type === "risk"
      ? ["Risk impact and likelihood are recorded.", "A mitigation or explicit owner decision is documented."]
      : ["The feedback is converted into a milestone-aligned follow-up with clear acceptance criteria."];
  return {
    outcome: "Convert release, demo, support, or user feedback into tracked follow-up work.",
    primaryUser: "Reviewer or operator triaging feedback after a release or demo.",
    problem: feedback,
    userStory: "As a reviewer, I want feedback to become traceable work so that release learning is not lost.",
    nonGoals: ["Do not silently change roadmap scope without review.", "Do not collect telemetry beyond approved pre-launch signals."],
    acceptanceCriteria: acceptance,
    riskFlags: riskFlags.length > 0 ? riskFlags : ["Review whether the feedback implies user-visible confusion, rollback needs, or support risk."],
    projectFields: {
      milestone: "M0",
      area,
      type,
      status: "backlog",
      risk,
      acceptance: "defined",
      platform,
      agentTarget: "platform",
      priority: type === "bug" || type === "risk" ? "p1" : "p2",
      sourceDoc: "docs/engineering/FULL_FLOW_AI_DELIVERY.md",
    },
    issueTitle: `${titlePrefix}: TODO short title from feedback`,
    suggestedLabels: labelsFromProjectFields({
      milestone: "M0",
      area,
      type,
      status: "backlog",
      risk,
      acceptance: "defined",
      platform,
      agentTarget: "platform",
      priority: type === "bug" || type === "risk" ? "p1" : "p2",
      sourceDoc: "docs/engineering/FULL_FLOW_AI_DELIVERY.md",
    }),
    openQuestions: ["What evidence confirms this feedback?", "Should this be fixed before the next release or tracked as a later follow-up?"],
  };
}
