import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { devNull } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function defaultNow() {
  return new Date().toISOString();
}

export function createProjectRecord(
  {
    id,
    name,
    path,
    host = "local",
    source = "user",
    worktree = null,
    color,
    ownerTeamId,
    budgetPoolId,
    defaultAgentId,
    status,
    isolation,
  } = {},
  { nextId, now = defaultNow } = {}
) {
  const projectPath = normalizeProjectPath(path);
  const createdAt = now();
  return {
    id: id ?? (typeof nextId === "function" ? nextId("prj_demo") : `prj_demo_${Date.now().toString(36)}`),
    name: String(name || basename(projectPath) || "Project").trim(),
    color: normalizeProjectColor(color),
    ownerTeamId: ownerTeamId ? String(ownerTeamId) : "team_local",
    budgetPoolId: budgetPoolId ? String(budgetPoolId) : null,
    defaultAgentId: defaultAgentId ? String(defaultAgentId) : null,
    status: status === "archived" ? "archived" : "active",
    isolation: isolation === "worktree" ? "worktree" : "shared",
    path: projectPath,
    host,
    git: {
      repoPath: projectPath,
      remoteUrl: null,
      defaultBranch: null,
      currentBranch: null,
    },
    source,
    worktree,
    createdAt,
    updatedAt: createdAt,
    lastOpenedAt: createdAt,
  };
}

