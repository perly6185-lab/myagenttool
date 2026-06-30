import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";

export async function handleProjectRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  state,
  currentProject,
  addProject,
  cloneProject,
  createBlankProject,
  createWorktree,
  selectProject,
  removeProject,
  removeWorktree,
  updateProject,
  readProjectTree,
  searchProjectContent,
  gitProjectSummary,
}) {
  if (req.method === "GET" && url.pathname === "/api/projects") {
    sendJson(res, 200, { projects: state.projects, currentProjectId: state.currentProjectId, currentProject: currentProject() });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/worktrees") {
    sendJson(res, 200, { worktrees: state.worktrees, currentProjectId: state.currentProjectId, currentProject: currentProject() });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/projects") {
    const body = await readJson(req);
    let project;
    try {
      if (body.repoUrl) {
        project = cloneProject({
          ...body,
          gitUrl: body.repoUrl,
          parentPath: body.parentDir,
        });
      } else if (body.repoPath) {
        project = addProject({ ...body, path: body.repoPath });
      } else {
        project = addProject(body);
      }
    } catch (error) {
      sendJson(res, 400, {
        error: "invalid_project",
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    sendJson(res, 201, { project, projects: state.projects, currentProjectId: state.currentProjectId });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/clone") {
    const body = await readJson(req);
    let project;
    try {
      project = cloneProject(body);
    } catch (error) {
      sendJson(res, 400, {
        error: "invalid_project_clone",
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    sendJson(res, 201, { project, projects: state.projects, currentProjectId: state.currentProjectId });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/create") {
    const body = await readJson(req);
    let project;
    try {
      project = createBlankProject(body);
    } catch (error) {
      sendJson(res, 400, {
        error: "invalid_project_create",
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    sendJson(res, 201, { project, projects: state.projects, currentProjectId: state.currentProjectId });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/worktrees") {
    const body = await readJson(req);
    await createWorktreeResponse({ body, createWorktree, sendJson, res });
    return true;
  }

  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && req.method === "POST") {
    const project = selectProject(decodeURIComponent(projectMatch[1]));
    if (!project) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    sendJson(res, 200, { project, projects: state.projects, currentProjectId: state.currentProjectId });
    return true;
  }

  if (projectMatch && req.method === "PATCH") {
    const project = updateProject(decodeURIComponent(projectMatch[1]), await readJson(req));
    if (!project) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    sendJson(res, 200, { project, projects: state.projects, currentProjectId: state.currentProjectId });
    return true;
  }

  if (projectMatch && req.method === "DELETE") {
    let removed;
    try {
      removed = removeProject(decodeURIComponent(projectMatch[1]));
    } catch (error) {
      sendJson(res, 400, {
        error: "project_remove_blocked",
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    if (!removed) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    sendJson(res, 200, { removed, projects: state.projects, currentProjectId: state.currentProjectId, currentProject: currentProject() });
    return true;
  }

  const projectWorktreeMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/worktrees$/);
  if (projectWorktreeMatch && req.method === "POST") {
    const body = await readJson(req);
    await createWorktreeResponse({
      body: {
        ...body,
        projectId: decodeURIComponent(projectWorktreeMatch[1]),
        branchName: body.branchName ?? body.ref ?? body.name,
        baseBranch: body.baseBranch ?? body.startPoint,
      },
      createWorktree,
      sendJson,
      res,
    });
    return true;
  }

  const projectTreeMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/tree$/);
  if (projectTreeMatch && req.method === "GET") {
    const project = state.projects.find((item) => item.id === decodeURIComponent(projectTreeMatch[1]));
    if (!project) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    try {
      const tree = readProjectTree(project, {
        relativePath: url.searchParams.get("path") ?? "",
        search: url.searchParams.get("search") ?? "",
      });
      sendJson(res, 200, tree);
    } catch (error) {
      sendJson(res, 400, {
        error: "project_tree_unavailable",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  const projectSearchMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/search$/);
  if (projectSearchMatch && req.method === "GET") {
    const project = state.projects.find((item) => item.id === decodeURIComponent(projectSearchMatch[1]));
    if (!project) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    try {
      const results = searchProjectContent(project, {
        query: url.searchParams.get("q") ?? "",
        include: url.searchParams.get("include") ?? "",
        exclude: url.searchParams.get("exclude") ?? "",
      });
      sendJson(res, 200, results);
    } catch (error) {
      sendJson(res, 400, {
        error: "project_content_search_unavailable",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  const projectGitSummaryMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/git-summary$/);
  if (projectGitSummaryMatch && req.method === "GET") {
    const project = state.projects.find((item) => item.id === decodeURIComponent(projectGitSummaryMatch[1]));
    if (!project) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    try {
      sendJson(res, 200, gitProjectSummary(project));
    } catch (error) {
      sendJson(res, 400, {
        error: "project_git_summary_unavailable",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  const projectGithubMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/github$/);
  if (projectGithubMatch && req.method === "GET") {
    const project = state.projects.find((item) => item.id === decodeURIComponent(projectGithubMatch[1]));
    if (!project) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    sendJson(res, 200, { issues: [], pullRequests: [], repository: project.git?.remoteUrl ?? null });
    return true;
  }

  const projectBranchesMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/branches$/);
  if (projectBranchesMatch && req.method === "GET") {
    const project = state.projects.find((item) => item.id === decodeURIComponent(projectBranchesMatch[1]));
    if (!project) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    try {
      const summary = gitProjectSummary(project);
      sendJson(res, 200, { branches: [summary.branch].filter(Boolean), current: summary.branch });
    } catch {
      sendJson(res, 200, { branches: [], current: null });
    }
    return true;
  }

  const suggestionMatch = url.pathname === "/api/worktree-name-suggestion";
  if (suggestionMatch && req.method === "POST") {
    const body = await readJson(req);
    sendJson(res, 200, { name: slugify(String(body.description ?? "worktree")) });
    return true;
  }

  const worktreeMatch = url.pathname.match(/^\/api\/worktrees\/([^/]+)(?:\/([^/]+))?$/);
  if (worktreeMatch) {
    const worktree = state.worktrees.find((item) => item.id === decodeURIComponent(worktreeMatch[1]));
    if (!worktree) {
      sendJson(res, 404, { error: "worktree_not_found" });
      return true;
    }
    const project = projectForWorktree(state, worktree);
    if (!project) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    const action = worktreeMatch[2] ?? "";
    if (!action && req.method === "DELETE") {
      const removed = removeWorktree(worktree.id);
      sendJson(res, 200, { removed, worktrees: state.worktrees });
      return true;
    }
    if (action === "files" && req.method === "GET") {
      try {
        const tree = readProjectTree(project, { relativePath: url.searchParams.get("path") ?? "" });
        sendJson(res, 200, { tree: treeEntriesToNodes(tree.entries ?? []) });
      } catch (error) {
        sendJson(res, 400, { error: "worktree_files_unavailable", message: errorMessage(error) });
      }
      return true;
    }
    if (action === "search" && req.method === "GET") {
      const query = url.searchParams.get("q") ?? "";
      const mode = url.searchParams.get("mode") ?? "name";
      try {
        if (mode === "content") {
          const result = searchProjectContent(project, { query });
          sendJson(res, 200, { matches: (result.results ?? []).map((item) => ({ path: item.path, line: item.line, text: item.preview })) });
        } else {
          const tree = readProjectTree(project, { search: query });
          sendJson(res, 200, { matches: (tree.entries ?? []).map((item) => ({ path: item.path, text: item.name })) });
        }
      } catch (error) {
        sendJson(res, 400, { error: "worktree_search_unavailable", message: errorMessage(error) });
      }
      return true;
    }
    if (action === "file" && req.method === "GET") {
      try {
        const file = safeProjectFile(project, url.searchParams.get("path") ?? "");
        const stats = existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
        const maxBytes = 512 * 1024;
        sendJson(res, 200, {
          path: relative(project.path, file).replaceAll("\\", "/"),
          content: stats.subarray(0, maxBytes).toString("utf8"),
          truncated: stats.length > maxBytes,
        });
      } catch (error) {
        sendJson(res, 400, { error: "worktree_file_unavailable", message: errorMessage(error) });
      }
      return true;
    }
    if (action === "git" && req.method === "GET") {
      try {
        sendJson(res, 200, gitSummaryForWorktree(gitProjectSummary(project)));
      } catch (error) {
        sendJson(res, 400, { error: "worktree_git_unavailable", message: errorMessage(error) });
      }
      return true;
    }
    if (action === "diff" && req.method === "GET") {
      try {
        const summary = gitProjectSummary(project);
        sendJson(res, 200, {
          files: (summary.changes ?? []).map((change) => ({
            path: change.path,
            index: change.status,
            work: change.status,
            untracked: String(change.status).includes("?"),
          })),
          base: summary.upstream ?? "HEAD",
          diff: "",
          truncated: false,
        });
      } catch (error) {
        sendJson(res, 400, { error: "worktree_diff_unavailable", message: errorMessage(error) });
      }
      return true;
    }
    if (action === "attachments" && req.method === "POST") {
      try {
        const body = await readJson(req);
        const saved = saveAttachments(project, body.files);
        sendJson(res, 201, { attachments: saved });
      } catch (error) {
        sendJson(res, 400, { error: "worktree_attachment_failed", message: errorMessage(error) });
      }
      return true;
    }
    if ((action === "push" || action === "pr") && req.method === "POST") {
      sendJson(res, 200, {
        ok: true,
        worktreeId: worktree.id,
        skipped: true,
        message: "Git publishing is not executed by the local server compatibility route.",
      });
      return true;
    }
  }

  return false;
}

async function createWorktreeResponse({ body, createWorktree, sendJson, res }) {
  let result;
  try {
    result = createWorktree(body);
  } catch (error) {
    sendJson(res, 400, {
      error: "invalid_worktree",
      message: errorMessage(error),
    });
    return;
  }
  sendJson(res, 201, result);
}

function projectForWorktree(state, worktree) {
  return state.projects.find((item) => item.id === worktree.projectId)
    ?? state.projects.find((item) => item.id === worktree.sourceProjectId)
    ?? null;
}

function treeEntriesToNodes(entries) {
  return entries.map((entry) => ({
    name: entry.name,
    path: entry.path,
    dir: entry.kind === "directory",
    children: entry.kind === "directory" ? [] : undefined,
  }));
}

function safeProjectFile(project, relativePath) {
  const root = resolve(project.path);
  const target = resolve(root, String(relativePath ?? ""));
  const rel = relative(root, target);
  if (!rel || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../")) {
    throw new Error("Requested file escapes the worktree root.");
  }
  if (!existsSync(target)) {
    throw new Error("Requested file does not exist.");
  }
  return target;
}

function gitSummaryForWorktree(summary) {
  const changedFiles = (summary.changes ?? []).length;
  return {
    branch: summary.branch,
    changedFiles,
    clean: changedFiles === 0,
    hasUpstream: Boolean(summary.upstream),
    upstream: summary.upstream || null,
    ahead: 0,
    behind: 0,
  };
}

function saveAttachments(project, files) {
  if (!Array.isArray(files)) return [];
  const attachmentDir = resolve(project.path, ".myagenttool", "attachments");
  mkdirSync(attachmentDir, { recursive: true });
  return files.slice(0, 6).map((file, index) => {
    const safeName = slugify(String(file?.name ?? `attachment-${index + 1}`)) || `attachment-${index + 1}`;
    const target = resolve(attachmentDir, safeName);
    const rel = relative(project.path, target);
    if (rel === ".." || rel.startsWith("..\\") || rel.startsWith("../")) {
      throw new Error("Attachment path escapes the worktree root.");
    }
    writeFileSync(target, Buffer.from(String(file?.dataBase64 ?? ""), "base64"));
    return {
      name: safeName,
      path: rel.replaceAll("\\", "/"),
    };
  });
}

function slugify(value) {
  return String(value ?? "worktree")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "worktree";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
