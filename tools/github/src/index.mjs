#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeDoraStats, doraSelfCheck, formatDoraReport } from "./dora.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

const FIELD_GROUPS = {
  type: "type/",
  status: "status/",
  area: "area/",
  risk: "risk/",
  acceptance: "acceptance/",
  platform: "platform/",
  agent: "agent/",
};

const READY_LABEL = "status/ready";
const REVIEW_LABEL = "status/review";
const VERIFIED_LABEL = "acceptance/verified";
const DONE_LABEL = "status/done";

const REQUIRED_PR_SECTIONS = [
  "## Summary",
  "## Type",
  "## Milestone / Area",
  "## Acceptance",
  "## Product Flow",
  "## Verification",
  "## Risk Gates",
];

const DOCS = {
  automation: "docs/engineering/AUTOMATION_PLAN.md",
  workflow: "docs/engineering/AI_DEVELOPMENT_WORKFLOW.md",
  review: "docs/engineering/PR_REVIEW_POLICY.md",
  github: "docs/engineering/GITHUB_SETUP.md",
  productFlows: "docs/design/PRODUCT_FLOWS.md",
};

const HELP = `MyAgentTool GitHub governance

Usage:
  node tools/github/src/index.mjs --check
  node tools/github/src/index.mjs check-local
  node tools/github/src/index.mjs check-issues --repo OWNER/REPO
  node tools/github/src/index.mjs check-pr --repo OWNER/REPO --pr NUMBER [--fail-on-risk-warnings]
  node tools/github/src/index.mjs check-branch-protection --repo OWNER/REPO --branch main
  node tools/github/src/index.mjs sync-project-fields --owner OWNER --project 1 [--apply]
  node tools/github/src/index.mjs sync-project --repo OWNER/REPO --owner OWNER --project 1 [--milestone M2|--issues 1,2] [--done] [--apply]
  node tools/github/src/index.mjs dora-report [--repo OWNER/REPO] [--days 30] [--json] [--out path]

Environment:
  GITHUB_REPOSITORY   default OWNER/REPO for GitHub Actions
  PR_NUMBER           default PR number for check-pr
  BRANCH_NAME         default branch for check-branch-protection

Notes:
  Commands are read-only. They do not mutate issues, Projects, or branches.
  sync-project-fields is dry-run by default and mutates Project fields only with --apply.
  sync-project is dry-run by default and mutates issue milestones, labels, Project items, and Project fields only with --apply.
  GitHub commands require gh CLI authentication or a GitHub Actions token.
`;

function main() {
  const args = process.argv.slice(2);
  const command = normalizeCommand(args);

  if (command === "help") {
    console.log(HELP.trim());
    return;
  }

  if (command === "check" || command === "check-local") {
    checkLocal();
    return;
  }

  if (command === "check-issues") {
    checkIssues(args);
    return;
  }

  if (command === "check-pr") {
    checkPullRequest(args);
    return;
  }

  if (command === "check-branch-protection") {
    checkBranchProtection(args);
    return;
  }

  if (command === "sync-project-fields") {
    syncProjectFields(args);
    return;
  }

  if (command === "sync-project") {
    syncProject(args);
    return;
  }

  if (command === "dora-report") {
    doraReport(args);
    return;
  }

  fail(`Unknown command: ${command}\n\n${HELP}`);
}

function normalizeCommand(args) {
  if (args.includes("--help") || args.includes("-h")) return "help";
  if (args.includes("--check")) return "check";
  return args.find((arg) => !arg.startsWith("--")) ?? "help";
}

