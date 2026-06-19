#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import https from "node:https";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

const HELP = `MyAgentTool AI delivery helpers

Usage:
  node tools/ai/src/index.mjs --check
  node tools/ai/src/index.mjs intake-brief --idea "..." [--out path]
  node tools/ai/src/index.mjs pm-brief|pm-agent --idea "..." --provider openai|command|mock [--out path] [--json]
  node tools/ai/src/index.mjs issue-tree --idea "..." --provider openai|command|mock [--brief-file path] [--repo OWNER/REPO] [--out path] [--apply]
  node tools/ai/src/index.mjs branch-plan --issue NUMBER --title "..."
  node tools/ai/src/index.mjs code-plan|code-agent --issue NUMBER [--repo OWNER/REPO] --provider openai|command|mock [--out path] [--json]
  node tools/ai/src/index.mjs scope-check [--plan-file path] [--base REF] [--out path] [--json] [--allow-drift "reason"]
  node tools/ai/src/index.mjs testing-plan --change docs|web|server|desktop|protocol|security|release|adapter [--risk low|medium|high|critical] [--out path] [--json]
  node tools/ai/src/index.mjs run-work|work-runner --issue NUMBER [--repo OWNER/REPO] --provider openai|command|mock [--apply] [--coding-adapter NAME] [--adapter-command-json JSON] [--verify] [--skip-verify] [--open-pr] [--allow-drift "reason"]
  node tools/ai/src/index.mjs review-pr|review-agent --pr NUMBER [--repo OWNER/REPO] --provider openai|command|mock [--out path] [--json] [--comment]
  node tools/ai/src/index.mjs work-manifest [--issue NUMBER] [--pr NUMBER] [--out path]
  node tools/ai/src/index.mjs coding-adapter-contract [--adapter NAME] [--out path]
  node tools/ai/src/index.mjs feedback-convert --feedback "..." --target bug|risk|roadmap|documentation [--out path]

Providers:
  openai   Uses OPENAI_API_KEY and the Responses API.
  command  Runs MYAGENTTOOL_AI_COMMAND or --provider-command with a JSON request on stdin.
  mock     Deterministic local provider for tests and demos.

Notes:
  Model-backed commands require a provider. Use --provider mock only for deterministic validation.
  run-work is dry-run by default. It creates branches, runs trusted coding adapters, verifies, or opens PRs only with --apply.
`;

const PM_BRIEF_SCHEMA = {
  name: "myagenttool_pm_brief",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["outcome", "primaryUser", "problem", "userStory", "nonGoals", "acceptanceCriteria", "riskFlags", "projectFields", "openQuestions"],
    properties: {
      outcome: { type: "string" },
      primaryUser: { type: "string" },
      problem: { type: "string" },
      userStory: { type: "string" },
      nonGoals: { type: "array", items: { type: "string" } },
      acceptanceCriteria: { type: "array", items: { type: "string" } },
      riskFlags: { type: "array", items: { type: "string" } },
      projectFields: {
        type: "object",
        additionalProperties: false,
        required: ["milestone", "area", "type", "status", "risk", "acceptance", "platform", "agentTarget", "priority", "sourceDoc"],
        properties: {
          milestone: { type: "string" },
          area: { type: "string" },
          type: { type: "string" },
          status: { type: "string" },
          risk: { type: "string" },
          acceptance: { type: "string" },
          platform: { type: "string" },
          agentTarget: { type: "string" },
          priority: { type: "string" },
          sourceDoc: { type: "string" },
        },
      },
      issueTitle: { type: "string" },
      suggestedLabels: { type: "array", items: { type: "string" } },
      openQuestions: { type: "array", items: { type: "string" } },
    },
  },
};

const CODE_PLAN_SCHEMA = {
  name: "myagenttool_code_plan",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["branch", "summary", "filesToTouch", "steps", "commands", "risks", "followUpIssues", "prSummary"],
    properties: {
      branch: { type: "string" },
      summary: { type: "string" },
      filesToTouch: { type: "array", items: { type: "string" } },
      steps: { type: "array", items: { type: "string" } },
      commands: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } },
      followUpIssues: { type: "array", items: { type: "string" } },
      prSummary: { type: "string" },
    },
  },
};

const REVIEW_SCHEMA = {
  name: "myagenttool_review",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "findings", "verificationGaps", "riskGates", "approve"],
    properties: {
      summary: { type: "string" },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["severity", "file", "line", "title", "rationale", "recommendation"],
          properties: {
            severity: { type: "string" },
            file: { type: "string" },
            line: { type: "integer" },
            title: { type: "string" },
            rationale: { type: "string" },
            recommendation: { type: "string" },
          },
        },
      },
      verificationGaps: { type: "array", items: { type: "string" } },
      riskGates: { type: "array", items: { type: "string" } },
      approve: { type: "boolean" },
    },
  },
};

const CODING_ADAPTER_CONTRACT_VERSION = "2026-06-19";

const CODING_ADAPTERS = {
  mock: {
    name: "mock",
    kind: "internal",
    label: "Mock coding adapter",
    description: "Deterministic local adapter for contract checks and workflow demos.",
    commandEnv: null,
  },
  codex: {
    name: "codex",
    kind: "cli",
    label: "Codex CLI adapter",
    description: "Adapter slot for Codex-style CLI coding agents.",
    commandEnv: "MYAGENTTOOL_CODEX_COMMAND_JSON",
  },
  claude: {
    name: "claude",
    kind: "cli",
    label: "Claude CLI adapter",
    description: "Adapter slot for Claude-style CLI coding agents.",
    commandEnv: "MYAGENTTOOL_CLAUDE_COMMAND_JSON",
  },
  "qwen-code": {
    name: "qwen-code",
    kind: "cli",
    label: "Qwen Code CLI adapter",
    description: "Adapter slot for Qwen Code-style CLI coding agents.",
    commandEnv: "MYAGENTTOOL_QWEN_CODE_COMMAND_JSON",
  },
  openclaw: {
    name: "openclaw",
    kind: "cli",
    label: "OpenClaw-like CLI adapter",
    description: "Adapter slot for OpenClaw-like local coding agents exposed as a command.",
    commandEnv: "MYAGENTTOOL_OPENCLAW_COMMAND_JSON",
  },
  qclaw: {
    name: "qclaw",
    kind: "cli",
    label: "QClaw-like CLI adapter",
    description: "Adapter slot for QClaw-like local coding agents exposed as a command.",
    commandEnv: "MYAGENTTOOL_QCLAW_COMMAND_JSON",
  },
  command: {
    name: "command",
    kind: "cli",
    label: "Generic trusted command adapter",
    description: "Adapter slot for an explicitly configured internal wrapper command.",
    commandEnv: "MYAGENTTOOL_CODING_ADAPTER_COMMAND_JSON",
  },
};

const STANDARD_VERIFICATION_COMMANDS = [
  ["pnpm", ["docs:check"]],
  ["pnpm", ["repo:check"]],
  ["pnpm", ["ai:check"]],
  ["pnpm", ["release:check"]],
  ["pnpm", ["deploy:check"]],
  ["pnpm", ["typecheck"]],
  ["pnpm", ["test"]],
];

