#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

const HELP = `MyAgentTool AI delivery helpers

Usage:
  node tools/ai/src/index.mjs --check
  node tools/ai/src/index.mjs intake-brief --idea "..." [--out path]
  node tools/ai/src/index.mjs branch-plan --issue NUMBER --title "..."
  node tools/ai/src/index.mjs work-manifest [--issue NUMBER] [--pr NUMBER] [--out path]
  node tools/ai/src/index.mjs feedback-convert --feedback "..." --target bug|risk|roadmap|documentation [--out path]

Notes:
  These helpers generate deterministic drafts. They do not call an AI model.
`;

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

  if (command === "branch-plan") {
    branchPlan(args);
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
    "docs/design/MYAGENTTOOL_DESIGN.md",
  ];

  const missing = requiredDocs.filter((path) => !existsSync(resolve(repoRoot, path)));
  if (missing.length > 0) {
    fail(`AI delivery docs missing:\n${missing.map((path) => `  - ${path}`).join("\n")}`);
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

function branchPlan(args) {
  const issue = option(args, "--issue");
  const title = option(args, "--title");
  const kind = option(args, "--kind") ?? "feat";
  if (!issue) fail("Missing --issue.");
  if (!title) fail("Missing --title.");

  const slug = slugify(title).slice(0, 48).replace(/-+$/g, "");
  const branch = `${kind}/issue-${issue}-${slug}`;
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

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "work";
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

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