export function createProjectService({ state, now, nextId, appendEvent, persistStateSoon }) {
  function addProject(body = {}) {
    const project = createProjectRecord({
      name: body.name,
      path: body.path ?? body.repoPath ?? process.cwd(),
      host: body.host ?? "local",
      source: "registered",
      color: body.color,
      ownerTeamId: body.ownerTeamId,
      budgetPoolId: body.budgetPoolId,
      defaultAgentId: body.defaultAgentId,
      status: body.status,
      isolation: body.isolation,
    }, { nextId, now });
    const existing = state.projects.find((item) => sameProjectPath(item.path, project.path));
    if (existing) {
      existing.name = project.name || existing.name;
      existing.host = project.host;
      existing.color = project.color ?? existing.color;
      existing.ownerTeamId = project.ownerTeamId ?? existing.ownerTeamId;
      existing.budgetPoolId = project.budgetPoolId ?? existing.budgetPoolId ?? null;
      existing.defaultAgentId = project.defaultAgentId ?? existing.defaultAgentId ?? null;
      existing.status = project.status ?? existing.status ?? "active";
      existing.isolation = project.isolation ?? existing.isolation ?? "shared";
      existing.updatedAt = now();
      ensureProjectTarget(existing);
      selectProject(existing.id);
      return existing;
    }
    state.projects.unshift(project);
    ensureProjectTarget(project);
    selectProject(project.id);
    appendEvent({
      invocationId: null,
      type: "project_registered",
      level: "info",
      message: `${project.name} project registered.`,
      data: { projectId: project.id, path: project.path, host: project.host },
    });
    persistStateSoon();
    return project;
  }

  function cloneProject(body = {}) {
    const gitUrl = String(body.gitUrl ?? "").trim();
    if (!isLikelyGitUrl(gitUrl)) {
      throw new Error("A valid Git URL is required.");
    }
    const parentPath = normalizeProjectPath(body.parentPath);
    const name = slugify(body.name || repoNameFromGitUrl(gitUrl));
    if (!name) {
      throw new Error("A clone folder name is required.");
    }
    const targetPath = resolve(parentPath, name);
    const relativeTarget = relative(parentPath, targetPath);
    if (!relativeTarget || relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) {
      throw new Error("Clone path must stay inside the selected parent folder.");
    }
    if (existsSync(targetPath)) {
      throw new Error(`Project folder already exists: ${targetPath}`);
    }
    execFileSync("git", ["clone", gitUrl, targetPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    return addProject({ name: body.name || name, path: targetPath, host: body.host ?? "local", color: body.color });
  }

  function createBlankProject(body = {}) {
    const rawPath = String(body.path ?? "").trim();
    if (!rawPath) {
      throw new Error("Project path is required.");
    }
    const targetPath = resolve(rawPath);
    if (existsSync(targetPath)) {
      if (!statSync(targetPath).isDirectory()) {
        throw new Error(`Project path is not a directory: ${targetPath}`);
      }
      if (readdirSync(targetPath).length > 0) {
        throw new Error(`Project folder is not empty: ${targetPath}`);
      }
    } else {
      mkdirSync(targetPath, { recursive: true });
    }
    execFileSync("git", ["-C", targetPath, "init"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20_000,
    });
    return addProject({
      name: body.name,
      path: targetPath,
      host: body.host ?? "local",
      color: body.color,
      ownerTeamId: body.ownerTeamId,
      budgetPoolId: body.budgetPoolId,
      defaultAgentId: body.defaultAgentId,
    });
  }

  function selectProject(projectId) {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return null;
    state.currentProjectId = project.id;
    project.lastOpenedAt = now();
    project.updatedAt = project.lastOpenedAt;
    persistStateSoon();
    return project;
  }

  function removeProject(projectId) {
    if (state.projects.length <= 1) {
      throw new Error("At least one project must remain registered.");
    }
    const index = state.projects.findIndex((item) => item.id === projectId);
    if (index === -1) return null;
    const [removed] = state.projects.splice(index, 1);
    if (state.currentProjectId === removed.id) {
      state.currentProjectId = state.projects[0]?.id ?? null;
      if (state.currentProjectId) selectProject(state.currentProjectId);
    }
    appendEvent({
      invocationId: null,
      type: "project_removed",
      level: "info",
      message: `${removed.name} project removed from registry.`,
      data: { projectId: removed.id, path: removed.path },
    });
    persistStateSoon();
    return removed;
  }

  function currentProject() {
    return state.projects.find((item) => item.id === state.currentProjectId) ?? state.projects[0] ?? null;
  }

  function projectForInvocation(invocation) {
    const worktreeId = invocation?.worktreeId ?? invocation?.options?.metadata?.worktreeId ?? null;
    const worktree = worktreeId ? state.worktrees.find((item) => item.id === worktreeId) : null;
    const projectId = worktree?.workspaceProjectId
      ?? invocation?.projectId
      ?? invocation?.options?.metadata?.workspaceProjectId
      ?? invocation?.options?.metadata?.projectId
      ?? state.currentProjectId;
    return state.projects.find((item) => item.id === projectId) ?? currentProject();
  }

  function worktreeForProject(projectId) {
    return state.worktrees.find((item) => item.projectId === projectId) ?? null;
  }

  function createWorktree(body = {}) {
    const sourceProject = state.projects.find((item) => item.id === (body.projectId ?? state.currentProjectId)) ?? currentProject();
    if (!sourceProject) {
      throw new Error("A source project is required before creating a worktree.");
    }

    const repoRoot = gitRepoRoot(sourceProject.path);
    const branchName = normalizeWorktreeBranch(body.branchName || body.name || `myagenttool/${slugify(sourceProject.name)}-${Date.now().toString(36)}`);
    const baseBranch = normalizeWorktreeBase(body.baseBranch);
    const worktreeName = slugify(body.name || branchName.split("/").at(-1) || "worktree");
    const targetPath = body.path
      ? resolve(String(body.path))
      : nextAvailableWorktreePath(repoRoot, worktreeName);
    if (existsSync(targetPath)) {
      throw new Error(`Worktree path already exists: ${targetPath}`);
    }

    const gitArgs = ["-C", repoRoot, "worktree", "add", "-b", branchName, targetPath];
    if (baseBranch) {
      gitArgs.push(baseBranch);
    }
    execFileSync("git", gitArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20_000,
    });

    const createdAt = now();
    const worktree = {
      id: nextId("wtr_demo"),
      sourceProjectId: sourceProject.id,
      projectId: sourceProject.id,
      workspaceProjectId: null,
      targetId: `tgt_${sourceProject.id}`,
      repoPath: repoRoot,
      worktreePath: targetPath,
      path: targetPath,
      branchName,
      branch: branchName,
      baseBranch: baseBranch ?? "HEAD",
      isMain: false,
      ephemeral: Boolean(body.ephemeral),
      agentId: body.agentId ? String(body.agentId) : null,
      link: normalizeWorktreeLink(body.link),
      status: "ready",
      createdAt,
      lastSeenAt: createdAt,
    };
    const project = createProjectRecord({
      name: body.name || `${sourceProject.name} / ${branchName.split("/").at(-1)}`,
      path: targetPath,
      host: sourceProject.host ?? "local",
      source: "worktree",
      color: sourceProject.color,
      ownerTeamId: sourceProject.ownerTeamId,
      budgetPoolId: sourceProject.budgetPoolId,
      defaultAgentId: body.agentId ?? sourceProject.defaultAgentId,
      status: sourceProject.status,
      isolation: sourceProject.isolation,
      worktree: {
        id: worktree.id,
        sourceProjectId: sourceProject.id,
        branchName,
        baseBranch: worktree.baseBranch,
      },
    }, { nextId, now });
    worktree.workspaceProjectId = project.id;
    state.worktrees.unshift(worktree);
    state.projects.unshift(project);
    selectProject(project.id);
    appendEvent({
      invocationId: null,
      type: "worktree_created",
      level: "info",
      message: `Created worktree ${branchName}.`,
      data: {
        worktreeId: worktree.id,
        sourceProjectId: sourceProject.id,
        projectId: project.id,
        path: targetPath,
        branchName,
      },
    });
    persistStateSoon();
    return { worktree, project, projects: state.projects, currentProjectId: state.currentProjectId };
  }

  function updateProject(projectId, body = {}) {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return null;
    if (body.name !== undefined) project.name = String(body.name).trim() || project.name;
    if (body.color !== undefined) project.color = normalizeProjectColor(body.color, project.color);
    if (body.status !== undefined) project.status = body.status === "archived" ? "archived" : "active";
    if (body.isolation !== undefined) project.isolation = body.isolation === "worktree" ? "worktree" : "shared";
    if (body.defaultAgentId !== undefined) project.defaultAgentId = body.defaultAgentId ? String(body.defaultAgentId) : null;
    if (body.budgetPoolId !== undefined) project.budgetPoolId = body.budgetPoolId ? String(body.budgetPoolId) : null;
    project.updatedAt = now();
    ensureProjectTarget(project);
    persistStateSoon();
    return project;
  }

  function removeWorktree(worktreeId) {
    const index = state.worktrees.findIndex((item) => item.id === worktreeId);
    if (index === -1) return null;
    const [removed] = state.worktrees.splice(index, 1);
    const projectIndex = removed.projectId
      ? state.projects.findIndex((item) => item.id === removed.projectId && item.source === "worktree")
      : -1;
    if (projectIndex !== -1 && state.projects.length > 1) {
      const [project] = state.projects.splice(projectIndex, 1);
      if (state.currentProjectId === project.id) {
        state.currentProjectId = removed.sourceProjectId ?? state.projects[0]?.id ?? null;
      }
      state.projectTargets = state.projectTargets.filter((item) => item.projectId !== project.id);
    }
    appendEvent({
      invocationId: null,
      type: "worktree_removed",
      level: "info",
      message: `Removed worktree ${removed.branchName ?? removed.branch ?? removed.id} from registry.`,
      data: { worktreeId: removed.id, sourceProjectId: removed.sourceProjectId, projectId: removed.projectId },
    });
    persistStateSoon();
    return removed;
  }

  return {
    addProject,
    cloneProject,
    createBlankProject,
    createWorktree,
    currentProject,
    gitProjectSummary,
    worktreeDiff: (worktree) => worktreeDiff(worktree, { projectTargets: state.projectTargets }),
    projectGithubItems: (project) => projectGithubItems(project, { projectTargets: state.projectTargets }),
    projectForInvocation,
    readProjectTree,
    removeProject,
    removeWorktree,
    searchProjectContent,
    selectProject,
    updateProject,
    worktreeForProject,
  };

  function ensureProjectTarget(project) {
    const existing = state.projectTargets.find((item) => item.projectId === project.id);
    if (existing) {
      existing.rootPath = project.path;
      existing.remoteUrl = project.git?.remoteUrl ?? existing.remoteUrl ?? null;
      existing.defaultBranch = project.git?.defaultBranch ?? project.git?.currentBranch ?? existing.defaultBranch ?? null;
      existing.state = existing.state ?? "ready";
      existing.progress = existing.progress ?? 100;
      existing.message = existing.message ?? "Local checkout is ready.";
      existing.updatedAt = now();
      return existing;
    }
    const createdAt = now();
    const target = {
      id: `tgt_${project.id}`,
      projectId: project.id,
      deviceId: "dev_local_001",
      kind: project.source === "clone" ? "clone" : "local",
      remoteUrl: project.git?.remoteUrl ?? null,
      rootPath: project.path,
      defaultBranch: project.git?.defaultBranch ?? project.git?.currentBranch ?? null,
      state: "ready",
      progress: 100,
      message: "Local checkout is ready.",
      createdAt,
      updatedAt: createdAt,
    };
    state.projectTargets.unshift(target);
    return target;
  }
}

export function normalizeProjectPath(value) {
  const projectPath = resolve(String(value ?? "").trim());
  if (!projectPath) {
    throw new Error("Project path is required.");
  }
  if (!existsSync(projectPath)) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }
  if (!statSync(projectPath).isDirectory()) {
    throw new Error(`Project path is not a directory: ${projectPath}`);
  }
  return projectPath;
}