function doraReport(args) {
  const repo = option(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? defaultRepo();
  if (!repo) fail("Missing --repo or GITHUB_REPOSITORY.");
  const days = Number(option(args, "--days") ?? 30);
  if (!Number.isFinite(days) || days <= 0) fail(`--days must be a positive number. Got: ${option(args, "--days")}`);

  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const prs = ghJson([
    "pr", "list", "--repo", repo, "--state", "merged", "--limit", "200",
    "--json", "number,createdAt,mergedAt",
  ]).filter((pr) => pr.mergedAt && pr.mergedAt >= since);

  const stats = computeDoraStats(prs, { days });
  const report = formatDoraReport(stats, { repo });

  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-dora`;
  const evidenceDir = resolve(repoRoot, ".myagenttool/metrics", runId);
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(resolve(evidenceDir, "dora.json"), `${JSON.stringify(stats, null, 2)}\n`, "utf8");
  writeFileSync(resolve(evidenceDir, "dora.md"), report, "utf8");

  const out = option(args, "--out");
  const content = args.includes("--json") ? `${JSON.stringify(stats, null, 2)}\n` : report;
  if (out) {
    const target = resolve(repoRoot, out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
    console.log(`Wrote ${out}`);
  } else {
    console.log(content.trimEnd());
  }
  console.error(`DORA evidence: .myagenttool/metrics/${runId}/`);
}

function checkLocal() {
  const requiredFiles = [
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/ISSUE_TEMPLATE/epic.yml",
    ".github/ISSUE_TEMPLATE/feedback.yml",
    ".github/ISSUE_TEMPLATE/initiative.yml",
    ".github/ISSUE_TEMPLATE/task.yml",
    ".github/workflows/ai-review.yml",
    ".github/workflows/ci.yml",
    ".github/workflows/deploy.yml",
    ".github/workflows/docs.yml",
    ".github/workflows/governance.yml",
    ".github/workflows/release.yml",
    DOCS.automation,
    DOCS.workflow,
    DOCS.review,
    DOCS.github,
    DOCS.productFlows,
    "docs/engineering/PROJECT_STATUS_FLOW.md",
    "tools/ai/src/index.mjs",
    "docs/engineering/MODEL_DRIVEN_DELIVERY.md",
    "docs/engineering/DEPLOYMENT_PIPELINE.md",
  ];

  const missing = requiredFiles.filter((path) => !existsSync(resolve(repoRoot, path)));
  if (missing.length > 0) {
    failReport("GitHub governance local check failed", missing.map((path) => `missing ${path}`));
  }

  const template = readFileSync(resolve(repoRoot, ".github/PULL_REQUEST_TEMPLATE.md"), "utf8");
  const packageJson = readFileSync(resolve(repoRoot, "package.json"), "utf8");
  const aiTool = [
    "tools/ai/src/index.mjs",
    "tools/ai/src/legacy/config.mjs",
    "tools/ai/src/legacy/formatters.mjs",
    "tools/ai/src/legacy/issue-tree.mjs",
    "tools/ai/src/legacy/pm-commands.mjs",
    "tools/ai/src/legacy/scope-testing.mjs",
  ]
    .map((path) => readFileSync(resolve(repoRoot, path), "utf8"))
    .join("\n");
  const githubTool = readFileSync(resolve(repoRoot, "tools/github/src/index.mjs"), "utf8");
  const projectFieldsDoc = readFileSync(resolve(repoRoot, "docs/engineering/PROJECT_FIELDS.md"), "utf8");
  const missingSections = REQUIRED_PR_SECTIONS.filter((section) => !template.includes(section));
  if (missingSections.length > 0) {
    failReport(
      "Pull request template is missing required sections",
      missingSections.map((section) => `missing ${section}`),
    );
  }

  const missingProductFlowTemplateItems = [
    [template, "Role flow:", "PR template Role flow field"],
    [template, "Usability task:", "PR template Usability task field"],
    [template, "What not to show:", "PR template What not to show field"],
    [template, "Partial acceptance or follow-up:", "PR template follow-up field"],
  ]
    .filter(([content, needle]) => !content.includes(needle))
    .map(([, , label]) => label);
  if (missingProductFlowTemplateItems.length > 0) {
    failReport(
      "Product Flow PR template check failed",
      missingProductFlowTemplateItems.map((label) => `missing ${label}`),
    );
  }

  const issueTemplates = [
    ".github/ISSUE_TEMPLATE/task.yml",
    ".github/ISSUE_TEMPLATE/epic.yml",
    ".github/ISSUE_TEMPLATE/initiative.yml",
  ].map((path) => [path, readFileSync(resolve(repoRoot, path), "utf8")]);
  const missingIssueProductFlow = issueTemplates
    .filter(([, content]) => !content.includes("product_flow") || !content.includes("docs/design/PRODUCT_FLOWS.md"))
    .map(([path]) => `${path} product_flow field`);
  if (missingIssueProductFlow.length > 0) {
    failReport(
      "Product Flow issue template check failed",
      missingIssueProductFlow.map((label) => `missing ${label}`),
    );
  }

  const missingAiIssueTreeProductFlow = [
    [aiTool, "## Product Flow", "AI issue-tree Product Flow body section"],
    [aiTool, "formatProductFlow", "AI issue-tree Product Flow formatter"],
    [aiTool, "docs/design/PRODUCT_FLOWS.md", "AI issue-tree Product Flow source doc prompt"],
    [aiTool, "affectedSurfaces", "AI code plan affected surfaces field"],
    [aiTool, "prototypeStates", "AI code plan prototype states field"],
    [aiTool, "acceptanceSignals", "AI code plan acceptance signals field"],
    [aiTool, "visualQaTasks", "AI code plan visual QA tasks field"],
    [aiTool, "productFlowPlanGaps", "AI code plan Product Flow drift check"],
  ]
    .filter(([content, needle]) => !content.includes(needle))
    .map(([, , label]) => label);
  if (missingAiIssueTreeProductFlow.length > 0) {
    failReport(
      "Product Flow AI issue-tree check failed",
      missingAiIssueTreeProductFlow.map((label) => `missing ${label}`),
    );
  }

  const missingProjectSync = [
    [packageJson, "github:sync-project", "package script github:sync-project"],
    [githubTool, "sync-project --repo OWNER/REPO", "sync-project help command"],
    [githubTool, "function syncProject(args)", "sync-project implementation"],
    [githubTool, "Project sync applied", "sync-project apply summary"],
    [projectFieldsDoc, "github:sync-project", "Project sync documentation"],
  ]
    .filter(([content, needle]) => !content.includes(needle))
    .map(([, , label]) => label);
  if (missingProjectSync.length > 0) {
    failReport("Project sync command check failed", missingProjectSync.map((label) => `missing ${label}`));
  }

  const milestoneAliasMap = buildMilestoneMap([{ title: "M2 - Local Agent Discovery" }]);
  if (resolveMilestoneFilter(milestoneAliasMap, "M2") !== "M2 - Local Agent Discovery") {
    failReport("Project sync command check failed", ["milestone aliases should resolve to full GitHub milestone titles"]);
  }

  const sampleProjectValues = currentProjectFields({
    status: { name: "done", optionId: "status-done" },
    area: { name: "docs", optionId: "area-docs" },
    type: { name: "task", optionId: "type-task" },
    risk: { name: "low", optionId: "risk-low" },
    acceptance: { name: "verified", optionId: "acceptance-verified" },
    platform: { name: "all", optionId: "platform-all" },
    "agent Target": { name: "platform", optionId: "agent-platform" },
    priority: { name: "p2", optionId: "priority-p2" },
    "source Doc": "docs/engineering/PROJECT_FIELDS.md",
  });
  if (sampleProjectValues.status !== "done" || sampleProjectValues.agentTarget !== "platform") {
    failReport("Project sync command check failed", ["Project single-select field objects should compare by name"]);
  }
  if (normalizeValue("in-progress") !== normalizeValue("in progress")) {
    failReport("Project sync command check failed", ["Project values should normalize label slugs and option names"]);
  }

  const visualResult = reviewRiskGates(["apps/web/src/App.tsx"], "## Verification\n- pnpm test\n", 0);
  if (!visualResult.warnings.some((warning) => warning.includes("visual QA"))) {
    failReport("Pull request risk routing check failed", ["web changes should warn when visual QA evidence is missing"]);
  }

  const coveredVisualResult = reviewRiskGates(
    ["apps/web/src/App.tsx"],
    "## Verification\n- pnpm test\n## Risk Gates\n- Visual QA screenshots captured for desktop and mobile viewports.\n",
    0,
  );
  if (coveredVisualResult.warnings.some((warning) => warning.includes("visual QA"))) {
    failReport("Pull request risk routing check failed", ["web visual QA evidence should satisfy the route"]);
  }

  const missingProductFlowResult = reviewRiskGates(
    ["apps/web/src/App.tsx"],
    "## Verification\n- pnpm test\n## Risk Gates\n- Visual QA screenshots captured for desktop and mobile viewports.\n",
    0,
  );
  if (!missingProductFlowResult.warnings.some((warning) => warning.includes("Product Flow"))) {
    failReport("Pull request risk routing check failed", ["web changes should warn when Product Flow coverage is missing"]);
  }

  const coveredProductFlowResult = reviewRiskGates(
    ["apps/web/src/App.tsx"],
    "## Product Flow\n- Role flow: ordinary developer\n- Scenario: run an agent task\n- Frequency: high\n- Owner surface: Home task workspace\n- Usability task: use Codex to run a repository task\n- What not to show: raw JSONL and hook event names\n- Partial acceptance or follow-up: none\n## Verification\n- pnpm test\n## Risk Gates\n- Visual QA screenshots captured for desktop and mobile viewports.\n",
    0,
  );
  if (coveredProductFlowResult.warnings.some((warning) => warning.includes("Product Flow"))) {
    failReport("Pull request risk routing check failed", ["specific Product Flow coverage should satisfy the route"]);
  }

  const placeholderProductFlowResult = reviewRiskGates(
    ["apps/web/src/App.tsx"],
    "## Product Flow\n- Role flow: Not applicable or requires product-flow triage\n- Scenario: update if this changes UI\n- Frequency: Not applicable\n- Owner surface: Not applicable\n- Usability task: Not applicable\n- What not to show: Internal automation details\n- Partial acceptance or follow-up: Product-facing changes must cite docs/design/PRODUCT_FLOWS.md before review\n## Verification\n- pnpm test\n## Risk Gates\n- Visual QA screenshots captured for desktop and mobile viewports.\n",
    0,
  );
  if (!placeholderProductFlowResult.warnings.some((warning) => warning.includes("Product Flow"))) {
    failReport("Pull request risk routing check failed", ["placeholder Product Flow coverage should not satisfy web UI route"]);
  }

  const weakSecurityResult = reviewRiskGates(
    ["docs/vision/DATA_GOVERNANCE.md"],
    "## Verification\n- pnpm test\n## Risk Gates\n- data\n",
    0,
    { failOnRiskWarnings: true },
  );
  if (!weakSecurityResult.failures.some((failure) => failure.includes("security/data/billing"))) {
    failReport("Pull request risk routing check failed", ["generic data text should not satisfy high-risk evidence"]);
  }

  const coveredSecurityResult = reviewRiskGates(
    ["docs/vision/DATA_GOVERNANCE.md"],
    "## Verification\n- pnpm test\n## Risk Gates\n- Security/data review completed: privacy retention impact assessed; audit evidence linked.\n",
    0,
    { failOnRiskWarnings: true },
  );
  if (coveredSecurityResult.failures.length > 0) {
    failReport("Pull request risk routing check failed", ["specific security/data evidence should satisfy the route"]);
  }

  const weakIssueLink = validateDedicatedLinkedIssue({
    repo: "example/repo",
    body: "Refs #1",
    closingIssuesReferences: [],
    issueLoader: () => ({
      number: 1,
      title: "[Initiative]: M2",
      labels: [{ name: "type/initiative" }],
      projectItems: [{ title: "myagenttool Roadmap" }],
    }),
  });
  if (!weakIssueLink.failures.some((failure) => failure.includes("dedicated non-initiative"))) {
    failReport("Pull request issue guard check failed", ["initiative-only issue links should fail"]);
  }

  const missingProjectIssueLink = validateDedicatedLinkedIssue({
    repo: "example/repo",
    body: "Refs #2",
    closingIssuesReferences: [],
    issueLoader: () => ({
      number: 2,
      title: "[Task]: Work",
      body: "## Acceptance\n- [ ] Done",
      labels: [{ name: "type/task" }],
      projectItems: [],
    }),
  });
  if (!missingProjectIssueLink.failures.some((failure) => failure.includes("Project Fields"))) {
    failReport("Pull request issue guard check failed", ["work issues without Project Fields metadata should fail"]);
  }

  const coveredIssueLink = validateDedicatedLinkedIssue({
    repo: "example/repo",
    body: "Refs #3",
    closingIssuesReferences: [],
    issueLoader: () => ({
      number: 3,
      title: "[Task]: Work",
      body: "## Project Fields\nMilestone: M2\nArea: cross-cutting\nType: task\nStatus: ready\nRisk: medium\nAcceptance: defined\nPlatform: all\nAgent Target: none\nPriority: p1\nSource Doc: docs/engineering/PROJECT_MANAGEMENT.md",
      labels: [{ name: "type/task" }],
      projectItems: [{ title: "myagenttool Roadmap" }],
    }),
  });
  if (coveredIssueLink.failures.length > 0) {
    failReport("Pull request issue guard check failed", ["Project-tracked task issue should satisfy the guard"]);
  }

  const readyProductFlowIssue = {
    number: 4,
    title: "[Task]: Improve Web Console task flow",
    body: "## Acceptance\n- [ ] User can run a task\n\n## Project Fields\nMilestone: M2\nArea: web\nType: task\nStatus: ready\nRisk: medium\nAcceptance: defined\nPlatform: web\nAgent Target: platform\nPriority: p1\nSource Doc: docs/design/PRODUCT_FLOWS.md",
    milestone: { title: "M2" },
    labels: labelsForDesiredProjectValues({
      milestone: "M2",
      area: "web",
      type: "task",
      status: "ready",
      risk: "medium",
      acceptance: "defined",
      platform: "web",
      agentTarget: "platform",
      priority: "p1",
      sourceDoc: "docs/design/PRODUCT_FLOWS.md",
    }),
  };
  const missingProductFlowIssueResult = reviewIssueHygiene([readyProductFlowIssue]);
  if (!missingProductFlowIssueResult.failures.some((failure) => failure.includes("Product Flow"))) {
    failReport("Issue status gate check failed", ["ready UI issue without Product Flow should fail"]);
  }

  const concreteProductFlowIssueResult = reviewIssueHygiene([{
    ...readyProductFlowIssue,
    body: `${readyProductFlowIssue.body}\n\n## Product Flow\n- Role flow: ordinary developer\n- Scenario: run an agent task\n- Frequency: high\n- Owner surface: Home task workspace\n- Usability task: use Codex to run a repository task\n- What not to show: raw JSONL and hook event names\n- Partial acceptance or follow-up: none\n`,
  }]);
  if (concreteProductFlowIssueResult.failures.some((failure) => failure.includes("Product Flow"))) {
    failReport("Issue status gate check failed", ["ready UI issue with concrete Product Flow should pass"]);
  }

  const doneWithoutVerifiedResult = reviewIssueHygiene([{
    ...readyProductFlowIssue,
    number: 5,
    title: "[Task]: Done without verification",
    labels: labelsForDesiredProjectValues({
      milestone: "M2",
      area: "web",
      type: "task",
      status: "done",
      risk: "medium",
      acceptance: "defined",
      platform: "web",
      agentTarget: "platform",
      priority: "p1",
      sourceDoc: "docs/design/PRODUCT_FLOWS.md",
    }),
  }]);
  if (!doneWithoutVerifiedResult.failures.some((failure) => failure.includes("done issue is not acceptance/verified"))) {
    failReport("Issue status gate check failed", ["done issue without acceptance/verified should fail"]);
  }

  const doraFailures = doraSelfCheck();
  if (doraFailures.length > 0) {
    failReport("DORA counter self-check failed", doraFailures);
  }

  console.log("[tools-github:check] GitHub governance local check OK");
}

