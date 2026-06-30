import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { REVIEW_SCHEMA } from "./config.mjs";

const reviewCommandsContext = {};

export function configureReviewCommandsContext(context) {
  Object.assign(reviewCommandsContext, context);
}

function dep(name) {
  const value = reviewCommandsContext[name];
  if (!value) throw new Error(`Review command dependency ${name} has not been configured.`);
  return value;
}

export async function reviewPullRequest(args) {
  const option = dep("option");
  const fail = dep("fail");
  const repoRoot = dep("repoRoot");
  const pr = option(args, "--pr") ?? process.env.PR_NUMBER;
  if (!pr) fail("Missing --pr.");

  const repo = option(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? dep("defaultRepo")();
  const diffFile = option(args, "--diff-file");
  const prContext = diffFile
    ? { title: `PR #${pr}`, body: "", diff: readFileSync(resolve(repoRoot, diffFile), "utf8") }
    : dep("readPullRequestContext")(repo, pr);

  const result = await dep("runStructuredAgent")({
    args,
    agentName: "review-pr",
    schema: REVIEW_SCHEMA,
    systemPrompt: [
      "You are the MyAgentTool automated PR reviewer.",
      "Use a findings-first code review style.",
      "Prioritize correctness, security, local execution safety, billing/cost impact, data governance, and missing tests.",
      "Do not approve if verification evidence is missing for behavior-changing work.",
      "Always include riskGates for security, data, billing/cost, local execution, release/deploy, web visual QA, and desktop cross-platform execution/cancellation when they apply.",
      "For product-facing UI/workflow changes, review Product Flow coverage, IA separation, owner surface boundaries, prototype states, what-not-to-show, and role-specific usability tasks.",
      "When evidence is missing, add a verificationGaps item instead of assuming the check passed.",
      "Return only JSON that matches the schema.",
    ].join("\n"),
    userPrompt: [
      `PR title:\n${prContext.title}`,
      `PR body:\n${prContext.body}`,
      `Diff:\n${dep("truncate")(prContext.diff, 60000)}`,
      dep("docsContext")([
        "docs/design/PRODUCT_FLOWS.md",
        "DESIGN.md",
        "docs/engineering/VISUAL_QA.md",
        "docs/engineering/PR_REVIEW_POLICY.md",
        "docs/engineering/FULL_FLOW_AI_DELIVERY.md",
      ]),
    ].join("\n\n"),
  });

  const markdown = dep("formatReview")(result);
  dep("writeStructuredResult")(result, markdown, args);

  if (args.includes("--comment")) {
    if (!repo) fail("Cannot comment without --repo or GITHUB_REPOSITORY.");
    dep("runGh")(["pr", "comment", pr, "--repo", repo, "--body", markdown]);
  }
}

export function workManifest(args) {
  const option = dep("option");
  const commandOutput = dep("commandOutput");
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

  dep("writeOrPrint")(manifest, out);
}

export function codingAdapterContract(args) {
  const option = dep("option");
  const adapter = dep("resolveCodingAdapter")(args);
  const out = option(args, "--out");
  const json = args.includes("--json");
  const contract = dep("codingAdapterContractJson")(adapter);
  const content = json ? `${JSON.stringify(contract, null, 2)}\n` : dep("formatCodingAdapterContract")(contract);
  dep("writeOrPrint")(content, out);
}