function main() {
  const args = process.argv.slice(2);
  const command = args.includes("--check") ? "check" : args.find((arg) => !arg.startsWith("--"));

  if (!command || args.includes("--help") || args.includes("-h")) {
    console.log(HELP.trim());
    return;
  }

  if (command === "check") {
    check();
    return;
  }

  if (command === "intake-brief") {
    intakeBrief(args);
    return;
  }

  if (command === "pm-brief" || command === "pm-agent") {
    pmBrief(args).catch(failFromError);
    return;
  }

  if (command === "issue-tree") {
    issueTree(args).catch(failFromError);
    return;
  }

  if (command === "branch-plan") {
    branchPlan(args);
    return;
  }

  if (command === "code-plan" || command === "code-agent") {
    codePlanCommand(args).catch(failFromError);
    return;
  }

  if (command === "scope-check") {
    scopeCheck(args);
    return;
  }

  if (command === "testing-plan") {
    testingPlan(args);
    return;
  }

  if (command === "run-work" || command === "work-runner") {
    runWork(args).catch(failFromError);
    return;
  }

  if (command === "review-pr" || command === "review-agent") {
    reviewPullRequest(args).catch(failFromError);
    return;
  }

  if (command === "work-manifest") {
    workManifest(args);
    return;
  }

  if (command === "coding-adapter-contract") {
    codingAdapterContract(args);
    return;
  }

  if (command === "feedback-convert") {
    feedbackConvert(args);
    return;
  }

  fail(`Unknown command: ${command}\n\n${HELP}`);
}

function check() {
  const requiredDocs = [
    "docs/engineering/FULL_FLOW_AI_DELIVERY.md",
    "docs/engineering/AI_DEVELOPMENT_WORKFLOW.md",
    "docs/engineering/MODEL_DRIVEN_DELIVERY.md",
    "docs/engineering/DEPLOYMENT_PIPELINE.md",
    "docs/design/MYAGENTTOOL_DESIGN.md",
  ];

  const missing = requiredDocs.filter((path) => !existsSync(resolve(repoRoot, path)));
  if (missing.length > 0) {
    fail(`AI delivery docs missing:\n${missing.map((path) => `  - ${path}`).join("\n")}`);
  }

  const sample = mockStructuredOutput({
    agentName: "pm-brief",
    schema: PM_BRIEF_SCHEMA,
    prompt: "Make AI delivery easier for non-professional users.",
  });
  if (!sample.outcome || sample.acceptanceCriteria.length === 0) {
    fail("Mock AI provider sanity check failed.");
  }

  const issueTree = issueTreeFromBrief(sample);
  if (issueTree.issues.length === 0 || !issueTree.issues[0].labels.some((label) => label.startsWith("acceptance/"))) {
    fail("Issue tree generation sanity check failed.");
  }

  const testingPlan = testingPlanFor({ change: "web", risk: "high" });
  if (!testingPlan.requiredEvidence.some((item) => item.includes("Visual QA")) || !testingPlan.commands.includes("pnpm github:check:issues")) {
    fail("Testing skills plan sanity check failed.");
  }

  const docDrift = classifyScopeDrift({ changedFiles: ["docs/engineering/example.md"], undeclaredFiles: ["docs/engineering/example.md"], allowDrift: "" });
  const overriddenDrift = classifyScopeDrift({ changedFiles: ["apps/web/src/App.tsx"], undeclaredFiles: ["apps/web/src/App.tsx"], allowDrift: "linked follow-up approval" });
  if (docDrift !== "low" || overriddenDrift !== "overridden") {
    fail("Scope drift policy sanity check failed.");
  }

  if (!existsSync(resolve(repoRoot, "tools/ai/src/coding-wrapper.mjs"))) {
    fail("Trusted coding wrapper missing.");
  }

  console.log("[tools-ai:check] AI delivery helpers check OK");
}

