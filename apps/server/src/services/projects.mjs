import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

function defaultNow() {
  return new Date().toISOString();
}

export function createProjectRecord(
  { id, name, path, host = "local", source = "user", worktree = null } = {},
  { nextId, now = defaultNow } = {}
) {
  const projectPath = normalizeProjectPath(path);
  const createdAt = now();
  return {
    id: id ?? (typeof nextId === "function" ? nextId("prj_demo") : `prj_demo_${Date.now().toString(36)}`),
    name: String(name || basename(projectPath) || "Project").trim(),
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
      path: body.path,
      host: body.host ?? "local",
      source: "registered",
    }, { nextId, now });
    const existing = state.projects.find((item) => sameProjectPath(item.path, project.path));
    if (existing) {
      existing.name = project.name || existing.name;
      existing.host = project.host;
      existing.updatedAt = now();
      selectProject(existing.id);
      return existing;
    }
    state.projects.unshift(project);
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
    return addProject({ name: body.name || name, path: targetPath, host: body.host ?? "local" });
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
    return addProject({ name: body.name, path: targetPath, host: body.host ?? "local" });
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
    const projectId = invocation?.options?.metadata?.projectId ?? state.currentProjectId;
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
      projectId: null,
      repoPath: repoRoot,
      worktreePath: targetPath,
      branchName,
      baseBranch: baseBranch ?? "HEAD",
      status: "ready",
      createdAt,
      lastSeenAt: createdAt,
    };
    const project = createProjectRecord({
      name: body.name || `${sourceProject.name} / ${branchName.split("/").at(-1)}`,
      path: targetPath,
      host: sourceProject.host ?? "local",
      source: "worktree",
      worktree: {
        id: worktree.id,
        sourceProjectId: sourceProject.id,
        branchName,
        baseBranch: worktree.baseBranch,
      },
    }, { nextId, now });
    worktree.projectId = project.id;
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

  return {
    addProject,
    cloneProject,
    createBlankProject,
    createWorktree,
    currentProject,
    gitProjectSummary,
    projectForInvocation,
    readProjectTree,
    removeProject,
    searchProjectContent,
    selectProject,
    worktreeForProject,
  };
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

function repoNameFromGitUrl(value) {
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

function normalizeWorktreeBranch(value) {
  const branch = String(value ?? "").trim().replaceAll("\\", "/");
  if (!branch || branch.length > 96 || branch.includes("..") || branch.startsWith("/") || branch.endsWith("/")) {
    throw new Error("Worktree branch name is invalid.");
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) {
    throw new Error("Worktree branch can use letters, numbers, dots, slashes, underscores, and hyphens only.");
  }
  return branch;
}

function normalizeWorktreeBase(value) {
  const base = String(value ?? "").trim();
  if (!base) return null;
  if (base.length > 96 || base.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(base)) {
    throw new Error("Worktree base ref is invalid.");
  }
  return base;
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

function slugify(value) {
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

function normalizeRelativePath(value) {
  return String(value ?? "").replaceAll("\\", "/");
}