export function sameProjectPath(a, b) {
  return resolve(String(a)).toLowerCase() === resolve(String(b)).toLowerCase();
}

function isLikelyGitUrl(value) {
  return /^(https?:\/\/|ssh:\/\/|git@)[^\s]+$/i.test(value);
}

export function repoNameFromGitUrl(value) {
  return String(value)
    .trim()
    .split(/[/:\\]/)
    .filter(Boolean)
    .at(-1)
    ?.replace(/\.git$/i, "") ?? "";
}

function gitRepoRoot(projectPath) {
  const output = execFileSync("git", ["-C", projectPath, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5_000,
  }).trim();
  if (!output) {
    throw new Error("Source project is not a Git repository.");
  }
  return resolve(output);
}

export function normalizeWorktreeBranch(value) {
  const branch = String(value ?? "").trim().replaceAll("\\", "/");
  if (!branch || branch.length > 96 || branch.includes("..") || branch.startsWith("/") || branch.endsWith("/")) {
    throw new Error("Worktree branch name is invalid.");
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) {
    throw new Error("Worktree branch can use letters, numbers, dots, slashes, underscores, and hyphens only.");
  }
  return branch;
}

export function normalizeWorktreeBase(value) {
  const base = String(value ?? "").trim();
  if (!base) return null;
  if (base.length > 96 || base.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(base)) {
    throw new Error("Worktree base ref is invalid.");
  }
  return base;
}