function intakeBrief(args) {
  const idea = option(args, "--idea");
  if (!idea) fail("Missing --idea.");

  const out = option(args, "--out");
  const now = new Date().toISOString();
  const riskFlags = inferRiskFlags(idea);
  const area = inferArea(idea);
  const platform = inferPlatform(idea);

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

async function pmBrief(args) {
  const idea = option(args, "--idea");
  if (!idea) fail("Missing --idea.");

  const result = await runStructuredAgent({
    args,
    agentName: "pm-brief",
    schema: PM_BRIEF_SCHEMA,
    systemPrompt: [
      "You are the MyAgentTool PM agent.",
      "Turn plain-language ideas into milestone-aligned, non-professional-first engineering slices.",
      "Prefer M0 unless the idea clearly requires billing, lifecycle automation, distribution, or later roadmap work.",
      "Do not hide security, data, cost, release, or local execution risk.",
      "Return only JSON that matches the schema.",
    ].join("\n"),
    userPrompt: [
      `Idea:\n${idea}`,
      docsContext(["docs/vision/PRODUCT.md", "docs/engineering/FULL_FLOW_AI_DELIVERY.md", "docs/design/MYAGENTTOOL_DESIGN.md"]),
    ].join("\n\n"),
  });

  writeStructuredResult(result, formatPmBrief(result), args);
}

async function issueTree(args) {
  const apply = args.includes("--apply");
  const repo = option(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? defaultRepo();
  const brief = await loadPmBriefForIssueTree(args);
  const tree = issueTreeFromBrief(brief);
  const out = option(args, "--out");

  if (!apply) {
    const content = args.includes("--json") ? `${JSON.stringify(tree, null, 2)}\n` : formatIssueTree(tree, { applied: false });
    writeOrPrint(content, out);
    return;
  }

  if (!repo) fail("Cannot apply issue tree without --repo or GITHUB_REPOSITORY.");
  validateIssueTreeForApply(tree);

  const created = [];
  for (const issueSpec of tree.issues) {
    const body = formatIssueBody(issueSpec, created[0]?.number);
    const argsForGh = ["issue", "create", "--repo", repo, "--title", issueSpec.title, "--body", body];
    for (const label of issueSpec.labels) argsForGh.push("--label", label);
    if (issueSpec.milestone) argsForGh.push("--milestone", issueSpec.milestone);
    const output = gh(argsForGh).stdout.trim();
    const number = Number(output.match(/\/issues\/(\d+)/)?.[1] ?? 0);
    created.push({ title: issueSpec.title, url: output, number });
  }

  const appliedTree = { ...tree, applied: true, created };
  const content = args.includes("--json") ? `${JSON.stringify(appliedTree, null, 2)}\n` : formatIssueTree(appliedTree, { applied: true });
  writeOrPrint(content, out);
}

function branchPlan(args) {
  const issue = option(args, "--issue");
  const title = option(args, "--title");
  const kind = option(args, "--kind") ?? "feat";
  if (!issue) fail("Missing --issue.");
  if (!title) fail("Missing --title.");

  const branch = buildBranchName(issue, title, kind);
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

async function codePlanCommand(args) {
  const plan = await createCodePlan(args);
  writeStructuredResult(plan, formatCodePlan(plan), args);
}

function scopeCheck(args) {
  const planFile = option(args, "--plan-file");
  const plan = planFile ? JSON.parse(readFileSync(resolve(repoRoot, planFile), "utf8")) : undefined;
  const base = option(args, "--base") ?? "HEAD";
  const allowDrift = option(args, "--allow-drift") ?? "";
  const result = buildScopeCheckResult({ plan, planFile: planFile ?? "", base, allowDrift });
  const content = args.includes("--json") ? `${JSON.stringify(result, null, 2)}\n` : formatScopeCheck(result);
  writeOrPrint(content, option(args, "--out"));
  if (result.driftLevel === "high" && !allowDrift) {
    fail("Scope drift is high. Provide --allow-drift with justification or reduce the diff.");
  }
}

function testingPlan(args) {
  const change = option(args, "--change") ?? "docs";
  const risk = option(args, "--risk") ?? "medium";
  const plan = testingPlanFor({ change, risk });
  const content = args.includes("--json") ? `${JSON.stringify(plan, null, 2)}\n` : formatTestingPlan(plan);
  writeOrPrint(content, option(args, "--out"));
}

async function runWork(args) {
  const issue = option(args, "--issue");
  if (!issue) fail("Missing --issue.");

  const apply = args.includes("--apply");
  const openPr = args.includes("--open-pr");
  const verify = apply && !args.includes("--skip-verify");
  const repo = option(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? defaultRepo();
  const plan = await createCodePlan(args);
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-issue-${issue}`;
  const runDir = resolve(repoRoot, ".myagenttool/runs", runId);
  const contextFile = resolve(runDir, "context.json");
  const adapter = resolveCodingAdapter(args);
  const branch = sanitizeBranch(plan.branch || buildBranchName(issue, `issue-${issue}`, "feat"));
  mkdirSync(runDir, { recursive: true });

  writeFileSync(resolve(runDir, "code-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  writeFileSync(contextFile, `${JSON.stringify(workContext({ issue, repo, branch, plan, runId, adapter }), null, 2)}\n`, "utf8");
  writeFileSync(resolve(runDir, "coding-adapter-contract.json"), `${JSON.stringify(codingAdapterContractJson(adapter), null, 2)}\n`, "utf8");
  const testPlan = testingPlanFor({ change: inferChangeType(plan.filesToTouch), risk: inferRiskLevel(plan) });
  writeFileSync(resolve(runDir, "testing-plan.json"), `${JSON.stringify(testPlan, null, 2)}\n`, "utf8");
  writeFileSync(resolve(runDir, "testing-plan.md"), formatTestingPlan(testPlan), "utf8");
  writeFileSync(resolve(runDir, "manifest.md"), formatRunManifest({ issue, repo, plan, apply, adapter, verify, openPr, testPlan }), "utf8");

  if (!apply) {
    console.log(`AI work dry-run created .myagenttool/runs/${runId}`);
    console.log("Re-run with --apply to create the branch, run the trusted coding adapter, verify, and optionally open a PR.");
    return;
  }

  ensureCleanWorktree();
  runCommand("git", ["switch", "-c", branch], { label: `create branch ${branch}` });

  const adapterResult = runCodingAdapter({ args, adapter, issue, repo, branch, plan, runId, runDir, contextFile });
  writeFileSync(resolve(runDir, "coding-adapter-result.json"), `${JSON.stringify(adapterResult.summary, null, 2)}\n`, "utf8");

  const scopeResult = buildScopeCheckResult({ plan, planFile: `.myagenttool/runs/${runId}/code-plan.json`, base: "HEAD", allowDrift: option(args, "--allow-drift") ?? "" });
  writeFileSync(resolve(runDir, "scope-check.json"), `${JSON.stringify(scopeResult, null, 2)}\n`, "utf8");
  writeFileSync(resolve(runDir, "scope-check.md"), formatScopeCheck(scopeResult), "utf8");
  if (scopeResult.driftLevel === "high" && !scopeResult.allowDrift) {
    fail(`Scope drift is high. See .myagenttool/runs/${runId}/scope-check.md or provide --allow-drift with justification.`);
  }

  if (verify) {
    const verification = runVerification();
    writeFileSync(resolve(runDir, "verification.md"), verification, "utf8");
  }

  if (openPr) {
    if (!repo) fail("Cannot open PR without --repo or GITHUB_REPOSITORY.");
    const body = formatPrBody({ issue, plan, runId, adapter, verified: verify, testPlan, scopeResult });
    runGh(["pr", "create", "--repo", repo, "--title", plan.prSummary || `Work for #${issue}`, "--body", body]);
  }

  console.log(`AI work apply completed. Manifest: .myagenttool/runs/${runId}/manifest.md`);
}

async function reviewPullRequest(args) {
  const pr = option(args, "--pr") ?? process.env.PR_NUMBER;
  if (!pr) fail("Missing --pr.");

  const repo = option(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? defaultRepo();
  const diffFile = option(args, "--diff-file");
  const prContext = diffFile
    ? { title: `PR #${pr}`, body: "", diff: readFileSync(resolve(repoRoot, diffFile), "utf8") }
    : readPullRequestContext(repo, pr);

  const result = await runStructuredAgent({
    args,
    agentName: "review-pr",
    schema: REVIEW_SCHEMA,
    systemPrompt: [
      "You are the MyAgentTool automated PR reviewer.",
      "Use a findings-first code review style.",
      "Prioritize correctness, security, local execution safety, billing/cost impact, data governance, and missing tests.",
      "Do not approve if verification evidence is missing for behavior-changing work.",
      "Always include riskGates for security, data, billing/cost, local execution, release/deploy, web visual QA, and desktop cross-platform execution/cancellation when they apply.",
      "When evidence is missing, add a verificationGaps item instead of assuming the check passed.",
      "Return only JSON that matches the schema.",
    ].join("\n"),
    userPrompt: [
      `PR title:\n${prContext.title}`,
      `PR body:\n${prContext.body}`,
      `Diff:\n${truncate(prContext.diff, 60000)}`,
      docsContext(["docs/engineering/PR_REVIEW_POLICY.md", "docs/engineering/FULL_FLOW_AI_DELIVERY.md"]),
    ].join("\n\n"),
  });

  const markdown = formatReview(result);
  writeStructuredResult(result, markdown, args);

  if (args.includes("--comment")) {
    if (!repo) fail("Cannot comment without --repo or GITHUB_REPOSITORY.");
    runGh(["pr", "comment", pr, "--repo", repo, "--body", markdown]);
  }
}

function workManifest(args) {
  const issue = option(args, "--issue") ?? "";
  const pr = option(args, "--pr") ?? "";
  const out = option(args, "--out");
  const branch = commandOutput("git", ["branch", "--show-current"]);
  const status = commandOutput("git", ["status", "--short"]);
  const head = commandOutput("git", ["rev-parse", "--short", "HEAD"]);
  const changedFiles = status
    .split(/\r?\n/)
    .map((line) => line.replace(/^.{1,2}\s+/, "").trim())
    .filter(Boolean);

  const manifest = `# AI Work Manifest

Created: ${new Date().toISOString()}

## Scope

- Issue: ${issue ? `#${issue}` : "TODO"}
- PR: ${pr ? `#${pr}` : "TODO"}
- Branch: ${branch || "TODO"}
- Head: ${head || "TODO"}

## Changed Files

${changedFiles.length > 0 ? changedFiles.map((file) => `- ${file}`).join("\n") : "- No uncommitted files at manifest generation time."}

## Commands To Run

- [ ] pnpm docs:check
- [ ] pnpm repo:check
- [ ] pnpm github:check
- [ ] pnpm ai:check
- [ ] pnpm release:check
- [ ] pnpm deploy:check
- [ ] pnpm typecheck
- [ ] pnpm test
- [ ] pnpm github:check:pr

## Evidence

- Automated checks:
- Manual verification:
- Screenshots or logs:

## Risk Review

- Security:
- Data:
- Cost/billing:
- Local execution:
- Release/rollback:

## Follow-up Issues

- None yet.
`;

  writeOrPrint(manifest, out);
}

function codingAdapterContract(args) {
  const adapter = resolveCodingAdapter(args);
  const out = option(args, "--out");
  const json = args.includes("--json");
  const contract = codingAdapterContractJson(adapter);
  const content = json ? `${JSON.stringify(contract, null, 2)}\n` : formatCodingAdapterContract(contract);
  writeOrPrint(content, out);
}

function feedbackConvert(args) {
  const feedback = option(args, "--feedback");
  const target = option(args, "--target") ?? "needs investigation";
  if (!feedback) fail("Missing --feedback.");

  const type = targetToType(target);
  const area = inferArea(feedback);
  const platform = inferPlatform(feedback);
  const riskFlags = inferRiskFlags(feedback);
  const risk = target === "risk" || riskFlags.length > 0 ? "high" : "medium";
  const titlePrefix = type === "bug" ? "[Bug]" : type === "risk" ? "[Risk]" : "[Task]";

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
`;

  writeOrPrint(draft, option(args, "--out"));
}

async function createCodePlan(args) {
  const issue = option(args, "--issue");
  if (!issue) fail("Missing --issue.");

  const repo = option(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? defaultRepo();
  const fallbackTitle = option(args, "--title") ?? `Issue ${issue}`;
  const issueContext = readIssueContext(repo, issue, fallbackTitle);
  const branch = buildBranchName(issue, issueContext.title, option(args, "--kind") ?? "feat");

  return runStructuredAgent({
    args,
    agentName: "code-plan",
    schema: CODE_PLAN_SCHEMA,
    systemPrompt: [
      "You are the MyAgentTool coding orchestration agent.",
      "Create a scoped implementation plan from one GitHub issue.",
      "Prefer small changes, existing repo patterns, and explicit verification commands.",
      "Do not invent files that conflict with the current workspace.",
      "Return only JSON that matches the schema.",
    ].join("\n"),
    userPrompt: [
      `Repository files:\n${repoFileList()}`,
      `Expected branch:\n${branch}`,
      `Issue title:\n${issueContext.title}`,
      `Issue body:\n${truncate(issueContext.body, 20000)}`,
      docsContext(["docs/engineering/FULL_FLOW_AI_DELIVERY.md", "docs/engineering/DEFINITION_OF_DONE.md"]),
    ].join("\n\n"),
  });
}

async function runStructuredAgent({ args, agentName, schema, systemPrompt, userPrompt }) {
  const provider = resolveProvider(args);
  if (provider === "mock") {
    return mockStructuredOutput({
      agentName,
      schema,
      prompt: userPrompt,
      issue: option(args, "--issue"),
      title: option(args, "--title"),
    });
  }

  const request = {
    agentName,
    schema,
    systemPrompt,
    userPrompt,
    metadata: {
      repository: commandOutput("git", ["remote", "get-url", "origin"]),
      branch: commandOutput("git", ["branch", "--show-current"]),
      head: commandOutput("git", ["rev-parse", "--short", "HEAD"]),
    },
  };

  if (provider === "command") {
    return callCommandProvider(args, request);
  }

  if (provider === "openai") {
    return callOpenAiProvider(args, request);
  }

  fail(`Unsupported provider: ${provider}`);
}

function resolveProvider(args) {
  const provider = option(args, "--provider") ?? process.env.MYAGENTTOOL_AI_PROVIDER;
  if (provider) return provider.toLowerCase();
  fail("Missing --provider or MYAGENTTOOL_AI_PROVIDER. Use openai, command, or mock for deterministic validation.");
}

async function callOpenAiProvider(args, request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) fail("OPENAI_API_KEY is required for --provider openai.");

  const model = option(args, "--model") ?? process.env.OPENAI_MODEL;
  if (!model) fail("OPENAI_MODEL or --model is required for --provider openai so model choice stays auditable.");
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const url = new URL("/v1/responses", baseUrl.endsWith("/v1") ? baseUrl.slice(0, -3) : baseUrl);
  const body = {
    model,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: request.systemPrompt }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: request.userPrompt }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: request.schema.name,
        schema: request.schema.schema,
        strict: true,
      },
    },
  };

  const response = await httpsJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const outputText = response.output_text ?? extractResponseText(response);
  if (!outputText) {
    throw new Error("OpenAI response did not include output text.");
  }
  return JSON.parse(outputText);
}

