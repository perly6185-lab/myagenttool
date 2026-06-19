#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

const HELP = `MyAgentTool release tooling

Usage:
  node tools/release/src/index.mjs --check
  node tools/release/src/index.mjs draft-notes --repo OWNER/REPO --pr NUMBER

Notes:
  draft-notes prints a release note draft. It does not publish a GitHub release.
`;

function main() {
  const args = process.argv.slice(2);
  const command = args.includes("--check") ? "check" : args.find((arg) => !arg.startsWith("--"));

  if (!command || args.includes("--help") || args.includes("-h")) {
    console.log(HELP.trim());
    return;
  }

  if (command === "check") {
    checkReleaseDocs();
    return;
  }

  if (command === "draft-notes") {
    draftNotes(args);
    return;
  }

  fail(`Unknown command: ${command}\n\n${HELP}`);
}

function checkReleaseDocs() {
  const requiredFiles = [
    "docs/engineering/RELEASE_PROCESS.md",
    "docs/engineering/FULL_FLOW_AI_DELIVERY.md",
    "docs/engineering/AI_DEVELOPMENT_WORKFLOW.md",
  ];

  const missing = requiredFiles.filter((path) => !existsSync(resolve(repoRoot, path)));
  if (missing.length > 0) {
    fail(`Release docs missing:\n${missing.map((path) => `  - ${path}`).join("\n")}`);
  }

  const releaseProcess = readFileSync(resolve(repoRoot, "docs/engineering/RELEASE_PROCESS.md"), "utf8");
  const requiredSections = ["## Release Checklist", "## Release Notes", "## Rollback", "## Human Approval Required"];
  const missingSections = requiredSections.filter((section) => !releaseProcess.includes(section));
  if (missingSections.length > 0) {
    fail(`Release process missing sections:\n${missingSections.map((section) => `  - ${section}`).join("\n")}`);
  }

  console.log("[tools-release:check] release process check OK");
}

function draftNotes(args) {
  const repo = option(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? defaultRepo();
  const prNumber = option(args, "--pr") ?? process.env.PR_NUMBER ?? defaultPullRequestNumber(repo);
  if (!repo) fail("Missing --repo or GITHUB_REPOSITORY.");
  if (!prNumber) fail("Missing --pr or PR_NUMBER.");

  const pr = ghJson([
    "pr",
    "view",
    prNumber,
    "--repo",
    repo,
    "--json",
    "number,title,body,mergedAt,closingIssuesReferences,labels,files,url",
  ]);

  const releaseType = inferReleaseType(pr.files.map((file) => file.path));
  const issues = pr.closingIssuesReferences.map((issue) => {
    const title = issue.title ?? issueTitle(repo, issue.number) ?? "linked issue";
    return `#${issue.number} ${title}`;
  });

  console.log(`# Release Draft: ${pr.title}`);
  console.log("");
  console.log(`Source PR: ${pr.url}`);
  console.log(`Release type: ${releaseType}`);
  console.log("");
  console.log("## Summary");
  console.log("");
  console.log(extractSummary(pr.body) || "- TODO: summarize the user-visible change.");
  console.log("");
  console.log("## Shipped Issues");
  console.log("");
  if (issues.length > 0) {
    for (const issue of issues) console.log(`- ${issue}`);
  } else {
    console.log("- TODO: link shipped issue(s).");
  }
  console.log("");
  console.log("## Verification");
  console.log("");
  console.log(extractVerification(pr.body) || "- TODO: list checks and manual verification.");
  console.log("");
  console.log("## Security, Data, Billing, And Local Execution Impact");
  console.log("");
  console.log("- TODO: record impact or state none.");
  console.log("");
  console.log("## Known Limitations");
  console.log("");
  console.log("- TODO: list limitations or state none.");
  console.log("");
  console.log("## Rollback Notes");
  console.log("");
  console.log("- TODO: explain rollback or state no runtime release was made.");
}

function inferReleaseType(paths) {
  if (paths.every((path) => path.endsWith(".md") || path.startsWith(".github/") || path.startsWith("docs/"))) {
    return "documentation";
  }
  if (paths.some((path) => path.startsWith("apps/desktop/"))) return "desktop bridge";
  if (paths.some((path) => path.startsWith("apps/server/"))) return "server";
  if (paths.some((path) => path.startsWith("apps/web/"))) return "web";
  if (paths.some((path) => path.startsWith("packages/protocol/"))) return "protocol";
  return "mixed";
}

function extractSummary(body) {
  return extractSection(body, "Summary");
}

function extractVerification(body) {
  return extractSection(body, "Verification");
}

function extractSection(body, name) {
  const match = (body ?? "").match(new RegExp(`##\\s+${name}\\s*([\\s\\S]*?)(?:\\n##\\s+|$)`, "i"));
  return match?.[1]?.trim();
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function ghJson(args) {
  return JSON.parse(gh(args));
}

function gh(args) {
  const ghPath = resolveGhPath();
  return execFileSync(ghPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function issueTitle(repo, number) {
  try {
    return ghJson(["issue", "view", String(number), "--repo", repo, "--json", "title"]).title;
  } catch {
    return undefined;
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

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
