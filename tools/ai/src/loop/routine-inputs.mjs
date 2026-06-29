import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  arrayOr,
  fail,
  normalizePath,
  positiveIntegerOr,
  stringArrayOr,
  stringOr,
} from "./routine-utils.mjs";

export const LOOP_ROUTINE_SUPPORTED_RUN_INPUTS = ["filesystem.glob", "git.commits", "github.issues", "github.prs", "github.checks", "github.commits", "loop.registry"];

export function collectRoutineInputs(routine, root) {
  const inputs = routine.inputs.map((input) => {
    if (!LOOP_ROUTINE_SUPPORTED_RUN_INPUTS.includes(input.type)) {
      return {
        id: input.id,
        type: input.type,
        status: "unsupported",
        reason: "This input type is planned but not collected by the local routine runner yet.",
        items: [],
      };
    }
    try {
      if (input.type === "loop.registry") return collectLoopRegistryInput(input, root);
      if (input.type === "git.commits") return collectGitCommitsInput(input, root);
      if (input.type === "filesystem.glob") return collectFilesystemGlobInput(input, root);
      if (input.type === "github.issues") return collectGithubIssuesInput(input, root);
      if (input.type === "github.prs") return collectGithubPullRequestsInput(input, root);
      if (input.type === "github.checks") return collectGithubChecksInput(input, root);
      if (input.type === "github.commits") return collectGithubCommitsInput(input, root);
    } catch (error) {
      return {
        id: input.id,
        type: input.type,
        status: "failed",
        reason: error?.message ?? String(error),
        items: [],
      };
    }
    return {
      id: input.id,
      type: input.type,
      status: "unsupported",
      reason: "Input collector missing.",
      items: [],
    };
  });
  return {
    collectedAt: new Date().toISOString(),
    inputs,
  };
}

export function inputSummary(input) {
  if (input.type === "github.issues") return `${input.repo} ${input.query ?? ""}`.trim();
  if (input.type === "github.prs") return `${input.repo} ${input.query ?? ""}`.trim();
  if (input.type === "github.checks") return `${input.repo} ${input.ref ?? ""}`.trim();
  if (input.type === "github.commits") return `${input.repo} ${input.sha ?? input.since ?? ""}`.trim();
  if (input.type === "git.commits") return `${input.ref ?? "HEAD"} since ${input.since ?? "not specified"}`;
  if (input.type === "filesystem.glob") return input.pattern ?? "";
  if (input.type === "loop.registry") return `states ${(input.states ?? []).join(", ") || "any"}`;
  return "";
}

function collectLoopRegistryInput(input, root) {
  const path = resolve(root, ".myagenttool/runs/registry.json");
  if (!existsSync(path)) {
    return { id: input.id, type: input.type, status: "ok", items: [], summary: "No loop registry exists yet." };
  }
  const registry = JSON.parse(readFileSync(path, "utf8"));
  const limit = positiveIntegerOr(input.limit, 20);
  const states = stringArrayOr(input.states, []);
  const runs = arrayOr(registry.runs, [])
    .filter((run) => states.length === 0 || states.includes(run.state))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit)
    .map((run) => ({
      runId: run.runId,
      state: run.state,
      issue: run.issue,
      branch: run.branch,
      updatedAt: run.updatedAt,
      lastError: run.lastError,
    }));
  return { id: input.id, type: input.type, status: "ok", items: runs, summary: `${runs.length} loop run(s) collected.` };
}

function collectGitCommitsInput(input, root) {
  const limit = positiveIntegerOr(input.limit, 20);
  const ref = stringOr(input.ref, "HEAD");
  const args = ["log", ref, `--max-count=${limit}`, "--pretty=format:%H%x09%h%x09%cI%x09%s"];
  if (input.since) args.splice(2, 0, `--since=${input.since}`);
  const output = execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const commits = output
    ? output.split(/\r?\n/).map((line) => {
        const [sha, shortSha, committedAt, subject] = line.split("\t");
        return { sha, shortSha, committedAt, subject };
      })
    : [];
  return { id: input.id, type: input.type, status: "ok", items: commits, summary: `${commits.length} commit(s) collected.` };
}

function collectFilesystemGlobInput(input, root) {
  const pattern = normalizePath(input.pattern);
  const limit = positiveIntegerOr(input.limit, 100);
  const tracked = execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const matcher = globMatcher(pattern);
  const files = tracked.filter((file) => matcher(normalizePath(file))).slice(0, limit);
  return { id: input.id, type: input.type, status: "ok", items: files.map((path) => ({ path })), summary: `${files.length} file(s) matched ${pattern}.` };
}

function collectGithubIssuesInput(input, root) {
  const repo = requireGithubRepo(input);
  const limit = positiveIntegerOr(input.limit, 20);
  const args = [
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    stringOr(input.state, "open"),
    "--limit",
    String(limit),
    "--json",
    "number,title,state,labels,assignees,milestone,updatedAt,url",
  ];
  if (input.search) args.push("--search", String(input.search));
  const issues = ghJson(args, root);
  return {
    id: input.id,
    type: input.type,
    status: "ok",
    items: arrayOr(issues, []).map(normalizeGithubIssue),
    summary: `${arrayOr(issues, []).length} GitHub issue(s) collected from ${repo}.`,
  };
}

function collectGithubPullRequestsInput(input, root) {
  const repo = requireGithubRepo(input);
  const limit = positiveIntegerOr(input.limit, 20);
  const args = [
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    stringOr(input.state, "open"),
    "--limit",
    String(limit),
    "--json",
    "number,title,state,isDraft,headRefName,baseRefName,reviewDecision,updatedAt,url",
  ];
  if (input.search) args.push("--search", String(input.search));
  const prs = ghJson(args, root);
  return {
    id: input.id,
    type: input.type,
    status: "ok",
    items: arrayOr(prs, []).map(normalizeGithubPullRequest),
    summary: `${arrayOr(prs, []).length} GitHub pull request(s) collected from ${repo}.`,
  };
}