function callCommandProvider(args, request) {
  const command = option(args, "--provider-command") ?? process.env.MYAGENTTOOL_AI_COMMAND;
  if (!command) fail("MYAGENTTOOL_AI_COMMAND or --provider-command is required for --provider command.");

  const result = spawnSync(command, {
    cwd: repoRoot,
    input: `${JSON.stringify(request, null, 2)}\n`,
    encoding: "utf8",
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(`Command provider failed with exit ${result.status}:\n${result.stderr}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Command provider did not return valid JSON: ${error.message}\n${result.stdout}`);
  }
}

function mockStructuredOutput({ agentName, prompt, issue, title }) {
  const riskFlags = inferRiskFlags(prompt);
  const area = inferArea(prompt);
  const platform = inferPlatform(prompt);

  if (agentName === "pm-brief") {
    return {
      outcome: "A non-professional user can describe an idea and receive a safe, trackable engineering slice.",
      primaryUser: "Non-professional product user first, with professional controls available as secondary details.",
      problem: "The current workflow still requires engineering knowledge to turn intent into issue-ready work.",
      userStory: "As a user with an idea, I want the system to translate my intent into scoped work so that I can move toward a product outcome without knowing the internal process.",
      nonGoals: ["No production deployment without human approval.", "No hidden local command execution."],
      acceptanceCriteria: [
        "A plain-language idea produces a structured PM brief.",
        "The brief includes risk, platform, area, acceptance, and user outcome fields.",
        "High-risk changes remain gated by explicit human approval.",
      ],
      riskFlags: riskFlags.length > 0 ? riskFlags : ["Review scope, data, cost, and local execution impact manually."],
      projectFields: {
        milestone: "M0",
        area,
        type: "task",
        status: "ready",
        risk: riskFlags.length > 0 ? "high" : "medium",
        acceptance: "defined",
        platform,
        agentTarget: "platform",
        priority: "p1",
        sourceDoc: "docs/engineering/FULL_FLOW_AI_DELIVERY.md",
      },
      issueTitle: "[Task]: Model-backed PM brief generation",
      suggestedLabels: [
        "type/task",
        "status/ready",
        `area/${area}`,
        `risk/${riskFlags.length > 0 ? "high" : "medium"}`,
        "acceptance/defined",
        `platform/${platform}`,
        "agent/platform",
        "priority/p1",
      ],
      openQuestions: ["Which provider should be used in production: OpenAI, command adapter, or both?"],
    };
  }

  if (agentName === "code-plan") {
    const issueMatch = prompt.match(/Issue title:\n(.+)/);
    const planTitle = title || issueMatch?.[1]?.trim() || "AI delivery work";
    const expectedBranchMatch = prompt.match(/Expected branch:\n(?:[a-z]+\/)?issue-(\d+)-/);
    const issueNumber = issue ?? expectedBranchMatch?.[1] ?? "0";
    return {
      branch: buildBranchName(issueNumber, planTitle, "feat"),
      summary: "Add a safe AI work runner slice that turns issue context into an implementation plan, review draft, and verification evidence.",
      filesToTouch: [
        "tools/ai/src/index.mjs",
        "docs/engineering/MODEL_DRIVEN_DELIVERY.md",
        "docs/engineering/FULL_FLOW_AI_DELIVERY.md",
      ],
      steps: [
        "Add model provider abstraction with OpenAI, command, and mock providers.",
        "Add PM, code plan, work runner, and review commands.",
        "Keep mutating operations behind explicit --apply or --comment gates.",
      ],
      commands: ["pnpm ai:check", "pnpm typecheck", "pnpm test"],
      risks: ["Local command execution must remain opt-in.", "Provider output must be structured and reviewable."],
      followUpIssues: ["Add provider-specific eval fixtures before production use."],
      prSummary: "feat: add AI delivery runner MVP",
    };
  }

  if (agentName === "review-pr") {
    return {
      summary: "Mock review found no blocking correctness issue in the provided context.",
      findings: [],
      verificationGaps: [
        "Run the full repository checks and attach output before merge.",
        "Attach visual QA, desktop cancellation, security/data/billing, or release evidence when matching files change.",
      ],
      riskGates: [
        "Security, data, billing/cost, local execution, and release/deploy changes require explicit evidence before merge.",
        "Web UI changes require visual QA screenshot evidence; desktop/local execution changes require cross-platform execution and cancellation evidence.",
        "Human approval is still required for merge, release, billing, local execution, and data retention changes.",
      ],
      approve: false,
    };
  }

  throw new Error(`No mock output for agent ${agentName}.`);
}

async function loadPmBriefForIssueTree(args) {
  const briefFile = option(args, "--brief-file");
  if (briefFile) {
    const content = readFileSync(resolve(repoRoot, briefFile), "utf8");
    try {
      return normalizePmBrief(JSON.parse(content));
    } catch {
      return normalizePmBrief(parsePmBriefMarkdown(content));
    }
  }

  const idea = option(args, "--idea");
  if (!idea) fail("Missing --idea or --brief-file.");
  const brief = await runStructuredAgent({
    args,
    agentName: "pm-brief",
    schema: PM_BRIEF_SCHEMA,
    systemPrompt: [
      "You are the MyAgentTool PM agent.",
      "Turn plain-language ideas into milestone-aligned, non-professional-first engineering slices.",
      "Prefer M0 unless the idea clearly requires billing, lifecycle automation, distribution, or later roadmap work.",
      "Do not hide security, data, cost, release, or local execution risk.",
      "Return only JSON that matches the schema.",
    ].join("\n"),
    userPrompt: [
      `Idea:\n${idea}`,
      docsContext(["docs/vision/PRODUCT.md", "docs/engineering/FULL_FLOW_AI_DELIVERY.md", "docs/engineering/PM_DESIGN_SKILLS.md"]),
    ].join("\n\n"),
  });
  return normalizePmBrief(brief);
}

function normalizePmBrief(brief) {
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
    projectFields: parseProjectFieldsFromText(content),
  };
}