function normalizeProjectColor(value, fallback = "#3b82f6") {
  const color = String(value ?? fallback).trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

export function normalizeWorktreeLink(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const type = value.type === "pr" ? "pr" : value.type === "issue" ? "issue" : null;
  const number = Math.floor(Number(value.number));
  if (!type || !Number.isFinite(number) || number <= 0) return null;
  return {
    type,
    number,
    title: String(value.title ?? `${type.toUpperCase()} #${number}`),
    url: value.url ? String(value.url) : null,
    state: String(value.state ?? "open"),
  };
}

function nextAvailableWorktreePath(repoRoot, worktreeName) {
  const parent = dirname(repoRoot);
  const base = `${basename(repoRoot)}-${worktreeName || "worktree"}`;
  let candidate = resolve(parent, base);
  let index = 2;
  while (existsSync(candidate)) {
    candidate = resolve(parent, `${base}-${index}`);
    index += 1;
  }
  return candidate;
}

export function slugify(value) {
  return String(value ?? "worktree")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "worktree";
}

function readProjectTree(project, { relativePath = "", search = "" } = {}) {
  const root = resolve(project.path);
  const target = safeProjectPath(project, relativePath);
  const stats = statSync(target);
  if (!stats.isDirectory()) {
    throw new Error("Project tree path must be a directory.");
  }

  const gitStatus = gitStatusMap(root);
  const searchText = String(search ?? "").trim().toLowerCase();
  const entries = readdirSync(target, { withFileTypes: true })
    .filter((entry) => ![".git", "node_modules"].includes(entry.name))
    .map((entry) => {
      const fullPath = resolve(target, entry.name);
      const relPath = normalizeRelativePath(relative(root, fullPath));
      const kind = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other";
      return {
        name: entry.name,
        path: relPath,
        kind,
        gitStatus: gitStatus.get(relPath) ?? "clean",
      };
    })
    .filter((entry) => !searchText || entry.name.toLowerCase().includes(searchText) || entry.path.toLowerCase().includes(searchText))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 200);

  return {
    projectId: project.id,
    projectPath: project.path,
    path: normalizeRelativePath(relative(root, target)),
    search: searchText,
    entries,
    truncated: entries.length >= 200,
    gitSummary: gitSummary(gitStatus),
  };
}

