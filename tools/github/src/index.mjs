#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const REQUIRED_PR_SECTIONS = [
  "## Summary",
  "## Type",
  "## Milestone / Area",
  "## Acceptance",
  "## Verification",
];

const DOCS = {
  automation: "docs/engineering/AUTOMATION_PLAN.md",
  workflow: "docs/engineering/AI_DEVELOPMENT_WORKFLOW.md",
  review: "docs/engineering/PR_REVIEW_POLICY.md",
  github: "docs/engineering/GITHUB_SETUP.md",
};

const HELP = `MyAgentTool GitHub governance

Usage:
  node tools/github/src/index.mjs --check
  node tools/github/src/index.mjs check-local
  node tools/github/src/index.mjs check-issues --repo OWNER/REPO
  node tools/github/src/index.mjs check-pr --repo OWNER/REPO --pr NUMBER
  node tools/github/src/index.mjs check-branch-protection --repo OWNER/REPO --branch main
  node tools/github/src/index.mjs sync-project-fields --owner OWNER --project 1 [--apply]

Environment:
  GITHUB_REPOSITORY   default OWNER/REPO for GitHub Actions
  PR_NUMBER           default PR number for check-pr
  BRANCH_NAME         default branch for check-branch-protection

Notes:
  Commands are read-only. They do not mutate issues, Projects, or branches.
  sync-project-fields is dry-run by default and mutates Project fields only with --apply.
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

  fail(`Unknown command: ${command}\n\n${HELP}`);
}

function normalizeCommand(args) {
  if (args.includes("--help") || args.includes("-h")) return "help";
  if (args.includes("--check")) return "check";
  return args.find((arg) => !arg.startsWith("--")) ?? "help";
}

function checkLocal() {
  const requiredFiles = [
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/ISSUE_TEMPLATE/feedback.yml",
    ".github/workflows/ci.yml",
    ".github/workflows/docs.yml",
    ".github/workflows/governance.yml",
    DOCS.automation,
    DOCS.workflow,
    DOCS.review,
    DOCS.github,
  ];

  const missing = requiredFiles.filter((path) => !existsSync(resolve(repoRoot, path)));
  if (missing.length > 0) {
    failReport("GitHub governance local check failed", missing.map((path) => `missing ${path}`));
  }

  const template = readFileSync(resolve(repoRoot, ".github/PULL_REQUEST_TEMPLATE.md"), "utf8");
  const missingSections = REQUIRED_PR_SECTIONS.filter((section) => !template.includes(section));
  if (missingSections.length > 0) {
    failReport(
      "Pull request template is missing required sections",
      missingSections.map((section) => `missing ${section}`),
    );
  }

  console.log("[tools-github:check] GitHub governance local check OK");
}

function checkIssues(args) {
  const repo = option(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? defaultRepo();
  if (!repo) fail("Missing --repo or GITHUB_REPOSITORY.");

  const issues = ghJson(["issue", "list", "--repo", repo, "--state", "open", "--limit", "200", "--json", "number,title,body,labels,milestone"]);
  const failures = [];
  const warnings = [];

  for (const issue of issues) {
    const labels = new Set(issue.labels.map((label) => label.name));
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

    if (labels.has(REVIEW_LABEL) && !labels.has(VERIFIED_LABEL)) {
      warnings.push(`#${issue.number} ${issue.title}: review issue is not acceptance/verified`);
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

  printReport("Issue hygiene", failures, warnings);
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

  if (!hasVerificationEvidence(body)) {
    failures.push(`PR #${pr.number} does not list verification evidence`);
  }

  if (!hasAcceptanceMention(body)) {
    warnings.push(`PR #${pr.number} does not explicitly mention acceptance coverage`);
  }

  if (pr.files.length === 0) {
    failures.push(`PR #${pr.number} has no changed files`);
  }

  if (pr.commits.length === 0) {
    failures.push(`PR #${pr.number} has no commits`);
  }

  printReport("Pull request governance", failures, warnings);
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

function hasAcceptanceCriteria(body) {
  return /##\s+Acceptance/i.test(body ?? "") || /Acceptance Criteria/i.test(body ?? "") || /-\s+\[[ x]\]\s+.+/i.test(body ?? "");
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
    status: item.status,
    area: item.area,
    type: item.type,
    risk: item.risk,
    acceptance: item.acceptance,
    platform: item.platform,
    agentTarget: item["agent Target"],
    priority: item.priority,
    sourceDoc: item["source Doc"],
  };
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
    .replace(/_/g, "-")
    .replace(/\s+/g, " ");
}

function hasVerificationEvidence(body) {
  return /Verification/i.test(body) && /(pnpm|npm|test|check|smoke|manual|pass|passed)/i.test(body);
}

function hasAcceptanceMention(body) {
  return /Acceptance/i.test(body) || /Closes\s+#\d+/i.test(body);
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