function issueTreeFromBrief(brief) {
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
      humanApprovalRequiredFor: ["roadmap-changing work", "security", "billing", "local execution", "release"],
      followUp: ["Run pnpm github:check:issues.", "Run sync-project-fields dry-run before moving issues to ready."],
    },
  };
}

function mergeGovernanceLabels(labels, fields) {
  const governancePrefixes = ["type/", "status/", "area/", "risk/", "acceptance/", "platform/", "agent/", "priority/"];
  const customLabels = labels.filter((label) => !governancePrefixes.some((prefix) => label.startsWith(prefix)));
  return [...labelsFromProjectFields(fields), ...customLabels];
}

function validateIssueTreeForApply(tree) {
  const failures = [];
  for (const issueSpec of tree.issues) {
    if (!issueSpec.title || issueSpec.title.includes("TODO")) failures.push(`${issueSpec.title || "(untitled)"}: title is missing or TODO`);
    if (!issueSpec.milestone) failures.push(`${issueSpec.title}: milestone is missing`);
    if (!issueSpec.acceptanceCriteria.length) failures.push(`${issueSpec.title}: acceptance criteria are missing`);
    for (const group of ["type/", "status/", "area/", "risk/", "acceptance/", "platform/", "agent/"]) {
      if (!issueSpec.labels.some((label) => label.startsWith(group))) {
        failures.push(`${issueSpec.title}: missing ${group} label`);
      }
    }
  }
  if (failures.length > 0) {
    fail(`Issue tree is not safe to apply:\n${failures.map((failure) => `  - ${failure}`).join("\n")}`);
  }
}