function searchProjectContent(project, { query = "", include = "", exclude = "" } = {}) {
  const root = resolve(project.path);
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) {
    return { projectId: project.id, query: "", results: [] };
  }
  if (needle.length < 2) {
    throw new Error("Search text must be at least 2 characters.");
  }
  const includePatterns = splitGlobInput(include);
  const excludePatterns = splitGlobInput(exclude);
  const results = [];
  const stats = { scannedFiles: 0, skippedFiles: 0 };
  walkProjectFiles(root, root, (fullPath, relPath) => {
    if (results.length >= 80 || stats.scannedFiles >= 600) return false;
    if (includePatterns.length && !matchesAnyGlob(relPath, includePatterns)) return true;
    if (excludePatterns.length && matchesAnyGlob(relPath, excludePatterns)) return true;
    const fileStat = statSync(fullPath);
    if (fileStat.size > 512_000 || isProbablyBinary(fullPath)) {
      stats.skippedFiles += 1;
      return true;
    }
    let text = "";
    try {
      text = readFileSync(fullPath, "utf8");
    } catch {
      stats.skippedFiles += 1;
      return true;
    }
    stats.scannedFiles += 1;
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.toLowerCase().includes(needle)) continue;
      results.push({
        path: relPath,
        line: index + 1,
        preview: line.trim().slice(0, 180),
      });
      if (results.length >= 80) return false;
    }
    return true;
  });
  return { projectId: project.id, query, include, exclude, results, stats };
}

function walkProjectFiles(root, directory, visit) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "build", ".next", "coverage"].includes(entry.name)) continue;
    const fullPath = resolve(directory, entry.name);
    const relPath = relative(root, fullPath).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      const shouldContinue = walkProjectFiles(root, fullPath, visit);
      if (!shouldContinue) return false;
      continue;
    }
    if (!entry.isFile()) continue;
    const shouldContinue = visit(fullPath, relPath);
    if (!shouldContinue) return false;
  }
  return true;
}