function checkIssues(args) {
  const repo = option(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? defaultRepo();
  if (!repo) fail("Missing --repo or GITHUB_REPOSITORY.");

  const issues = ghJson(["issue", "list", "--repo", repo, "--state", "open", "--limit", "200", "--json", "number,title,body,labels,milestone"]);
  const { failures, warnings } = reviewIssueHygiene(issues);

  printReport("Issue hygiene", failures, warnings);
}

function reviewIssueHygiene(issues) {
  const failures = [];
  const warnings = [];

  for (const issue of issues) {
    const labels = new Set(issue.labels.map(labelName));
    if (!issue.milestone) {
      failures.push(`#${issue.number} ${issue.title}: missing milestone`);
    }

    for (const [group, prefix] of Object.entries(FIELD_GROUPS)) {
      if (![...labels].some((label) => label.startsWith(prefix))) {
        failures.push(`#${issue.number} ${issue.title}: missing ${group} label`);
      }
    }

    if (labels.has(READY_LABEL) && !hasAcceptanceCriteria(issue.body)) {
      failures.push(`#${issue.number} ${issue.title}: ready issue has no acceptance criteria`);
    }

    if (labels.has(READY_LABEL) && isProductFlowIssue(issue) && !hasProductFlowEvidence(issue.body ?? "")) {
      failures.push(`#${issue.number} ${issue.title}: ready UI/workflow issue has missing or placeholder Product Flow`);
    }

    if (labels.has(REVIEW_LABEL) && !labels.has(VERIFIED_LABEL)) {
      warnings.push(`#${issue.number} ${issue.title}: review issue is not acceptance/verified`);
    }

    if (labels.has(DONE_LABEL) && !labels.has(VERIFIED_LABEL)) {
      failures.push(`#${issue.number} ${issue.title}: done issue is not acceptance/verified`);
    }

    if (labels.has(VERIFIED_LABEL) && !labels.has(DONE_LABEL) && !labels.has(REVIEW_LABEL)) {
      warnings.push(`#${issue.number} ${issue.title}: verified issue is not status/review or status/done`);
    }

    if (!hasProjectFields(issue.body)) {
      warnings.push(`#${issue.number} ${issue.title}: missing ## Project Fields body section`);
      continue;
    }

    const projectFields = parseProjectFields(issue.body);
    const labelFields = fieldsFromLabels([...labels]);
    for (const [field, value] of Object.entries(projectFields)) {
      if (!value || !labelFields[field]) continue;
      if (normalizeValue(labelFields[field]) !== normalizeValue(value)) {
        warnings.push(`#${issue.number} ${issue.title}: ${field} label=${labelFields[field]} body=${value}`);
      }
    }
  }

  return { failures, warnings };
}

function checkPullRequest(args) {
  const repo = option(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? defaultRepo();
  const prNumber = option(args, "--pr") ?? process.env.PR_NUMBER ?? defaultPullRequestNumber(repo);
  if (!repo) fail("Missing --repo or GITHUB_REPOSITORY.");
  if (!prNumber) fail("Missing --pr or PR_NUMBER.");

  const pr = ghJson(["pr", "view", prNumber, "--repo", repo, "--json", "number,title,body,files,commits,closingIssuesReferences,isDraft"]);
  const failures = [];
  const warnings = [];
  const body = pr.body ?? "";

  if (pr.isDraft) {
    warnings.push(`PR #${pr.number} is draft`);
  }

  if (pr.closingIssuesReferences.length === 0 && !/\b(refs|closes|fixes)\s+#\d+/i.test(body)) {
    failures.push(`PR #${pr.number} does not link or close an issue`);
  }

  const linkedIssueResult = validateDedicatedLinkedIssue({ repo, body, closingIssuesReferences: pr.closingIssuesReferences });
  failures.push(...linkedIssueResult.failures.map((failure) => `PR #${pr.number} ${failure}`));
  warnings.push(...linkedIssueResult.warnings.map((warning) => `PR #${pr.number} ${warning}`));

  if (!hasVerificationEvidence(body)) {
    failures.push(`PR #${pr.number} does not list verification evidence`);
  }

  if (!hasAcceptanceMention(body)) {
    warnings.push(`PR #${pr.number} does not explicitly mention acceptance coverage`);
  }

  if (pr.files.length === 0) {
    failures.push(`PR #${pr.number} has no changed files`);
  }

  const changedFiles = pr.files.map(prFilePath).filter(Boolean);
  const riskGateResult = reviewRiskGates(changedFiles, body, pr.number, { failOnRiskWarnings: args.includes("--fail-on-risk-warnings") || process.env.MYAGENTTOOL_PR_RISK_GATE_FAIL === "true" });
  warnings.push(...riskGateResult.warnings);
  failures.push(...riskGateResult.failures);

  if (pr.commits.length === 0) {
    failures.push(`PR #${pr.number} has no commits`);
  }

  printReport("Pull request governance", failures, warnings);
}

function validateDedicatedLinkedIssue({ repo, body, closingIssuesReferences = [], issueLoader = loadIssueForPrGuard }) {
  const failures = [];
  const warnings = [];
  const issueNumbers = linkedIssueNumbers(body, closingIssuesReferences);
  if (issueNumbers.length === 0) {
    return { failures, warnings };
  }

  const issues = [];
  for (const issueNumber of issueNumbers) {
    try {
      issues.push(issueLoader(repo, issueNumber));
    } catch (error) {
      failures.push(`linked issue #${issueNumber} could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const workIssues = issues.filter((issue) => !issueHasLabel(issue, "type/initiative"));
  if (workIssues.length === 0) {
    failures.push("must link a dedicated non-initiative issue, not only a milestone initiative");
    return { failures, warnings };
  }

  if (!workIssues.some((issue) => Array.isArray(issue.projectItems) && issue.projectItems.length > 0)) {
    warnings.push("could not verify linked work issue Project item from this token; run github:sync-project before merge");
  }

  if (!workIssues.some((issue) => hasProjectFields(issue.body))) {
    failures.push("must link at least one work issue with Project Fields metadata");
  }

  return { failures, warnings };
}

function linkedIssueNumbers(body, closingIssuesReferences = []) {
  const numbers = new Set();
  for (const issue of closingIssuesReferences) {
    if (issue?.number) numbers.add(Number(issue.number));
  }
  const text = body ?? "";
  for (const match of text.matchAll(/\b(?:refs|closes|fixes)\s+#(\d+)/gi)) {
    numbers.add(Number(match[1]));
  }
  return [...numbers].filter(Number.isInteger);
}

function loadIssueForPrGuard(repo, issueNumber) {
  return ghJson([
    "issue",
    "view",
    String(issueNumber),
    "--repo",
    repo,
    "--json",
    "number,title,body,labels,projectItems,state",
  ]);
}

function issueHasLabel(issue, labelName) {
  return Array.isArray(issue.labels) && issue.labels.some((label) => label.name === labelName);
}

function checkBranchProtection(args) {
  const repo = option(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? defaultRepo();
  const branch = option(args, "--branch") ?? process.env.BRANCH_NAME ?? "main";
  if (!repo) fail("Missing --repo or GITHUB_REPOSITORY.");

  const result = gh(["api", `repos/${repo}/branches/${branch}/protection`], { allowFailure: true });
  if (result.status === 0) {
    const protection = JSON.parse(result.stdout);
    const requiredChecks = protection.required_status_checks?.checks ?? [];
    const requiredReviews = protection.required_pull_request_reviews;
    const warnings = [];

    if (requiredChecks.length === 0 && !protection.required_status_checks?.strict) {
      warnings.push(`${branch}: no required status checks reported`);
    }

    if (!requiredReviews) {
      warnings.push(`${branch}: pull request review requirement not reported`);
    }

    printReport("Branch protection", [], warnings);
    return;
  }

  const output = `${result.stdout}\n${result.stderr}`.trim();
  const entitlementBlocked = /upgrade to github pro|enable this feature|403/i.test(output);
  if (entitlementBlocked) {
    failReport("Branch protection unavailable", [
      `${branch}: GitHub reports branch protection is unavailable for the current repository entitlement.`,
      "Track this via issue #32 and use CI checks plus manual merge policy until enforcement is available.",
    ]);
  }

  failReport("Branch protection check failed", [output || `${branch}: unknown gh api failure`]);
}

function syncProjectFields(args) {
  const owner = option(args, "--owner");
  const projectNumber = option(args, "--project");
  const apply = args.includes("--apply");
  if (!owner) fail("Missing --owner.");
  if (!projectNumber) fail("Missing --project.");

  const [project, fields, itemList] = [
    ghJson(["project", "view", projectNumber, "--owner", owner, "--format", "json"]),
    ghJson(["project", "field-list", projectNumber, "--owner", owner, "--format", "json"]),
    ghJson(["project", "item-list", projectNumber, "--owner", owner, "--format", "json", "--limit", "200"]),
  ];

  const projectId = project.id;
  const fieldMap = buildProjectFieldMap(fields.fields);
  const operations = [];
  const warnings = [];

  for (const item of itemList.items) {
    if (item.content?.type !== "Issue") continue;
    if (!item.content.body) {
      warnings.push(`${item.title}: missing issue body`);
      continue;
    }

    const desired = parseProjectFields(item.content.body);
    const normalizedDesired = normalizeProjectFields(desired);
    const current = currentProjectFields(item);

    for (const [field, desiredValue] of Object.entries(normalizedDesired)) {
      if (!desiredValue || field === "milestone") continue;

      const currentValue = current[field];
      if (normalizeValue(currentValue) === normalizeValue(desiredValue)) continue;

      const projectField = fieldMap[field];
      if (!projectField) {
        warnings.push(`${item.title}: Project field not found: ${field}`);
        continue;
      }

      const optionId = projectField.options?.get(desiredValue);
      if (projectField.type === "single-select" && !optionId) {
        warnings.push(`${item.title}: option not found for ${field}=${desiredValue}`);
        continue;
      }

      operations.push({
        itemId: item.id,
        issue: `#${item.content.number}`,
        title: item.title,
        field,
        fieldId: projectField.id,
        type: projectField.type,
        from: currentValue ?? "",
        to: desiredValue,
        optionId,
      });
    }
  }

  if (warnings.length > 0) {
    console.log("Project field sync warnings:");
    for (const warning of warnings) console.log(`  - ${warning}`);
  }

  if (operations.length === 0) {
    console.log("Project field sync OK");
    return;
  }

  console.log(`Project field sync ${apply ? "applying" : "dry-run"} operations:`);
  for (const operation of operations) {
    console.log(`  - ${operation.issue} ${operation.field}: ${operation.from || "(empty)"} -> ${operation.to}`);
    if (!apply) continue;

    const editArgs = [
      "project",
      "item-edit",
      "--id",
      operation.itemId,
      "--project-id",
      projectId,
      "--field-id",
      operation.fieldId,
    ];

    if (operation.type === "single-select") {
      editArgs.push("--single-select-option-id", operation.optionId);
    } else {
      editArgs.push("--text", operation.to);
    }

    gh(editArgs);
  }

  if (!apply) {
    console.log("Dry-run only. Re-run with --apply to update Project fields.");
  }
}

function syncProject(args) {
  const repo = option(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? defaultRepo();
  const owner = option(args, "--owner");
  const projectNumber = option(args, "--project");
  const milestoneFilter = option(args, "--milestone");
  const issueFilter = option(args, "--issues");
  const apply = args.includes("--apply");
  const markDone = args.includes("--done");

  if (!repo) fail("Missing --repo or GITHUB_REPOSITORY.");
  if (!owner) fail("Missing --owner.");
  if (!projectNumber) fail("Missing --project.");
  if (!milestoneFilter && !issueFilter) fail("Missing --milestone or --issues.");

  const [project, fields, milestones] = [
    ghJson(["project", "view", projectNumber, "--owner", owner, "--format", "json"]),
    ghJson(["project", "field-list", projectNumber, "--owner", owner, "--format", "json"]),
    ghJson(["api", `repos/${repo}/milestones`, "--paginate"]),
  ];

  const projectId = project.id;
  const projectTitle = project.title;
  const fieldMap = buildProjectFieldMap(fields.fields);
  const milestoneMap = buildMilestoneMap(milestones);
  const resolvedMilestoneFilter = resolveMilestoneFilter(milestoneMap, milestoneFilter);
  const issues = loadSyncProjectIssues({ repo, milestoneFilter: resolvedMilestoneFilter, issueFilter });
  const projectItemsByIssueNumber = loadProjectItemsByIssueNumber({ owner, projectNumber });
  const warnings = [];
  const operations = [];

  for (const issue of issues) {
    const parsed = parseProjectFields(issue.body);
    const labelFields = fieldsFromLabels(issue.labels.map((label) => label.name));
    const desiredMilestone = normalizeMilestoneName(resolvedMilestoneFilter ?? parsed.milestone ?? issue.milestone?.title ?? "");
    const desired = desiredProjectValues({
      issue,
      parsed,
      labelFields,
      markDone,
    });

    if (!desiredMilestone) {
      warnings.push(`#${issue.number} ${issue.title}: no desired milestone found`);
    } else if (normalizeMilestoneName(issue.milestone?.title ?? "") !== desiredMilestone) {
      const milestone = milestoneMap.get(desiredMilestone);
      if (!milestone) {
        warnings.push(`#${issue.number} ${issue.title}: milestone not found: ${desiredMilestone}`);
      } else {
        operations.push({
          kind: "issue-milestone",
          issue,
          from: issue.milestone?.title ?? "",
          to: milestone.title,
        });
      }
    }

    const desiredLabels = labelsForDesiredProjectValues(desired, markDone);
    const currentLabels = new Set(issue.labels.map((label) => label.name));
    const labelsToAdd = desiredLabels.filter((label) => !currentLabels.has(label));
    const labelsToRemove = labelsToRemoveForSync(currentLabels, desiredLabels);
    if (labelsToAdd.length > 0 || labelsToRemove.length > 0) {
      operations.push({
        kind: "issue-labels",
        issue,
        add: labelsToAdd,
        remove: labelsToRemove,
      });
    }

    const issueProjectItem = issue.projectItems.find((item) => item.title === projectTitle);
    const projectItem = projectItemsByIssueNumber.get(issue.number) ?? issueProjectItem;
    if (!projectItem) {
      operations.push({
        kind: "project-add",
        issue,
        projectTitle,
      });
    }

    const currentProjectValues = projectItem ? currentProjectFields(projectItem) : {};
    for (const [field, desiredValue] of Object.entries(desired)) {
      if (!desiredValue || field === "milestone") continue;

      const projectField = fieldMap[field];
      if (!projectField) {
        warnings.push(`#${issue.number} ${issue.title}: Project field not found: ${field}`);
        continue;
      }

      const normalizedDesired = normalizeValue(desiredValue);
      const currentValue = currentProjectValues[field];
      if (projectItem && normalizeValue(currentValue) === normalizedDesired) continue;

      const optionId = projectField.options?.get(normalizedDesired);
      if (projectField.type === "single-select" && !optionId) {
        warnings.push(`#${issue.number} ${issue.title}: Project option not found for ${field}=${desiredValue}`);
        continue;
      }

      operations.push({
        kind: "project-field",
        issue,
        itemId: projectItem?.id ?? null,
        field,
        fieldId: projectField.id,
        type: projectField.type,
        from: currentValue ?? "",
        to: desiredValue,
        optionId,
      });
    }
  }

  if (warnings.length > 0) {
    console.log("Project sync warnings:");
    for (const warning of warnings) console.log(`  - ${warning}`);
  }

  if (operations.length === 0) {
    console.log("Project sync OK");
    return;
  }

  console.log(`Project sync ${apply ? "applying" : "dry-run"} operations:`);
  for (const operation of operations) {
    printProjectSyncOperation(operation);
  }

  if (!apply) {
    console.log("Dry-run only. Re-run with --apply to update issues and Project fields.");
    return;
  }

  const itemIdsByIssueNumber = new Map();
  for (const [issueNumber, item] of projectItemsByIssueNumber) {
    if (item.id) itemIdsByIssueNumber.set(issueNumber, item.id);
  }

  for (const operation of operations) {
    if (operation.kind === "issue-milestone") {
      gh(["issue", "edit", String(operation.issue.number), "--repo", repo, "--milestone", operation.to]);
    }

    if (operation.kind === "issue-labels") {
      if (operation.remove.length > 0) {
        gh(["issue", "edit", String(operation.issue.number), "--repo", repo, "--remove-label", operation.remove.join(",")]);
      }
      if (operation.add.length > 0) {
        gh(["issue", "edit", String(operation.issue.number), "--repo", repo, "--add-label", operation.add.join(",")]);
      }
    }

    if (operation.kind === "project-add") {
      const added = ghJson(["project", "item-add", projectNumber, "--owner", owner, "--url", operation.issue.url, "--format", "json"]);
      itemIdsByIssueNumber.set(operation.issue.number, added.id);
    }

    if (operation.kind === "project-field") {
      const itemId = operation.itemId ?? itemIdsByIssueNumber.get(operation.issue.number);
      if (!itemId) {
        warnings.push(`#${operation.issue.number} ${operation.issue.title}: could not resolve Project item id`);
        continue;
      }
      const editArgs = [
        "project",
        "item-edit",
        "--id",
        itemId,
        "--project-id",
        projectId,
        "--field-id",
        operation.fieldId,
      ];
      if (operation.type === "single-select") {
        editArgs.push("--single-select-option-id", operation.optionId);
      } else {
        editArgs.push("--text", operation.to);
      }
      gh(editArgs);
    }
  }

  console.log(`Project sync applied ${operations.length} operation(s).`);
}

function loadProjectItemsByIssueNumber({ owner, projectNumber }) {
  const result = ghJson([
    "project",
    "item-list",
    projectNumber,
    "--owner",
    owner,
    "--limit",
    "1000",
    "--format",
    "json",
  ]);
  const itemsByIssueNumber = new Map();
  for (const item of result.items ?? []) {
    const number = Number(item.content?.number);
    if (Number.isInteger(number)) itemsByIssueNumber.set(number, item);
  }
  return itemsByIssueNumber;
}

function hasAcceptanceCriteria(body) {
  return /##\s+Acceptance/i.test(body ?? "") || /Acceptance Criteria/i.test(body ?? "") || /-\s+\[[ x]\]\s+.+/i.test(body ?? "");
}

function loadSyncProjectIssues({ repo, milestoneFilter, issueFilter }) {
  if (issueFilter) {
    const numbers = issueFilter
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return numbers.map((number) => ghJson([
      "issue",
      "view",
      number,
      "--repo",
      repo,
      "--json",
      "number,title,body,labels,milestone,projectItems,url,state",
    ]));
  }

  const milestoneQuery = milestoneFilter ? ` milestone:"${milestoneFilter}"` : "";
  const issues = ghJson([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "all",
    "--limit",
    "200",
    "--search",
    `repo:${repo}${milestoneQuery}`,
    "--json",
    "number,title,body,labels,milestone,projectItems,url,state",
  ]);

  return issues.filter((issue) => {
    if (!milestoneFilter) return true;
    return normalizeMilestoneName(issue.milestone?.title ?? "") === normalizeMilestoneName(milestoneFilter)
      || normalizeProjectMilestoneValue(parseProjectFields(issue.body).milestone) === normalizeMilestoneName(milestoneFilter)
      || issue.title.includes(`${milestoneFilter} `)
      || issue.title.includes(`${milestoneFilter}:`);
  });
}

function desiredProjectValues({ issue, parsed, labelFields, markDone }) {
  const closed = issue.state === "CLOSED";
  return {
    status: markDone || closed ? "done" : parsed.status ?? labelFields.status ?? "backlog",
    area: parsed.area ?? labelFields.area ?? "cross-cutting",
    type: parsed.type ?? labelFields.type ?? "task",
    risk: parsed.risk ?? labelFields.risk ?? "medium",
    acceptance: markDone || closed ? "verified" : parsed.acceptance ?? labelFields.acceptance ?? "defined",
    platform: parsed.platform ?? labelFields.platform ?? "all",
    agentTarget: parsed.agentTarget ?? labelFields.agentTarget ?? "all",
    priority: parsed.priority ?? labelFields.priority ?? "p2",
    sourceDoc: parsed.sourceDoc ?? "",
  };
}

function labelsForDesiredProjectValues(values, markDone) {
  const labels = [];
  const status = markDone ? "done" : values.status;
  const acceptance = markDone ? "verified" : values.acceptance;
  if (values.type) labels.push(`type/${values.type}`);
  if (status) labels.push(`status/${status.replace(/\s+/g, "-")}`);
  if (values.area) labels.push(`area/${values.area}`);
  if (values.risk) labels.push(`risk/${values.risk}`);
  if (acceptance) labels.push(`acceptance/${acceptance.replace(/\s+/g, "-")}`);
  if (values.platform) labels.push(`platform/${values.platform}`);
  if (values.agentTarget) labels.push(`agent/${values.agentTarget}`);
  if (values.priority) labels.push(`priority/${values.priority}`);
  return [...new Set(labels)];
}

function labelsToRemoveForSync(currentLabels, desiredLabels) {
  const desired = new Set(desiredLabels);
  const groups = Object.values(FIELD_GROUPS).concat("priority/");
  return [...currentLabels].filter((label) => groups.some((prefix) => label.startsWith(prefix)) && !desired.has(label));
}

function buildMilestoneMap(milestones) {
  const map = new Map();
  for (const milestone of milestones) {
    map.set(normalizeMilestoneName(milestone.title), milestone);
    const short = milestone.title.match(/\bM\d+\b/i)?.[0];
    if (short) map.set(short.toLowerCase(), milestone);
  }
  return map;
}

function resolveMilestoneFilter(milestoneMap, milestoneFilter) {
  if (!milestoneFilter) return undefined;
  return milestoneMap.get(normalizeMilestoneName(milestoneFilter))?.title ?? milestoneFilter;
}

function normalizeMilestoneName(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const short = normalized.match(/\bM\d+\b/i)?.[0];
  return short ? short.toLowerCase() : normalizeValue(normalized);
}

function normalizeProjectMilestoneValue(value) {
  return normalizeMilestoneName(value);
}

function printProjectSyncOperation(operation) {
  if (operation.kind === "issue-milestone") {
    console.log(`  - #${operation.issue.number} milestone: ${operation.from || "(empty)"} -> ${operation.to}`);
    return;
  }
  if (operation.kind === "issue-labels") {
    console.log(`  - #${operation.issue.number} labels: add [${operation.add.join(", ") || "-"}], remove [${operation.remove.join(", ") || "-"}]`);
    return;
  }
  if (operation.kind === "project-add") {
    console.log(`  - #${operation.issue.number} add to Project: ${operation.projectTitle}`);
    return;
  }
  if (operation.kind === "project-field") {
    console.log(`  - #${operation.issue.number} Project ${operation.field}: ${operation.from || "(empty)"} -> ${operation.to}`);
  }
}

function hasProjectFields(body) {
  return /##\s+Project Fields/i.test(body ?? "");
}

function parseProjectFields(body) {
  const result = {};
  const text = body ?? "";
  const match = text.match(/##\s+Project Fields\s*([\s\S]*?)(?:\n##\s+|$)/i);
  if (!match) return result;

  for (const line of match[1].split(/\r?\n/)) {
    const fieldMatch = line.match(/^\s*([A-Za-z ]+):\s*(.+?)\s*$/);
    if (!fieldMatch) continue;
    result[toFieldKey(fieldMatch[1])] = fieldMatch[2].trim();
  }

  return result;
}

function fieldsFromLabels(labels) {
  const fields = {};
  for (const label of labels) {
    if (label.startsWith("type/")) fields.type = label.slice("type/".length);
    if (label.startsWith("status/")) fields.status = label.slice("status/".length);
    if (label.startsWith("area/")) fields.area = label.slice("area/".length);
    if (label.startsWith("risk/")) fields.risk = label.slice("risk/".length);
    if (label.startsWith("acceptance/")) fields.acceptance = label.slice("acceptance/".length).replace(/-/g, " ");
    if (label.startsWith("platform/")) fields.platform = label.slice("platform/".length);
    if (label.startsWith("agent/")) fields.agentTarget = label.slice("agent/".length);
    if (label.startsWith("priority/")) fields.priority = label.slice("priority/".length);
  }
  return fields;
}

function normalizeProjectFields(fields) {
  const normalized = {};
  for (const [field, value] of Object.entries(fields)) {
    normalized[field] = normalizeValue(value);
  }
  return normalized;
}

function currentProjectFields(item) {
  return {
    status: projectFieldValue(item.status),
    area: projectFieldValue(item.area),
    type: projectFieldValue(item.type),
    risk: projectFieldValue(item.risk),
    acceptance: projectFieldValue(item.acceptance),
    platform: projectFieldValue(item.platform),
    agentTarget: projectFieldValue(item["agent Target"]),
    priority: projectFieldValue(item.priority),
    sourceDoc: projectFieldValue(item["source Doc"]),
  };
}

function projectFieldValue(value) {
  if (value && typeof value === "object" && "name" in value) return value.name;
  return value;
}

function buildProjectFieldMap(fields) {
  const map = {};
  for (const field of fields) {
    const key = toFieldKey(field.name);
    if (field.type === "ProjectV2SingleSelectField") {
      map[key] = {
        id: field.id,
        type: "single-select",
        options: new Map(field.options.map((optionValue) => [normalizeValue(optionValue.name), optionValue.id])),
      };
    } else if (field.type === "ProjectV2Field") {
      map[key] = { id: field.id, type: "text" };
    }
  }
  return map;
}

function toFieldKey(name) {
  const normalized = name.trim().toLowerCase();
  if (normalized === "agent target") return "agentTarget";
  if (normalized === "source doc") return "sourceDoc";
  return normalized.replace(/\s+([a-z])/g, (_, letter) => letter.toUpperCase());
}

function normalizeValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^m(\d).*$/, "m$1")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ");
}

function hasVerificationEvidence(body) {
  return /Verification/i.test(body) && /(pnpm|npm|test|check|smoke|manual|pass|passed)/i.test(body);
}

function hasAcceptanceMention(body) {
  return /Acceptance/i.test(body) || /Closes\s+#\d+/i.test(body);
}

function reviewRiskWarnings(files, body, prNumber) {
  return reviewRiskGates(files, body, prNumber).warnings;
}

function reviewRiskGates(files, body, prNumber, options = {}) {
  const normalizedFiles = files.map(normalizePath);
  const warnings = [];
  const failures = [];
  const prefix = prNumber ? `PR #${prNumber}` : "PR";
  const missing = (message) => {
    if (options.failOnRiskWarnings) failures.push(message);
    else warnings.push(message);
  };

  if (normalizedFiles.some(isWebFile) && !hasVisualEvidence(body)) {
    missing(`${prefix} changes web UI files but does not mention visual QA screenshot evidence`);
  }

  if (normalizedFiles.some(isProductFacingFile) && !hasProductFlowEvidence(body)) {
    missing(`${prefix} changes product-facing UI/workflow files but does not mention Product Flow coverage`);
  }

  if (normalizedFiles.some(isDesktopOrLocalExecutionFile) && !hasDesktopEvidence(body)) {
    missing(`${prefix} changes desktop or local execution files but does not mention cross-platform execution/cancellation evidence`);
  }

  if (normalizedFiles.some(isProtocolFile) && !hasProtocolEvidence(body)) {
    missing(`${prefix} changes protocol/state-machine files but does not mention state-machine or schema compatibility evidence`);
  }

  if (normalizedFiles.some(isAdapterFile) && !hasAdapterEvidence(body)) {
    missing(`${prefix} changes adapter files but does not mention success, failure, cancellation, or redaction evidence`);
  }

  if (normalizedFiles.some(isSecurityDataBillingFile) && !hasSecurityDataBillingEvidence(body)) {
    missing(`${prefix} changes security/data/billing files but does not mention security/data/privacy, billing/cost, credential, audit, or retention evidence`);
  }

  if (normalizedFiles.some(isReleaseFile) && !hasReleaseEvidence(body)) {
    missing(`${prefix} changes release/deploy files but does not mention release, rollback, deploy preflight, or human approval evidence`);
  }

  return { warnings, failures };
}

function prFilePath(file) {
  return typeof file === "string" ? file : file.path ?? file.filename ?? file.name ?? "";
}

function isWebFile(file) {
  return file.startsWith("apps/web/") || file === "docs/engineering/VISUAL_QA.md";
}

function isProductFacingFile(file) {
  return file.startsWith("apps/web/")
    || file === "DESIGN.md"
    || file.startsWith("docs/design/")
    || file === "docs/engineering/VISUAL_QA.md";
}

function isProductFlowIssue(issue) {
  const labels = (issue.labels ?? []).map(labelName);
  const text = [
    issue.title,
    issue.body,
    issue.milestone?.title,
    ...labels,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return /\b(web|ui|ux|workflow|user-facing|console|homepage|visual|design)\b/.test(text)
    || labels.includes("area/web")
    || labels.includes("platform/web");
}

function labelName(label) {
  return typeof label === "string" ? label : label.name;
}

function isDesktopOrLocalExecutionFile(file) {
  return file.startsWith("apps/desktop/") || /desktop|bridge|local-execution|process|cancel/i.test(file);
}

function isProtocolFile(file) {
  return file.startsWith("packages/protocol/") || /state-machine|schema|protocol/i.test(file);
}

function isAdapterFile(file) {
  return file.startsWith("packages/adapters/") || /adapter|coding-wrapper/i.test(file);
}

function isSecurityDataBillingFile(file) {
  return /security|auth|credential|secret|billing|cost|quota|settlement|chargeback|audit|data[-_]governance|data[-_]retention|privacy/i.test(file);
}

function isReleaseFile(file) {
  return file.startsWith("tools/release/") || file.startsWith("tools/deploy/") || /\.github\/workflows\/(release|deploy)\.yml$/i.test(file) || /release|deploy|rollback|version/i.test(file);
}

function hasVisualEvidence(body) {
  return /visual qa.*(screenshot|desktop|mobile|viewport)|screenshot.*(desktop|mobile|viewport)|desktop viewport.*mobile viewport/i.test(body);
}

function hasProductFlowEvidence(body) {
  const flow = parseProductFlowEvidence(body);
  return Boolean(flow)
    && /^(ordinary developer|advanced developer|team administrator|auditor|multi-role)/i.test(flow.roleFlow)
    && [flow.scenario, flow.frequency, flow.ownerSurface, flow.usabilityTask, flow.whatNotToShow, flow.partialAcceptanceOrFollowUp]
      .every((value) => value && !isPlaceholderProductFlowValue(value));
}

function parseProductFlowEvidence(body) {
  if (!/##\s+Product Flow/i.test(body)) return null;
  const section = body.match(/##\s+Product Flow\s*([\s\S]*?)(?:\n##\s+|$)/i)?.[1] ?? "";
  const field = (label) => section.match(new RegExp(`${label}:\\s*(.+)`, "i"))?.[1]?.trim() ?? "";
  return {
    roleFlow: field("Role flow"),
    scenario: field("Scenario"),
    frequency: field("Frequency"),
    ownerSurface: field("Owner surface"),
    usabilityTask: field("Usability task"),
    whatNotToShow: field("What not to show"),
    partialAcceptanceOrFollowUp: field("Partial acceptance or follow-up"),
  };
}

function isPlaceholderProductFlowValue(value) {
  return /not applicable|requires product-flow triage|update if|must cite docs\/design\/product_flows|todo|n\/a/i.test(String(value ?? ""));
}

function hasDesktopEvidence(body) {
  return /(windows|macos|linux|cross-platform).*(execution|process|cancel)|cancel.*(windows|macos|linux|cross-platform)|desktop bridge/i.test(body);
}

function hasProtocolEvidence(body) {
  return /state-machine|schema|compatibility|protocol/i.test(body);
}

function hasAdapterEvidence(body) {
  return /adapter.*(success|failure|cancel|redaction)|success.*failure.*cancel|adapter-result/i.test(body);
}

function hasSecurityDataBillingEvidence(body) {
  return /security\/data review|security review|privacy.*(retention|impact|review)|data.*(retention|privacy|audit|impact)|credential.*(redaction|rotation|review)|billing.*(cost|quota|review)|cost.*(quota|billing|impact)|audit evidence/i.test(body);
}

function hasReleaseEvidence(body) {
  return /release.*(rollback|notes|evidence)|rollback.*(plan|notes|evidence)|deploy preflight|deployment preflight|human approval.*(release|deploy|production)|environment approval|production gate/i.test(body);
}

function normalizePath(path) {
  return path.replace(/\\/g, "/");
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function ghJson(args) {
  const result = gh(args);
  return JSON.parse(result.stdout);
}

function gh(args, options = {}) {
  const ghPath = resolveGhPath();
  try {
    const stdout = execFileSync(ghPath, args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    if (options.allowFailure) {
      return {
        status: error.status ?? 1,
        stdout: error.stdout?.toString() ?? "",
        stderr: error.stderr?.toString() ?? error.message,
      };
    }
    throw error;
  }
}

function defaultRepo() {
  try {
    return ghJson(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
  } catch {
    return undefined;
  }
}

function defaultPullRequestNumber(repo) {
  try {
    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!branch) return undefined;
    return ghJson(["pr", "view", branch, "--repo", repo, "--json", "number"]).number;
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

function printReport(title, failures, warnings) {
  if (warnings.length > 0) {
    console.log(`${title} warnings:`);
    for (const warning of warnings) console.log(`  - ${warning}`);
  }

  if (failures.length > 0) {
    failReport(`${title} failed`, failures);
  }

  console.log(`${title} OK`);
}

function failReport(title, failures) {
  console.error(title);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