function formatIssueTree(tree, { applied }) {
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

function formatIssueBody(issueSpec, parentNumber) {
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

## Risk Flags
${list(issueSpec.riskFlags)}

## Open Questions
${list(issueSpec.openQuestions)}

## Project Fields
${formatProjectFields(issueSpec.projectFields)}
`;
}

function normalizeIssueTitle(title, type) {
  if (!title || title === "TODO") {
    const prefix = type === "risk" ? "[Risk]" : type === "adr" ? "[ADR]" : type === "epic" ? "[Epic]" : "[Task]";
    return `${prefix}: TODO`;
  }
  return title;
}

function labelsFromProjectFields(fields) {
  return [
    `type/${normalizeLabelValue(fields.type)}`,
    `status/${normalizeLabelValue(fields.status)}`,
    `area/${normalizeLabelValue(fields.area)}`,
    `risk/${normalizeLabelValue(fields.risk)}`,
    `acceptance/${normalizeLabelValue(fields.acceptance)}`,
    `platform/${normalizeLabelValue(fields.platform)}`,
    `agent/${normalizeLabelValue(fields.agentTarget)}`,
    `priority/${normalizeLabelValue(fields.priority)}`,
  ];
}

function normalizeLabelValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function formatPmBrief(brief) {
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

## Open Questions

${list(brief.openQuestions)}
`;
}

function formatCodePlan(plan) {
  return `# AI Code Plan

## Branch

${plan.branch}

## Summary

${plan.summary}

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

function formatScopeCheck(result) {
  return `# AI Scope Check

Base: ${result.base}
Plan file: ${result.planFile || "not provided"}
Drift level: ${result.driftLevel}
Allowed: ${result.allowed ? "yes" : "no"}
Policy action: ${result.policyAction ?? "pass"}
Override: ${result.allowDrift || "none"}

## Changed Files

${list(result.changedFiles)}

## Declared Files

${list(result.declaredFiles)}

## Undeclared Files

${list(result.undeclaredFiles)}

## Summary

${result.summary}
`;
}

function formatTestingPlan(plan) {
  return `# AI Testing Skills Plan

Change type: ${plan.change}
Risk: ${plan.risk}

## Required Evidence

${list(plan.requiredEvidence)}

## Recommended Commands

${list(plan.commands)}

## Manual Evidence

${list(plan.manualEvidence)}

## Skill Guidance

${list(plan.skillGuidance)}
`;
}

function formatReview(review) {
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

function formatCodingAdapterContract(contract) {
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

function formatRunManifest({ issue, repo, plan, apply, adapter, verify, openPr, testPlan }) {
  return `# AI Work Run

Created: ${new Date().toISOString()}

## Scope

- Issue: #${issue}
- Repository: ${repo ?? "unknown"}
- Branch: ${plan.branch}
- Mode: ${apply ? "apply" : "dry-run"}

## Code Plan

${formatCodePlan(plan)}

## Execution

- Coding adapter: ${adapter.name}
- Adapter command source: ${adapter.commandEnv ?? "internal"}
- Verification requested: ${verify ? "yes" : "no"}
- Open PR requested: ${openPr ? "yes" : "no"}
- Model-proposed shell commands executed directly: no

## Testing Skills Plan

- Change type: ${testPlan?.change ?? "unknown"}
- Risk: ${testPlan?.risk ?? "unknown"}
- Evidence file: testing-plan.md

## Required Human Gates

- Review generated diff before commit or PR.
- Confirm local execution, data, billing, release, and security impact.
- Approve merge and release separately.
`;
}

function workContext({ issue, repo, branch, plan, runId, adapter }) {
  return {
    contractVersion: CODING_ADAPTER_CONTRACT_VERSION,
    issue: String(issue),
    repository: repo ?? "",
    branch,
    runId,
    adapter: {
      name: adapter.name,
      kind: adapter.kind,
      label: adapter.label,
    },
    plan,
    policy: {
      mayEditWorkspace: true,
      mayRunVerification: true,
      mayOpenPullRequest: false,
      mayExecuteModelProposedCommands: false,
      dirtyWorktreePolicy: "refuse unless an outer policy explicitly allows it",
      scope: "Only edit files needed for the source issue and plan.",
    },
    createdAt: new Date().toISOString(),
  };
}

function runVerification() {
  const sections = [`# Work Verification\n\nCreated: ${new Date().toISOString()}\n`];

  for (const [command, args] of STANDARD_VERIFICATION_COMMANDS) {
    const label = `${command} ${args.join(" ")}`;
    const result = spawnSync(command, args, {
      cwd: repoRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    sections.push(`## ${label}\n\nExit: ${result.status}\n\n\`\`\`text\n${result.stdout ?? ""}${result.stderr ?? ""}\n\`\`\`\n`);
    if (result.status !== 0) {
      fail(`Verification command failed: ${label}`);
    }
  }

  return sections.join("\n");
}

function resolveCodingAdapter(args) {
  const requested = (option(args, "--coding-adapter") ?? option(args, "--adapter") ?? process.env.MYAGENTTOOL_CODING_ADAPTER ?? "mock").toLowerCase();
  const adapter = CODING_ADAPTERS[requested];
  if (!adapter) {
    fail(`Unsupported coding adapter: ${requested}. Supported adapters: ${Object.keys(CODING_ADAPTERS).join(", ")}`);
  }
  return adapter;
}

function codingAdapterContractJson(adapter) {
  return {
    version: CODING_ADAPTER_CONTRACT_VERSION,
    adapter: {
      name: adapter.name,
      kind: adapter.kind,
      label: adapter.label,
      description: adapter.description,
      commandEnv: adapter.commandEnv,
    },
    requiredInputs: [
      "MYAGENTTOOL_WORK_CONTEXT points to a JSON context file.",
      "MYAGENTTOOL_WORK_PLAN_FILE points to the structured code plan.",
      "MYAGENTTOOL_WORK_MANIFEST_FILE points to the run manifest.",
      "MYAGENTTOOL_WORK_EVIDENCE_DIR points to the adapter evidence directory.",
      "MYAGENTTOOL_WORK_BRANCH contains the issue branch name.",
      "MYAGENTTOOL_WORK_ISSUE contains the source issue number.",
    ],
    requiredEvidence: [
      "adapter-result.json with status, summary, changedFiles, commandsRun, and risks.",
      "stdout.txt and stderr.txt for command-backed adapters.",
      "No secrets or broad local file dumps in evidence.",
    ],
    safetyRules: [
      "Refuse to run when the worktree is dirty unless an outer policy explicitly allows it.",
      "Only edit files required for the issue, plan, and repository patterns.",
      "Do not execute shell commands proposed by model output.",
      "Use repository verification scripts instead of ad hoc destructive commands.",
      "Leave merge, production deployment, billing, credential, and release gates to humans.",
    ],
    environment: {
      MYAGENTTOOL_WORK_CONTEXT: "Absolute path to context.json.",
      MYAGENTTOOL_WORK_PLAN_FILE: "Absolute path to code-plan.json.",
      MYAGENTTOOL_WORK_MANIFEST_FILE: "Absolute path to manifest.md.",
      MYAGENTTOOL_WORK_EVIDENCE_DIR: "Absolute path to adapter evidence directory.",
      MYAGENTTOOL_WORK_BRANCH: "Branch created by the runner.",
      MYAGENTTOOL_WORK_ISSUE: "Source issue number.",
    },
  };
}

function runCodingAdapter({ args, adapter, issue, repo, branch, plan, runId, runDir, contextFile }) {
  const evidenceDir = resolve(runDir, "coding-adapter");
  mkdirSync(evidenceDir, { recursive: true });

  if (adapter.name === "mock") {
    const summary = {
      adapter: adapter.name,
      contractVersion: CODING_ADAPTER_CONTRACT_VERSION,
      status: "completed",
      summary: "Mock adapter validated the coding adapter contract and did not edit files.",
      changedFiles: [],
      commandsRun: [],
      risks: ["No real coding agent was invoked."],
      completedAt: new Date().toISOString(),
    };
    writeFileSync(resolve(evidenceDir, "adapter-result.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    writeFileSync(resolve(evidenceDir, "stdout.txt"), "Mock coding adapter completed.\n", "utf8");
    writeFileSync(resolve(evidenceDir, "stderr.txt"), "", "utf8");
    return { summary };
  }

  const commandConfig = resolveAdapterCommand(args, adapter);
  const result = spawnSync(commandConfig.command, commandConfig.args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      MYAGENTTOOL_WORK_ISSUE: String(issue),
      MYAGENTTOOL_WORK_BRANCH: branch,
      MYAGENTTOOL_WORK_REPOSITORY: repo ?? "",
      MYAGENTTOOL_WORK_RUN_ID: runId,
      MYAGENTTOOL_WORK_CONTEXT: contextFile,
      MYAGENTTOOL_WORK_PLAN_FILE: resolve(runDir, "code-plan.json"),
      MYAGENTTOOL_WORK_MANIFEST_FILE: resolve(runDir, "manifest.md"),
      MYAGENTTOOL_WORK_EVIDENCE_DIR: evidenceDir,
      MYAGENTTOOL_CODING_ADAPTER: adapter.name,
    },
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  writeFileSync(resolve(evidenceDir, "stdout.txt"), result.stdout ?? "", "utf8");
  writeFileSync(resolve(evidenceDir, "stderr.txt"), result.stderr ?? "", "utf8");

  const adapterResultFile = resolve(evidenceDir, "adapter-result.json");
  const adapterResult = readAdapterResult(adapterResultFile, {
    adapter: adapter.name,
    contractVersion: CODING_ADAPTER_CONTRACT_VERSION,
    status: "failed",
    summary: result.status === 0 ? "Adapter command completed without required adapter-result.json." : `Adapter command failed with exit ${result.status}.`,
    changedFiles: [],
    commandsRun: [commandConfig.redactedLabel],
    risks: result.status === 0 ? ["Adapter evidence contract was not satisfied."] : ["Inspect adapter stderr before continuing."],
    completedAt: new Date().toISOString(),
  });

  if (result.status !== 0) {
    fail(`Coding adapter ${adapter.name} failed with exit ${result.status}. See .myagenttool/runs/${runId}/coding-adapter.`);
  }

  if (adapterResult.status !== "completed") {
    fail(`Coding adapter ${adapter.name} did not produce completed evidence. See .myagenttool/runs/${runId}/coding-adapter.`);
  }

  return { summary: adapterResult };
}

function resolveAdapterCommand(args, adapter) {
  const raw = option(args, "--adapter-command-json") ?? process.env[adapter.commandEnv] ?? process.env.MYAGENTTOOL_CODING_ADAPTER_COMMAND_JSON;
  if (!raw) {
    fail(`Coding adapter ${adapter.name} requires --adapter-command-json, ${adapter.commandEnv}, or MYAGENTTOOL_CODING_ADAPTER_COMMAND_JSON.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`Coding adapter command must be JSON, for example ["codex","exec"]. Parse error: ${error.message}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== "string" || item.length === 0)) {
    fail('Coding adapter command JSON must be a non-empty string array, for example ["codex","exec"].');
  }

  const [command, ...commandArgs] = parsed;
  return {
    command,
    args: commandArgs,
    redactedLabel: parsed.join(" "),
  };
}

function readAdapterResult(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return normalizeAdapterResult(parsed, fallback);
  } catch {
    return {
      ...fallback,
      status: "failed",
      summary: "Adapter result file existed but was not valid JSON.",
      risks: [...fallback.risks, "Invalid adapter-result.json must be inspected."],
    };
  }
}

function normalizeAdapterResult(result, fallback) {
  return {
    adapter: stringOr(result.adapter, fallback.adapter),
    contractVersion: stringOr(result.contractVersion, fallback.contractVersion),
    status: stringOr(result.status, fallback.status),
    summary: stringOr(result.summary, fallback.summary),
    changedFiles: stringArrayOr(result.changedFiles, fallback.changedFiles),
    commandsRun: stringArrayOr(result.commandsRun, fallback.commandsRun),
    risks: stringArrayOr(result.risks, fallback.risks),
    completedAt: stringOr(result.completedAt, fallback.completedAt),
  };
}

function formatPrBody({ issue, plan, runId, adapter, verified, testPlan, scopeResult }) {
  return `## Summary

- ${plan.prSummary || plan.summary}

## Type

- [ ] docs
- [x] feature
- [ ] bug fix
- [ ] refactor
- [ ] security
- [ ] architecture decision

## Milestone / Area

- Milestone: M0
- Area: automation
- Source issue: Closes #${issue}

## Acceptance

- [x] Acceptance criteria are defined or linked.
- [x] User-facing behavior is described in plain language.
- [x] Security, data, cost, or lifecycle impact was considered.
- [x] Docs were updated when behavior or scope changed.

## Verification

- [${verified ? "x" : " "}] Automated checks: work-runner verification${verified ? "" : " not requested"}
- [${scopeResult?.allowed ? "x" : " "}] Scope drift check: ${scopeResult?.driftLevel ?? "not generated"}${scopeResult?.allowDrift ? ` (${scopeResult.allowDrift})` : ""}
- [x] Testing skills plan: ${testPlan?.change ?? "unknown"} / ${testPlan?.risk ?? "unknown"}
- [ ] Manual verification:

AI work manifest: .myagenttool/runs/${runId}/manifest.md
Coding adapter: ${adapter?.name ?? "unknown"}
Coding adapter result: .myagenttool/runs/${runId}/coding-adapter-result.json
Coding adapter contract: .myagenttool/runs/${runId}/coding-adapter-contract.json
Scope drift evidence: ${scopeResult ? `.myagenttool/runs/${runId}/scope-check.md` : "not generated"}
Testing skills evidence: .myagenttool/runs/${runId}/testing-plan.md
Verification evidence: ${verified ? `.myagenttool/runs/${runId}/verification.md` : "not generated"}
`;
}

function formatProjectFields(fields) {
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

function writeStructuredResult(json, markdown, args) {
  const content = args.includes("--json") ? `${JSON.stringify(json, null, 2)}\n` : markdown;
  writeOrPrint(content, option(args, "--out"));
}

function docsContext(paths) {
  const parts = [];
  for (const path of paths) {
    const target = resolve(repoRoot, path);
    if (!existsSync(target)) continue;
    parts.push(`## ${path}\n${truncate(readFileSync(target, "utf8"), 12000)}`);
  }
  return `Repository context:\n${parts.join("\n\n")}`;
}

function readIssueContext(repo, issue, fallbackTitle) {
  if (!repo) return { title: fallbackTitle, body: "" };
  try {
    const issueJson = ghJson(["issue", "view", issue, "--repo", repo, "--json", "title,body,labels,milestone"]);
    return {
      title: issueJson.title ?? fallbackTitle,
      body: issueJson.body ?? "",
    };
  } catch {
    return { title: fallbackTitle, body: "" };
  }
}

function readPullRequestContext(repo, pr) {
  if (!repo) fail("Missing --repo or GITHUB_REPOSITORY.");
  const info = ghJson(["pr", "view", pr, "--repo", repo, "--json", "title,body"]);
  const diff = gh(["pr", "diff", pr, "--repo", repo]).stdout;
  return {
    title: info.title ?? `PR #${pr}`,
    body: info.body ?? "",
    diff,
  };
}

function repoFileList() {
  try {
    return execFileSync("git", ["ls-files"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, 500)
      .join("\n");
  } catch {
    return "";
  }
}

function inferRiskFlags(text) {
  const flags = [];
  const lower = text.toLowerCase();
  if (/billing|cost|charge|payment|settlement|revenue|费用|计费|收入/.test(lower)) flags.push("Cost, billing, or revenue impact");
  if (/security|permission|credential|token|secret|安全|权限|密钥/.test(lower)) flags.push("Security or permission impact");
  if (/local|desktop|execute|command|agent|电脑|本地|执行/.test(lower)) flags.push("Local execution or agent operation impact");
  if (/delete|retention|privacy|data|audit|删除|隐私|数据|审计/.test(lower)) flags.push("Data, privacy, retention, or audit impact");
  if (/release|deploy|publish|发布|部署/.test(lower)) flags.push("Release or deployment impact");
  return flags;
}

function inferArea(text) {
  const lower = text.toLowerCase();
  if (/ui|ux|web|console|页面|界面/.test(lower)) return "web";
  if (/server|api|queue|auth|gateway|服务/.test(lower)) return "server";
  if (/desktop|bridge|local|电脑|本地/.test(lower)) return "desktop";
  if (/billing|cost|revenue|费用|计费|收入/.test(lower)) return "billing";
  if (/security|permission|安全|权限/.test(lower)) return "security";
  if (/release|deploy|publish|发布|部署/.test(lower)) return "platform";
  return "cross-cutting";
}

function inferPlatform(text) {
  const lower = text.toLowerCase();
  if (/web|console|页面/.test(lower)) return "web";
  if (/server|api|cloud|服务|云/.test(lower)) return "server";
  if (/mac|windows|linux|desktop|bridge|电脑|本地/.test(lower)) return "all";
  return "all";
}

function targetToType(target) {
  const normalized = target.toLowerCase().trim();
  if (normalized === "bug") return "bug";
  if (normalized === "risk") return "risk";
  return "task";
}

function changedFilesSince(base) {
  const diffFiles = lines(commandOutput("git", ["diff", "--name-only", base, "--"]));
  const statusFiles = commandOutput("git", ["status", "--short"])
    .split(/\r?\n/)
    .map(statusPath)
    .filter(Boolean);
  return [...new Set([...diffFiles, ...statusFiles])];
}

function buildScopeCheckResult({ plan, planFile, base, allowDrift }) {
  const changedFiles = changedFilesSince(base);
  const hasPlan = Boolean(plan);
  const declaredFiles = new Set((plan?.filesToTouch ?? []).map(normalizePath));
  const undeclaredFiles = hasPlan ? changedFiles.filter((file) => !declaredFiles.has(normalizePath(file))) : [];
  const driftLevel = classifyScopeDrift({ changedFiles, undeclaredFiles, allowDrift });
  return {
    base,
    planFile,
    hasPlan,
    changedFiles,
    declaredFiles: [...declaredFiles],
    undeclaredFiles,
    driftLevel,
    allowed: driftLevel !== "high" || Boolean(allowDrift),
    policyAction: scopeDriftAction(driftLevel, allowDrift),
    allowDrift,
    summary: scopeDriftSummary({ changedFiles, undeclaredFiles, driftLevel, allowDrift, hasPlan }),
  };
}

function classifyScopeDrift({ changedFiles, undeclaredFiles, allowDrift }) {
  if (changedFiles.length === 0 || undeclaredFiles.length === 0) return "none";
  if (allowDrift) return "overridden";
  if (undeclaredFiles.length <= 2 && undeclaredFiles.every((file) => /^docs\/|^\.github\//.test(normalizePath(file)))) return "low";
  if (undeclaredFiles.length <= 4) return "medium";
  return "high";
}

function scopeDriftSummary({ changedFiles, undeclaredFiles, driftLevel, allowDrift, hasPlan = true }) {
  if (changedFiles.length === 0) return "No changed files detected.";
  if (!hasPlan) return "No plan file was provided; changed files are listed without drift classification.";
  if (undeclaredFiles.length === 0) return "All changed files were declared in the code plan.";
  if (allowDrift) return `Scope drift was explicitly allowed: ${allowDrift}`;
  return `${undeclaredFiles.length} changed file(s) were not declared in the code plan.`;
}

function scopeDriftAction(driftLevel, allowDrift) {
  if (driftLevel === "high" && !allowDrift) return "fail";
  if (["low", "medium", "overridden"].includes(driftLevel)) return "warn";
  return "pass";
}

function testingPlanFor({ change, risk }) {
  const normalizedChange = normalizeLabelValue(change);
  const normalizedRisk = normalizeLabelValue(risk);
  const base = {
    change: normalizedChange,
    risk: normalizedRisk,
    requiredEvidence: ["PR lists automated checks run.", "PR lists manual verification or states why it is not needed."],
    commands: ["pnpm docs:check", "pnpm repo:check", "pnpm typecheck", "pnpm test"],
    manualEvidence: [],
    skillGuidance: ["Use Testing skills as guidance; generated tests remain repository-owned and reviewable."],
  };

  if (normalizedChange === "docs") {
    base.commands = ["pnpm docs:check", "pnpm repo:check"];
    base.requiredEvidence.push("Documentation links and source docs are checked.");
  }
  if (normalizedChange === "web") {
    base.requiredEvidence.push("Visual QA evidence for desktop and mobile viewports.");
    base.manualEvidence.push("Screenshot or artifact paths for UI changes.");
    base.commands.push("pnpm smoke:local");
  }
  if (normalizedChange === "server") {
    base.requiredEvidence.push("Integration evidence for API, queue, audit, or persistence behavior.");
  }
  if (normalizedChange === "desktop") {
    base.requiredEvidence.push("Cross-platform process execution and cancellation evidence.");
    base.manualEvidence.push("Windows/macOS/Linux evidence or explicit gap.");
  }
  if (normalizedChange === "protocol") {
    base.requiredEvidence.push("State-machine or schema compatibility evidence.");
  }
  if (normalizedChange === "security") {
    base.requiredEvidence.push("Security review evidence for auth, credentials, data, and local execution.");
    base.skillGuidance.push("Use secure-app-builder style review before merge.");
  }
  if (normalizedChange === "release") {
    base.requiredEvidence.push("Release, rollback, and deployment preflight evidence.");
    base.commands.push("pnpm release:check", "pnpm deploy:check");
  }
  if (normalizedChange === "adapter") {
    base.requiredEvidence.push("Adapter contract evidence for success, failure, and cancellation paths.");
  }
  if (["high", "critical"].includes(normalizedRisk)) {
    base.requiredEvidence.push("Residual risks and missing test gaps are recorded.");
    base.commands.push("pnpm github:check:issues");
  }
  return base;
}

function inferChangeType(files) {
  const normalizedFiles = (files ?? []).map(normalizePath);
  if (normalizedFiles.some((file) => file.startsWith("apps/web/"))) return "web";
  if (normalizedFiles.some((file) => file.startsWith("apps/desktop") || file.includes("desktop"))) return "desktop";
  if (normalizedFiles.some((file) => file.startsWith("apps/server/"))) return "server";
  if (normalizedFiles.some((file) => file.startsWith("packages/protocol/") || file.includes("state-machine"))) return "protocol";
  if (normalizedFiles.some((file) => file.includes("security") || file.includes("auth") || file.includes("credential"))) return "security";
  if (normalizedFiles.some((file) => file.startsWith("tools/release/") || file.startsWith("tools/deploy/") || file.includes("release") || file.includes("deploy"))) return "release";
  if (normalizedFiles.some((file) => file.includes("adapter") || file.includes("coding-wrapper"))) return "adapter";
  if (normalizedFiles.length > 0 && normalizedFiles.every((file) => file.startsWith("docs/") || file.startsWith(".github/"))) return "docs";
  return "docs";
}

function inferRiskLevel(plan) {
  const text = `${plan?.summary ?? ""}\n${(plan?.risks ?? []).join("\n")}\n${(plan?.steps ?? []).join("\n")}`.toLowerCase();
  if (/critical|production|billing|credential|secret|security|local execution|delete|destructive/.test(text)) return "high";
  if (/risk|permission|data|deploy|release|desktop|adapter|migration/.test(text)) return "medium";
  return "low";
}

function normalizePath(path) {
  return path.replace(/\\/g, "/");
}

function lines(output) {
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function statusPath(line) {
  const path = line.replace(/^.{1,2}\s+/, "").trim();
  const rename = path.match(/^.+\s+->\s+(.+)$/);
  return rename?.[1] ?? path;
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

function stringOr(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function stringArrayOr(value, fallback) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : fallback;
}

function buildBranchName(issue, title, kind) {
  const slug = slugify(title).slice(0, 48).replace(/-+$/g, "");
  return sanitizeBranch(`${kind}/issue-${issue}-${slug}`);
}

function sanitizeBranch(branch) {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+$/g, "")
    .slice(0, 96);
}

function slugify(text) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "work"
  );
}

function checklist(items) {
  return items.length > 0 ? items.map((item) => `- [ ] ${item}`).join("\n") : "- [ ] TODO";
}

function list(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None.";
}

function orderedList(items) {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item}`).join("\n") : "1. TODO";
}

function writeOrPrint(content, out) {
  if (!out) {
    console.log(content.trimEnd());
    return;
  }

  const target = resolve(repoRoot, out);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
  console.log(`Wrote ${out}`);
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function ensureCleanWorktree() {
  const status = commandOutput("git", ["status", "--short"]);
  if (status.trim()) {
    fail("Refusing to apply AI work on a dirty worktree. Commit, stash, or run without --apply.");
  }
}

function runCommand(command, args, { label }) {
  try {
    execFileSync(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
    });
  } catch (error) {
    throw new Error(`${label} failed with exit ${error.status ?? 1}`);
  }
}

function truncate(text, max) {
  if (!text || text.length <= max) return text ?? "";
  return `${text.slice(0, max)}\n\n[truncated ${text.length - max} chars]`;
}

function extractResponseText(response) {
  const chunks = [];
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function httpsJson(url, options) {
  return new Promise((resolvePromise, reject) => {
    const request = https.request(url, {
      method: options.method,
      headers: options.headers,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${text}`));
          return;
        }
        try {
          resolvePromise(JSON.parse(text));
        } catch (error) {
          reject(new Error(`Invalid JSON response: ${error.message}`));
        }
      });
    });
    request.on("error", reject);
    request.write(options.body);
    request.end();
  });
}

function ghJson(args) {
  return JSON.parse(gh(args).stdout);
}

function gh(args) {
  const ghPath = resolveGhPath();
  const stdout = execFileSync(ghPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { stdout };
}

function runGh(args) {
  execFileSync(resolveGhPath(), args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

function defaultRepo() {
  try {
    return ghJson(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
  } catch {
    return undefined;
  }
}

function resolveGhPath() {
  if (process.env.GH_PATH) return process.env.GH_PATH;
  if (process.platform === "win32") {
    const defaultPath = "C:\\Program Files\\GitHub CLI\\gh.exe";
    if (existsSync(defaultPath)) return defaultPath;
  }
  return "gh";
}

function failFromError(error) {
  fail(error?.stack || error?.message || String(error));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