function splitGlobInput(value) {
  return String(value ?? "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchesAnyGlob(path, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

function globToRegExp(pattern) {
  const globstar = "__MYAGENTTOOL_GLOBSTAR__";
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, globstar)
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped.replaceAll(globstar, ".*")}$`, "i");
}

function isProbablyBinary(path) {
  return /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|7z|exe|dll|pdb|woff2?|ttf|otf)$/i.test(path);
}

function safeProjectPath(project, relativePath = "") {
  const root = resolve(project.path);
  const target = resolve(root, String(relativePath ?? ""));
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || resolve(target) === resolve(root, "..")) {
    throw new Error("Project tree path escapes the registered project root.");
  }
  if (!existsSync(target)) {
    throw new Error("Project tree path does not exist.");
  }
  return target;
}

function gitStatusMap(root) {
  const statuses = new Map();
  try {
    const output = execFileSync("git", ["-C", root, "status", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3_000,
    });
    for (const line of output.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const code = line.slice(0, 2);
      const filePath = normalizeRelativePath(line.slice(3).replace(/^"|"$/g, ""));
      const status = code.includes("D") ? "deleted" : code.includes("A") || code.includes("?") ? "added" : "modified";
      statuses.set(filePath, status);
    }
  } catch {
    return statuses;
  }
  return statuses;
}

function gitSummary(statuses) {
  const summary = { modified: 0, added: 0, deleted: 0 };
  for (const status of statuses.values()) {
    if (summary[status] !== undefined) summary[status] += 1;
  }
  return summary;
}

function gitProjectSummary(project) {
  const root = resolve(project.path);
  const branch = gitOutput(root, ["branch", "--show-current"]) || "detached";
  const upstream = gitOutput(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const changes = [];
  const output = gitOutput(root, ["status", "--porcelain"]);
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const statusCode = line.slice(0, 2).trim() || "M";
    const relPath = normalizeRelativePath(line.slice(3).replace(/^"|"$/g, ""));
    changes.push({
      path: relPath,
      name: basename(relPath),
      directory: dirname(relPath) === "." ? "" : normalizeRelativePath(dirname(relPath)),
      status: statusCode,
      additions: statusCode.includes("A") || statusCode.includes("?") ? 1 : 0,
      deletions: statusCode.includes("D") ? 1 : 0,
    });
  }
  return {
    projectId: project.id,
    branch,
    upstream,
    published: Boolean(upstream),
    changes,
    summary: gitSummary(gitStatusMap(root)),
  };
}

function gitOutput(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    }).trim();
  } catch {
    return "";
  }
}

// Full unified diff for a worktree: porcelain status letters + the tracked diff
// against the merge-base with upstream (or the target's default branch), plus
// untracked files rendered as additions. Bounded on output size and untracked
// file count so a worktree missing a .gitignore can't blow up the response.
function worktreeDiff(worktree, { projectTargets = [] } = {}) {
  const cwd = worktree.path;
  // maxBuffer well above MAX_DIFF_BYTES: without it execFileSync defaults to 1 MiB
  // and throws ENOBUFS on a large diff *before* the cap logic runs, so the catch
  // would silently return an empty diff for a worktree with real changes.
  const git = (args) =>
    execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 64 * 1024 * 1024,
      // stdout piped (gitDiffSafe reads error.stdout on the expected --no-index
      // non-zero exit); stderr ignored so benign "no upstream" probes stay quiet.
      stdio: ["ignore", "pipe", "ignore"],
    });
  // `git diff --no-index` exits non-zero when files differ; the patch we want is
  // still on the thrown error's stdout.
  const gitDiffSafe = (args) => {
    try {
      return git(args);
    } catch (error) {
      return typeof error?.stdout === "string" ? error.stdout : "";
    }
  };
  const MAX_DIFF_BYTES = 1024 * 1024;
  const result = { files: [], base: "HEAD", diff: "", truncated: false };
  try {
    // --untracked-files=all lists each untracked file individually; the default
    // collapses an untracked dir to "dir/", which then can't be diffed against
    // /dev/null and silently omits its files from the patch.
    const porcelain = git(["-c", "core.quotepath=false", "status", "--porcelain", "--untracked-files=all"]).split("\n").filter(Boolean);
    result.files = porcelain.map((line) => {
      const index = line[0];
      const work = line[1];
      let p = line.slice(3);
      if (p.includes(" -> ")) p = p.split(" -> ")[1];
      return { path: p, index, work, untracked: index === "?" };
    });
  } catch {
    /* leave empty */
  }
  let base = "HEAD";
  try {
    const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).trim();
    base = git(["merge-base", upstream, "HEAD"]).trim() || "HEAD";
  } catch {
    const target = projectTargets.find((t) => t.id === worktree.targetId);
    const def = target?.defaultBranch;
    if (def) {
      try {
        base = git(["merge-base", def, "HEAD"]).trim() || "HEAD";
      } catch {
        base = "HEAD";
      }
    }
  }
  result.base = base;
  let diff = "";
  try {
    diff = git(["diff", "--no-color", base, "--"]);
  } catch {
    /* no commits yet, or bad base */
  }
  const MAX_UNTRACKED = 200;
  let untrackedSeen = 0;
  for (const f of result.files) {
    if (!f.untracked) continue;
    if (diff.length > MAX_DIFF_BYTES || untrackedSeen >= MAX_UNTRACKED) {
      result.truncated = true;
      break;
    }
    untrackedSeen += 1;
    const patch = gitDiffSafe(["diff", "--no-color", "--no-index", "--", devNull, f.path]);
    if (patch) diff += (diff && !diff.endsWith("\n") ? "\n" : "") + patch;
  }
  if (diff.length > MAX_DIFF_BYTES) {
    diff = diff.slice(0, MAX_DIFF_BYTES);
    result.truncated = true;
  }
  result.diff = diff;
  return result;
}

// GitHub issues + PRs for a repo-backed project, via the `gh` CLI. Returns
// `{ available, message, items }` — the shape the Task view consumes. Degrades
// gracefully (available:false + reason) when there is no ready repo, no GitHub
// remote, or `gh` is unauthenticated.
// Async so the two `gh` calls (up to 15s each) don't block the server's single
// event-loop thread — this runs inside an HTTP handler.
async function projectGithubItems(project, { projectTargets = [] } = {}) {
  const target = projectTargets.find((t) => t.projectId === project.id && t.state === "ready");
  if (!target) return { available: false, message: "Project has no ready repository.", items: [] };
  let remote = "";
  try {
    remote = (await execFileAsync("git", ["-C", target.rootPath, "remote", "get-url", "origin"], {
      encoding: "utf8",
      timeout: 5_000,
    })).stdout.trim();
  } catch {
    remote = "";
  }
  if (!/github\.com/i.test(remote)) {
    return { available: false, message: "No GitHub remote (origin) on this repository.", items: [] };
  }
  const ghJson = async (args) => {
    try {
      const { stdout } = await execFileAsync("gh", args, { cwd: target.rootPath, encoding: "utf8", timeout: 15_000 });
      return JSON.parse(stdout || "[]") || [];
    } catch {
      return null;
    }
  };
  const [prsRaw, issuesRaw] = await Promise.all([
    ghJson(["pr", "list", "--json", "number,title,headRefName,author,url,state", "--limit", "30"]),
    ghJson(["issue", "list", "--json", "number,title,author,url,state", "--limit", "30"]),
  ]);
  if (prsRaw === null && issuesRaw === null) {
    return { available: false, message: "gh list failed (auth or remote?).", items: [] };
  }
  const items = [
    ...(prsRaw ?? []).map((p) => ({ type: "pr", number: p.number, title: p.title, headRefName: p.headRefName, author: p.author?.login ?? "", url: p.url, state: (p.state ?? "open").toLowerCase() })),
    ...(issuesRaw ?? []).map((i) => ({ type: "issue", number: i.number, title: i.title, headRefName: null, author: i.author?.login ?? "", url: i.url, state: (i.state ?? "open").toLowerCase() })),
  ].sort((a, b) => b.number - a.number);
  const prCount = (prsRaw ?? []).length;
  const issueCount = (issuesRaw ?? []).length;
  return { available: true, message: `${prCount} open PR(s), ${issueCount} open issue(s).`, items };
}

function normalizeRelativePath(value) {
  return String(value ?? "").replaceAll("\\", "/");
}
