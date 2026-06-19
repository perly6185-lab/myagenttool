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
  node tools/ai/src/index.mjs branch-plan --issue NUMBER --title "..."
  node tools/ai/src/index.mjs code-plan|code-agent --issue NUMBER [--repo OWNER/REPO] --provider openai|command|mock [--out path] [--json]
  node tools/ai/src/index.mjs run-work|work-runner --issue NUMBER [--repo OWNER/REPO] --provider openai|command|mock [--apply] [--execute-command "..."] [--verify] [--open-pr]
  node tools/ai/src/index.mjs review-pr|review-agent --pr NUMBER [--repo OWNER/REPO] --provider openai|command|mock [--out path] [--json] [--comment]
  node tools/ai/src/index.mjs work-manifest [--issue NUMBER] [--pr NUMBER] [--out path]
  node tools/ai/src/index.mjs feedback-convert --feedback "..." --target bug|risk|roadmap|documentation [--out path]

Providers:
  openai   Uses OPENAI_API_KEY and the Responses API.
  command  Runs MYAGENTTOOL_AI_COMMAND or --provider-command with a JSON request on stdin.
  mock     Deterministic local provider for tests and demos.

Notes:
  Model-backed commands require a provider. Use --provider mock only for deterministic validation.
  run-work is dry-run by default. It creates branches, runs local commands, or opens PRs only with --apply.
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

  if (command === "branch-plan") {
    branchPlan(args);
    return;
  }

  if (command === "code-plan" || command === "code-agent") {
    codePlanCommand(args).catch(failFromError);
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

async function runWork(args) {
  const issue = option(args, "--issue");
  if (!issue) fail("Missing --issue.");

  const apply = args.includes("--apply");
  const executeCommand = option(args, "--execute-command") ?? process.env.MYAGENTTOOL_CODING_AGENT_COMMAND;
  const openPr = args.includes("--open-pr");
  const verify = args.includes("--verify");
  const repo = option(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? defaultRepo();
  const plan = await createCodePlan(args);
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-issue-${issue}`;
  const runDir = resolve(repoRoot, ".myagenttool/runs", runId);
  const contextFile = resolve(runDir, "context.json");
  mkdirSync(runDir, { recursive: true });

  writeFileSync(resolve(runDir, "code-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  writeFileSync(contextFile, `${JSON.stringify(workContext({ issue, repo, plan, runId }), null, 2)}\n`, "utf8");
  writeFileSync(resolve(runDir, "manifest.md"), formatRunManifest({ issue, repo, plan, apply, executeCommand, verify, openPr }), "utf8");

  if (!apply) {
    console.log(`AI work dry-run created .myagenttool/runs/${runId}`);
    console.log("Re-run with --apply to create the branch and execute the configured coding command.");
    return;
  }

  ensureCleanWorktree();
  const branch = sanitizeBranch(plan.branch || buildBranchName(issue, `issue-${issue}`, "feat"));
  runCommand("git", ["switch", "-c", branch], { label: `create branch ${branch}` });

  if (executeCommand) {
    const commandResult = spawnSync(executeCommand, {
      cwd: repoRoot,
      env: {
        ...process.env,
        MYAGENTTOOL_WORK_ISSUE: String(issue),
        MYAGENTTOOL_WORK_BRANCH: branch,
        MYAGENTTOOL_WORK_CONTEXT: contextFile,
        MYAGENTTOOL_WORK_PLAN_FILE: resolve(runDir, "code-plan.json"),
        MYAGENTTOOL_WORK_MANIFEST_FILE: resolve(runDir, "manifest.md"),
      },
      encoding: "utf8",
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    writeFileSync(resolve(runDir, "coding-command.stdout.txt"), commandResult.stdout ?? "", "utf8");
    writeFileSync(resolve(runDir, "coding-command.stderr.txt"), commandResult.stderr ?? "", "utf8");
    if (commandResult.status !== 0) {
      fail(`Coding command failed with exit ${commandResult.status}. See .myagenttool/runs/${runId}.`);
    }
  }

  if (verify) {
    const verification = runVerification();
    writeFileSync(resolve(runDir, "verification.md"), verification, "utf8");
  }

  if (openPr) {
    if (!repo) fail("Cannot open PR without --repo or GITHUB_REPOSITORY.");
    const body = formatPrBody({ issue, plan, runId });
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
      verificationGaps: ["Run the full repository checks and attach output before merge."],
      riskGates: ["Human approval is still required for merge, release, billing, local execution, and data retention changes."],
      approve: false,
    };
  }

  throw new Error(`No mock output for agent ${agentName}.`);
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

function formatRunManifest({ issue, repo, plan, apply, executeCommand, verify, openPr }) {
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

- Coding command configured: ${executeCommand ? "yes" : "no"}
- Verification requested: ${verify ? "yes" : "no"}
- Open PR requested: ${openPr ? "yes" : "no"}

## Required Human Gates

- Review generated diff before commit or PR.
- Confirm local execution, data, billing, release, and security impact.
- Approve merge and release separately.
`;
}

function workContext({ issue, repo, plan, runId }) {
  return {
    issue: String(issue),
    repository: repo ?? "",
    branch: plan.branch,
    runId,
    plan,
    createdAt: new Date().toISOString(),
  };
}

function runVerification() {
  const commands = [
    ["pnpm", ["docs:check"]],
    ["pnpm", ["repo:check"]],
    ["pnpm", ["ai:check"]],
    ["pnpm", ["release:check"]],
    ["pnpm", ["deploy:check"]],
    ["pnpm", ["typecheck"]],
    ["pnpm", ["test"]],
  ];
  const sections = [`# Work Verification\n\nCreated: ${new Date().toISOString()}\n`];

  for (const [command, args] of commands) {
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

function formatPrBody({ issue, plan, runId }) {
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

- [ ] Automated checks:
- [ ] Manual verification:

AI work manifest: .myagenttool/runs/${runId}/manifest.md
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