function collectGithubChecksInput(input, root) {
  const repo = requireGithubRepo(input);
  const pr = input.pr ?? input.prNumber;
  let checks = [];
  if (pr !== undefined && pr !== null && String(pr).trim()) {
    checks = ghJson(["pr", "checks", String(pr), "--repo", repo, "--json", "name,state,conclusion,startedAt,completedAt,link"], root);
  } else {
    const branch = stringOr(input.branch ?? input.ref, "");
    const args = ["run", "list", "--repo", repo, "--limit", String(positiveIntegerOr(input.limit, 20)), "--json", "databaseId,displayTitle,headBranch,headSha,status,conclusion,createdAt,updatedAt,url"];
    if (branch) args.push("--branch", branch);
    checks = ghJson(args, root);
  }
  return {
    id: input.id,
    type: input.type,
    status: "ok",
    items: arrayOr(checks, []).map(normalizeGithubCheck),
    summary: `${arrayOr(checks, []).length} GitHub check/run item(s) collected from ${repo}.`,
  };
}

function collectGithubCommitsInput(input, root) {
  const repo = requireGithubRepo(input);
  const limit = positiveIntegerOr(input.limit, 20);
  const path = `repos/${repo}/commits`;
  const query = [];
  if (input.sha) query.push(`sha=${encodeURIComponent(String(input.sha))}`);
  if (input.since) query.push(`since=${encodeURIComponent(String(input.since))}`);
  if (input.until) query.push(`until=${encodeURIComponent(String(input.until))}`);
  query.push(`per_page=${limit}`);
  const commits = ghJson(["api", `${path}?${query.join("&")}`], root);
  return {
    id: input.id,
    type: input.type,
    status: "ok",
    items: arrayOr(commits, []).map(normalizeGithubCommit),
    summary: `${arrayOr(commits, []).length} GitHub commit(s) collected from ${repo}.`,
  };
}

function normalizeGithubIssue(issue) {
  return {
    number: issue.number ?? null,
    title: issue.title ?? "",
    state: issue.state ?? "",
    labels: arrayOr(issue.labels, []).map((label) => label.name ?? label).filter(Boolean),
    assignees: arrayOr(issue.assignees, []).map((assignee) => assignee.login ?? assignee.name ?? assignee).filter(Boolean),
    milestone: issue.milestone?.title ?? issue.milestone ?? null,
    updatedAt: issue.updatedAt ?? null,
    url: issue.url ?? null,
  };
}

function normalizeGithubPullRequest(pr) {
  return {
    number: pr.number ?? null,
    title: pr.title ?? "",
    state: pr.state ?? "",
    isDraft: Boolean(pr.isDraft),
    headRefName: pr.headRefName ?? "",
    baseRefName: pr.baseRefName ?? "",
    reviewDecision: pr.reviewDecision ?? null,
    updatedAt: pr.updatedAt ?? null,
    url: pr.url ?? null,
  };
}

function normalizeGithubCheck(check) {
  return {
    id: check.databaseId ?? check.name ?? check.displayTitle ?? null,
    name: check.name ?? check.displayTitle ?? "",
    state: check.state ?? check.status ?? "",
    status: check.status ?? check.state ?? "",
    conclusion: check.conclusion ?? null,
    headBranch: check.headBranch ?? null,
    headSha: check.headSha ?? null,
    startedAt: check.startedAt ?? check.createdAt ?? null,
    completedAt: check.completedAt ?? check.updatedAt ?? null,
    url: check.link ?? check.url ?? null,
  };
}

function normalizeGithubCommit(commit) {
  return {
    sha: commit.sha ?? "",
    shortSha: commit.sha ? String(commit.sha).slice(0, 7) : "",
    message: commit.commit?.message ?? "",
    committedAt: commit.commit?.committer?.date ?? commit.commit?.author?.date ?? null,
    author: commit.commit?.author?.name ?? commit.author?.login ?? null,
    url: commit.html_url ?? commit.url ?? null,
  };
}

function globMatcher(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__/g, ".*");
  const regex = new RegExp(`^${escaped}$`);
  return (value) => regex.test(value);
}

function requireGithubRepo(input) {
  const repo = stringOr(input.repo, "");
  if (!repo) fail(`Input ${input.id} requires repo.`);
  return repo;
}

function ghJson(args, root) {
  const ghPath = resolveGhPath();
  const output = commandOutputForJson(ghPath, args, root);
  try {
    return JSON.parse(output || "null");
  } catch (error) {
    throw new Error(`GitHub CLI did not return valid JSON for gh ${args.join(" ")}: ${error.message}`);
  }
}

function commandOutputForJson(command, args, root) {
  if (/\.mjs$/i.test(command)) {
    return execFileSync("node", [command, ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    const commandLine = [quoteCmdArg(command), ...args.map(quoteCmdArg)].join(" ");
    const result = spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", commandLine], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    if (result.status !== 0) {
      throw new Error(`Command failed: ${command} ${args.join(" ")}\n${result.stderr ?? ""}`);
    }
    return result.stdout ?? "";
  }
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function quoteCmdArg(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function resolveGhPath() {
  if (process.env.GH_PATH) return process.env.GH_PATH;
  if (process.platform === "win32") {
    const defaultPath = "C:\\Program Files\\GitHub CLI\\gh.exe";
    if (existsSync(defaultPath)) return defaultPath;
  }
  return "gh";
}
