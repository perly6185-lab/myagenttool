import {
  CODE_PLAN_SCHEMA,
  PM_BRIEF_SCHEMA,
} from "./config.mjs";

const pmCommandsContext = {};

export function configurePmCommandsContext(context) {
  Object.assign(pmCommandsContext, context);
}

function dep(name) {
  const value = pmCommandsContext[name];
  if (!value) throw new Error(`PM command dependency ${name} has not been configured.`);
  return value;
}

export function intakeBrief(args) {
  const option = dep("option");
  const fail = dep("fail");
  const writeOrPrint = dep("writeOrPrint");
  const idea = option(args, "--idea");
  if (!idea) fail("Missing --idea.");

  const out = option(args, "--out");
  const now = new Date().toISOString();
  const riskFlags = dep("inferRiskFlags")(idea);
  const area = dep("inferArea")(idea);
  const platform = dep("inferPlatform")(idea);

  const brief = `# AI Intake Brief

Created: ${now}

## Raw Idea

${idea}

## Plain-language Outcome

TODO: Restate what the user wants to accomplish without internal terminology.

## Primary User

Non-professional user first. Professional controls should stay secondary unless
this idea is explicitly for operators or developers.

## Suggested Slice

- Milestone: M0 unless this clearly depends on later lifecycle/billing work.
- Area: ${area}
- Platform: ${platform}
- Agent Target: platform
- Risk: ${riskFlags.length > 0 ? "high" : "medium"}

## PM Breakdown

- Problem:
- User story:
- Non-goals:
- Acceptance criteria:
  - [ ] TODO
- UX implications:
- Security/data/cost implications:
- Open questions:

## Risk Flags

${riskFlags.length > 0 ? riskFlags.map((flag) => `- ${flag}`).join("\n") : "- No obvious high-risk keyword detected. Review manually."}

## Next Step

- [ ] Convert this brief into one or more GitHub issues.
- [ ] Link source docs from docs/vision, docs/engineering, or docs/design.
- [ ] Ask for approval before high-risk roadmap, billing, security, release, or local execution changes.
`;

  writeOrPrint(brief, out);
}

export async function pmBrief(args) {
  const option = dep("option");
  const fail = dep("fail");
  const idea = option(args, "--idea");
  if (!idea) fail("Missing --idea.");

  const result = await dep("runStructuredAgent")({
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
      dep("docsContext")(["docs/vision/PRODUCT.md", "docs/engineering/FULL_FLOW_AI_DELIVERY.md", "docs/design/MYAGENTTOOL_DESIGN.md", "docs/design/PRODUCT_FLOWS.md"]),
    ].join("\n\n"),
  });

  dep("writeStructuredResult")(result, dep("formatPmBrief")(result), args);
}

export async function issueTree(args) {
  const option = dep("option");
  const fail = dep("fail");
  const defaultRepo = dep("defaultRepo");
  const writeOrPrint = dep("writeOrPrint");
  const apply = args.includes("--apply");
  const repo = option(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? defaultRepo();
  const brief = await dep("loadPmBriefForIssueTree")(args);
  const humanApproval = option(args, "--human-approved") ?? process.env.MYAGENTTOOL_HUMAN_APPROVED ?? "";
  const tree = dep("issueTreeWithHumanApproval")(dep("issueTreeFromBrief")(brief), humanApproval);
  const out = option(args, "--out");

  if (!apply) {
    const content = args.includes("--json") ? `${JSON.stringify(tree, null, 2)}\n` : dep("formatIssueTree")(tree, { applied: false });
    writeOrPrint(content, out);
    return;
  }

  if (!repo) fail("Cannot apply issue tree without --repo or GITHUB_REPOSITORY.");
  dep("validateIssueTreeForApply")(tree, humanApproval);

  const created = [];
  for (const issueSpec of tree.issues) {
    const body = dep("formatIssueBody")(issueSpec, created[0]?.number);
    const argsForGh = ["issue", "create", "--repo", repo, "--title", issueSpec.title, "--body", body];
    for (const label of issueSpec.labels) argsForGh.push("--label", label);
    if (issueSpec.milestone) argsForGh.push("--milestone", issueSpec.milestone);
    const output = dep("gh")(argsForGh).stdout.trim();
    const number = Number(output.match(/\/issues\/(\d+)/)?.[1] ?? 0);
    created.push({ title: issueSpec.title, url: output, number });
  }

  const appliedTree = { ...tree, applied: true, created };
  const content = args.includes("--json") ? `${JSON.stringify(appliedTree, null, 2)}\n` : dep("formatIssueTree")(appliedTree, { applied: true });
  writeOrPrint(content, out);
}

export function branchPlan(args) {
  const option = dep("option");
  const fail = dep("fail");
  const writeOrPrint = dep("writeOrPrint");
  const issue = option(args, "--issue");
  const title = option(args, "--title");
  const kind = option(args, "--kind") ?? "feat";
  if (!issue) fail("Missing --issue.");
  if (!title) fail("Missing --title.");

  const branch = dep("buildBranchName")(issue, title, kind);
  const plan = `# Branch Plan

## Branch

${branch}

## Commands

\`\`\`text
git fetch origin
git switch main
git pull --ff-only
git switch -c ${branch}
\`\`\`

## PR Linkage

- Source issue: #${issue}
- PR body should include: Closes #${issue}

## Scope Reminder

- Keep changes tied to #${issue}.
- Create follow-up issues for discovered work outside this branch.
- Run repository checks before opening PR.
`;

  writeOrPrint(plan, option(args, "--out"));
}

export async function codePlanCommand(args) {
  const plan = await dep("createCodePlan")(args);
  dep("writeStructuredResult")(plan, dep("formatCodePlan")(plan), args);
}

export async function createCodePlan(args) {
  const option = dep("option");
  const fail = dep("fail");
  const issue = option(args, "--issue");
  if (!issue) fail("Missing --issue.");

  const repo = option(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? dep("defaultRepo")();
  const fallbackTitle = option(args, "--title") ?? `Issue ${issue}`;
  const issueContext = dep("readIssueContext")(repo, issue, fallbackTitle);
  const branch = dep("buildBranchName")(issue, issueContext.title, option(args, "--kind") ?? "feat");

  return dep("runStructuredAgent")({
    args,
    agentName: "code-plan",
    schema: CODE_PLAN_SCHEMA,
    systemPrompt: [
      "You are the MyAgentTool coding orchestration agent.",
      "Create a scoped implementation plan from one GitHub issue.",
      "Prefer small changes, existing repo patterns, and explicit verification commands.",
      "For UI, workflow, or user-facing work, bind the code plan to Product Flow: role, scenario, owner surface, prototype states, what not to show, and visual QA tasks.",
      "Do not use Not applicable or product-flow triage placeholders for product-facing UI/workflow changes.",
      "Do not invent files that conflict with the current workspace.",
      "Return only JSON that matches the schema.",
    ].join("\n"),
    userPrompt: [
      `Repository files:\n${dep("repoFileList")()}`,
      `Expected branch:\n${branch}`,
      `Issue title:\n${issueContext.title}`,
      `Issue body:\n${dep("truncate")(issueContext.body, 20000)}`,
      dep("docsContext")([
        "docs/design/PRODUCT_FLOWS.md",
        "DESIGN.md",
        "docs/engineering/VISUAL_QA.md",
        "docs/engineering/FULL_FLOW_AI_DELIVERY.md",
        "docs/engineering/DEFINITION_OF_DONE.md",
      ]),
    ].join("\n\n"),
  });
}
