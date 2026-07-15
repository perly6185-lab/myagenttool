import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { DEFAULT_DEVICE_ID } from "../runtime/device.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

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
    // The worktree/checkout the workspace is currently scoped to (null = the
    // registered root itself, for shared-isolation projects). Set as worktrees
    // are created/selected (Agent Workspace #160).
    activeCheckoutId: null,
    source,
    worktree,
    createdAt,
    updatedAt: createdAt,
    lastOpenedAt: createdAt,
  };
}

// Best-effort git facts for a registered project root (Agent Workspace #160):
// remote URL, default branch, current branch. Sync (matches the file's other git
// probes) and never throws — a non-repo folder yields isRepo:false + null fields
// so metadata is "captured when available and gracefully omitted otherwise".
export function readGitFacts(cwd) {
  const g = (args) => {
    try {
      return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return "";
    }
  };
  if (!cwd || g(["rev-parse", "--is-inside-work-tree"]) !== "true") {
    return { repoPath: cwd ?? null, remoteUrl: null, defaultBranch: null, currentBranch: null, isRepo: false };
  }
  const remoteUrl = g(["remote", "get-url", "origin"]) || null;
  const headRef = g(["rev-parse", "--abbrev-ref", "HEAD"]);
  const currentBranch = headRef && headRef !== "HEAD" ? headRef : null; // "HEAD" = detached
  let defaultBranch = null;
  const originHead = g(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  if (originHead) {
    defaultBranch = originHead.replace(/^refs\/remotes\/origin\//, "");
  } else {
    for (const cand of ["main", "master"]) {
      if (g(["rev-parse", "--verify", "--quiet", `refs/heads/${cand}`])) { defaultBranch = cand; break; }
    }
  }
  return { repoPath: cwd, remoteUrl, defaultBranch, currentBranch, isRepo: true };
}

export function createProjectService({ state, now, nextId, appendEvent, persistStateSoon, store }) {
  // #1001 Phase A: durable project/worktree/review writes commit through the
  // Store's unit of work (falls back to the debounce where no store is injected).
  const runTx = makeRunTx({ store, persistStateSoon });
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
    // Capture git facts (remote/default/current branch) from the real root — #160.
    project.git = readGitFacts(project.path);
    return runTx(() => {
      const existing = state.projects.find((item) => sameProjectPath(item.path, project.path));
      if (existing) {
        existing.name = project.name || existing.name;
        existing.host = project.host;
        existing.git = project.git;
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
      return project;
    });
  }

  // Async so the (potentially slow) `git clone` runs off the event loop instead
  // of freezing the whole server for the duration (#305). Input is validated
  // synchronously up front, so bad requests still reject immediately; only the
  // clone itself awaits. Callers await it (the routes + application register).
  async function cloneProject(body = {}) {
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
    await execFileAsync("git", ["clone", gitUrl, targetPath], {
      encoding: "utf8",
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
    return runTx(() => {
      state.currentProjectId = project.id;
      project.lastOpenedAt = now();
      project.updatedAt = project.lastOpenedAt;
      return project;
    });
  }

  function removeProject(projectId) {
    if (state.projects.length <= 1) {
      throw new Error("At least one project must remain registered.");
    }
    const index = state.projects.findIndex((item) => item.id === projectId);
    if (index === -1) return null;
    return runTx(() => {
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
      return removed;
    });
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
    // A worktree is reachable from BOTH of its projects: the source repo project
    // (`projectId`) and the derived workspace project created for the checkout
    // (`workspaceProjectId`). Matching only the source meant an invocation
    // created while the WORKSPACE project was current carried no worktreeId at
    // all — sessions/evidence silently lost their worktree scope (caught by
    // tools/dev/worktree-smoke.mjs, which was never wired into a gate).
    return state.worktrees.find(
      (item) => item.projectId === projectId || item.workspaceProjectId === projectId,
    ) ?? null;
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

    // Fork point. For issue→PR runs (body.fetchBase), fork from the FRESH remote base
    // (origin/<base>) so the PR opens on top of current origin — not a stale LOCAL branch
    // that lags behind concurrently-merged work, which made every auto-run PR conflict.
    // Best-effort: fall back to the local base / HEAD when there's no origin or the fetch fails.
    let startPoint = baseBranch;
    if (body.fetchBase) {
      const base = baseBranch || readGitFacts(repoRoot).defaultBranch;
      const tryGit = (args) => {
        try {
          execFileSync("git", ["-C", repoRoot, ...args], { timeout: 30_000, stdio: ["ignore", "ignore", "ignore"] });
          return true;
        } catch {
          return false;
        }
      };
      if (base && tryGit(["fetch", "origin", base]) && tryGit(["rev-parse", "--verify", "--quiet", `origin/${base}`])) {
        startPoint = `origin/${base}`;
      }
    }
    const gitArgs = ["-C", repoRoot, "worktree", "add", "-b", branchName, targetPath];
    if (startPoint) {
      gitArgs.push(startPoint);
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
    // Capture git facts for the worktree checkout too, so the workspace header shows
    // its branch/remote instead of "not a git repository". (review D)
    project.git = readGitFacts(project.path);
    runTx(() => {
      project.activeCheckoutId = worktree.id;
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
    });
    return { worktree, project, projects: state.projects, currentProjectId: state.currentProjectId };
  }

  function updateProject(projectId, body = {}) {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return null;
    return runTx(() => {
    if (body.name !== undefined) project.name = String(body.name).trim() || project.name;
    if (body.color !== undefined) project.color = normalizeProjectColor(body.color, project.color);
    if (body.status !== undefined) project.status = body.status === "archived" ? "archived" : "active";
    if (body.isolation !== undefined) project.isolation = body.isolation === "worktree" ? "worktree" : "shared";
    if (body.defaultAgentId !== undefined) project.defaultAgentId = body.defaultAgentId ? String(body.defaultAgentId) : null;
    if (body.budgetPoolId !== undefined) project.budgetPoolId = body.budgetPoolId ? String(body.budgetPoolId) : null;
    // A4: the project's chosen verify command NAME (a key into the operator's
    // env allowlist — never a command). Unknown names harmlessly fall back at
    // resolution time; blank clears the selection.
    if (body.verifyCommandName !== undefined) {
      project.verifyCommandName = body.verifyCommandName ? String(body.verifyCommandName).trim() || null : null;
    }
    project.updatedAt = now();
    ensureProjectTarget(project);
    return project;
    });
  }

  function removeWorktree(worktreeId) {
    const index = state.worktrees.findIndex((item) => item.id === worktreeId);
    if (index === -1) return null;
    return runTx(() => {
    const [removed] = state.worktrees.splice(index, 1);
    // The derived workspace project is keyed by workspaceProjectId; projectId
    // points at the SOURCE project (source "user"), which the source==="worktree"
    // filter can never match — using it alone leaked one orphaned workspace
    // project row on every removal.
    const derivedProjectId = removed.workspaceProjectId ?? removed.projectId;
    const projectIndex = derivedProjectId
      ? state.projects.findIndex((item) => item.id === derivedProjectId && item.source === "worktree")
      : -1;
    if (projectIndex !== -1 && state.projects.length > 1) {
      const [project] = state.projects.splice(projectIndex, 1);
      if (state.currentProjectId === project.id) {
        state.currentProjectId = removed.sourceProjectId ?? state.projects[0]?.id ?? null;
      }
      state.projectTargets = state.projectTargets.filter((item) => item.projectId !== project.id);
    }
    // Removal is intentionally NON-destructive on disk (files + the git worktree
    // registration are kept — see the worktree-lifecycle test and the Line A
    // design note), but the review rows that pointed at this worktree must not
    // dangle in state after it's gone from the registry.
    if (Array.isArray(state.worktreeReviews)) {
      state.worktreeReviews = state.worktreeReviews.filter((review) => review.worktreeId !== removed.id);
    }

    appendEvent({
      invocationId: null,
      type: "worktree_removed",
      level: "info",
      message: `Removed worktree ${removed.branchName ?? removed.branch ?? removed.id} from registry.`,
      data: { worktreeId: removed.id, sourceProjectId: removed.sourceProjectId, projectId: removed.projectId },
    });
    return removed;
    });
  }

  // Teardown for an ABANDONED worktree — a denied/rejected auto-run that never
  // produced work — so a fresh run on the same issue can re-create `issue-N`
  // instead of failing on "branch already exists". Unlike removeWorktree
  // (registry-only, deliberately non-destructive per Line A), this reclaims the
  // git worktree AND its branch.
  //
  // SAFETY (data loss): a denied RETRY can reuse a worktree that a PRIOR approved
  // run already committed to — that work is local-only until publish. So this must
  // NEVER discard work. It deliberately uses the SAFE git forms and lets git itself
  // refuse when there's anything to lose: `git worktree remove` (no --force) refuses
  // a dirty worktree, and `git branch -d` refuses a branch with commits not merged
  // into its base. An UNTOUCHED worktree (the common denied-at-the-gate case) is
  // clean and its branch empty, so both succeed and the re-run is unblocked as
  // intended. Best-effort; registry cleanup is delegated to removeWorktree.
  function destroyWorktree(worktreeId, { deleteBranch = true } = {}) {
    const worktree = state.worktrees.find((item) => item.id === worktreeId);
    if (!worktree) return null;
    const repoRoot = worktree.repoPath ?? null;
    const wtPath = worktree.worktreePath ?? worktree.path ?? null;
    const branch = worktree.branchName ?? worktree.branch ?? null;
    const runGit = (args) => {
      try {
        execFileSync("git", ["-C", repoRoot, ...args], { timeout: 20_000, stdio: ["ignore", "pipe", "pipe"] });
        return true;
      } catch {
        return false;
      }
    };
    if (repoRoot && wtPath) {
      const removed = runGit(["worktree", "remove", wtPath]);
      runGit(["worktree", "prune"]); // reconcile a registration whose dir was already gone
      // git kept a DIRTY worktree (un-pushed uncommitted work): preserve the whole
      // record — don't drop the registry row and don't touch its checked-out branch.
      if (!removed && existsSync(wtPath)) return null;
    }
    // Delete the branch AFTER the worktree is gone (a checked-out branch can't be
    // deleted). `-d` (not `-D`) refuses to drop a branch carrying un-merged commits,
    // so committed work on a reused worktree is never force-deleted.
    if (repoRoot && deleteBranch && branch && !worktree.isMain) {
      runGit(["branch", "-d", branch]);
    }
    return removeWorktree(worktreeId);
  }

  function worktreeRecord(worktreeId) {
    return state.worktrees.find((item) => item.id === worktreeId) ?? null;
  }

  // The worktree's current HEAD commit, best-effort (null if unavailable). Used to
  // bind a review to the exact diff it approved so a later commit can't be promoted
  // on that stale approval.
  function worktreeHeadCommit(worktreeId) {
    const wt = worktreeRecord(worktreeId);
    const cwd = wt?.worktreePath ?? wt?.path;
    if (!cwd) return null;
    try {
      return execFileSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
    } catch {
      return null;
    }
  }

  // Commit whatever the agent left in the worktree so the work actually reaches
  // the PR — publish only ships commits. No-op (committed:false) when the tree is
  // already clean. hasCommits reports whether the branch has any commit ahead of
  // its base, so the caller can avoid opening an empty PR.
  async function commitWorktreeChanges(worktreeId, { message, pathspec = null } = {}) {
    const worktree = worktreeRecord(worktreeId);
    if (!worktree) throw new Error("Worktree not found.");
    const cwd = worktree.path ?? worktree.worktreePath;
    if (!cwd || !existsSync(cwd)) throw new Error("Worktree working directory is missing.");

    // An optional pathspec scopes the commit (e.g. Layer B's render commit stages
    // only `design/`, so a stray file from the operator's renderer can't ride the
    // push). Default: the whole tree (`-A`), the develop path's behavior.
    const scope = Array.isArray(pathspec) && pathspec.length ? ["--", ...pathspec] : [];
    const status = await runGitCapture(cwd, ["status", "--porcelain", ...scope], { timeout: 10_000 });
    if (!status.ok) throw new Error(`git status failed: ${status.stderr || `exit ${status.code}`}`);
    let committed = false;
    if (status.stdout.trim()) {
      const add = await runGitCapture(cwd, scope.length ? ["add", ...scope] : ["add", "-A"], { timeout: 20_000 });
      if (!add.ok) throw new Error(`git add failed: ${add.stderr || `exit ${add.code}`}`);
      const commit = await runGitCapture(cwd, ["commit", "-m", message || "Auto-run changes"], { timeout: 20_000 });
      if (!commit.ok) throw new Error(`git commit failed: ${commit.stderr || commit.stdout || `exit ${commit.code}`}`);
      committed = true;
    }

    // Does the branch have anything to open a PR with? Compare to the base ref
    // (an explicit base branch, else origin's default, else main).
    const base = await resolvePrBaseBranch(cwd, worktree);
    const ahead = await runGitCapture(cwd, ["rev-list", "--count", `${base}..HEAD`], { timeout: 10_000 });
    const hasCommits = ahead.ok ? Number(ahead.stdout) > 0 : committed;
    return { committed, hasCommits, base };
  }

  // Push the worktree's branch to origin and record its upstream. Real git push
  // (no --force unless asked), so an unreachable/missing origin surfaces as an
  // error rather than the old silent skipped:true stub.
  async function publishWorktreeBranch(worktreeId, { force = false } = {}) {
    const worktree = worktreeRecord(worktreeId);
    if (!worktree) throw new Error("Worktree not found.");
    const cwd = worktree.path ?? worktree.worktreePath;
    const branch = worktree.branchName ?? worktree.branch;
    if (!cwd || !existsSync(cwd)) throw new Error("Worktree working directory is missing.");
    if (!branch) throw new Error("Worktree has no branch to publish.");
    const remoteUrl = await originRemoteUrl(cwd);
    if (!remoteUrl) throw new Error("No 'origin' remote to publish to. Add a remote first.");

    const pushArgs = ["push", "--set-upstream", "origin", branch];
    if (force) pushArgs.splice(1, 0, "--force-with-lease");
    const push = await runGitCapture(cwd, pushArgs);
    if (!push.ok) {
      throw new Error(`git push failed: ${push.stderr || push.stdout || `exit ${push.code}`}`);
    }

    const upstreamProbe = await runGitCapture(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { timeout: 5_000 });
    runTx(() => {
      worktree.published = true;
      worktree.upstream = upstreamProbe.ok && upstreamProbe.stdout ? upstreamProbe.stdout : `origin/${branch}`;
      worktree.lastSeenAt = now();
      appendEvent({
        invocationId: null,
        type: "worktree_published",
        level: "info",
        message: `Published ${branch} to origin.`,
        data: { worktreeId: worktree.id, branch, remoteUrl, upstream: worktree.upstream },
      });
    });
    return { ok: true, worktreeId: worktree.id, branch, remoteUrl, upstream: worktree.upstream, published: true };
  }

  // Open a pull request for the worktree's branch, publishing first if needed.
  // Title/body default from the linked issue/PR so an issue-derived worktree
  // opens a PR that references it (the "Closes #N" line).
  async function createWorktreePr(worktreeId, { title, body, base } = {}) {
    const worktree = worktreeRecord(worktreeId);
    if (!worktree) throw new Error("Worktree not found.");
    const cwd = worktree.path ?? worktree.worktreePath;
    const branch = worktree.branchName ?? worktree.branch;
    if (!cwd || !existsSync(cwd)) throw new Error("Worktree working directory is missing.");
    if (!branch) throw new Error("Worktree has no branch for a pull request.");
    const remoteUrl = await originRemoteUrl(cwd);
    if (!remoteUrl) throw new Error("No 'origin' remote for a pull request. Add a GitHub remote first.");

    // gh needs the head branch on the remote; publish if there's no upstream yet.
    const upstreamProbe = await runGitCapture(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { timeout: 5_000 });
    if (!upstreamProbe.ok) {
      await publishWorktreeBranch(worktreeId);
    }

    const baseBranch = normalizeWorktreeBase(base) ?? (await resolvePrBaseBranch(cwd, worktree));
    const link = worktree.link ?? null;
    const prTitle = String(title || link?.title || `Worktree ${branch}`).slice(0, 240);
    const linkedRef =
      link?.type === "issue" ? `\n\nCloses #${link.number}` : link?.type === "pr" ? `\n\nRelated to #${link.number}` : "";
    const prBody = `${String(body ?? "").trim() || `Pull request for worktree branch \`${branch}\`.`}${linkedRef}\n`;

    const gh = resolveGhCommand();
    // NB: real gh has no --json on `pr create` (field-pilot finding; the test
    // stub accepted it silently). gh prints the created PR URL on stdout.
    const args = [...gh.args, "pr", "create", "--base", baseBranch, "--head", branch, "--title", prTitle, "--body", prBody];
    let stdout;
    try {
      const result = await execFileAsync(gh.command, args, {
        cwd,
        encoding: "utf8",
        timeout: 30_000,
        env: { ...process.env, GH_PROMPT_DISABLED: "1" },
      });
      stdout = result.stdout;
    } catch (error) {
      const detail = String(error?.stderr ?? error?.stdout ?? error?.message ?? "").trim();
      // Idempotent: if a PR for this branch already exists (a re-published run or
      // a retry), gh prints the existing PR URL in the error. Treat that as
      // success — the desired PR IS open — instead of false-failing the run.
      const existing = detail.match(/https?:\/\/\S+\/pull\/\d+/);
      if (/already exists/i.test(detail) && existing) {
        stdout = existing[0];
      } else {
        throw new Error(`gh pr create failed: ${detail || `exit ${error?.code ?? 1}`}`);
      }
    }

    const parsed = parseGhPrCreateOutput(stdout);
    runTx(() => {
      worktree.pr = { number: parsed.number, url: parsed.url, state: parsed.state };
      worktree.lastSeenAt = now();
      appendEvent({
        invocationId: null,
        type: "worktree_pr_created",
        level: "info",
        message: `Opened pull request for ${branch}.`,
        data: { worktreeId: worktree.id, branch, base: baseBranch, number: parsed.number, url: parsed.url, link },
      });
    });
    return { ok: true, worktreeId: worktree.id, branch, base: baseBranch, number: parsed.number, url: parsed.url, state: parsed.state };
  }

  // Phase 5: a human review of a worktree's diff — an overall verdict (approve /
  // request changes) + optional comments — recorded so a promote/merge can be
  // GATED on it. The diff is a flat patch (no per-line ids), so comments anchor at
  // the file level; a null path is a general comment on the whole change.
  function submitWorktreeReview({ worktreeId, verdict, comments, summary, actor } = {}) {
    const worktree = worktreeRecord(worktreeId);
    if (!worktree) throw new Error("Worktree not found.");
    const normalizedVerdict = verdict === "approved" ? "approved" : verdict === "changes_requested" ? "changes_requested" : null;
    if (!normalizedVerdict) throw new Error("Review verdict must be 'approved' or 'changes_requested'.");
    const cleanComments = Array.isArray(comments)
      ? comments
          .filter((c) => c && typeof c === "object")
          .map((c) => ({ path: c.path ? String(c.path).slice(0, 400) : null, body: String(c.body ?? "").slice(0, 2000) }))
          .filter((c) => c.body.trim())
          .slice(0, 100)
      : [];
    const review = {
      id: nextId("wrv_demo"),
      worktreeId: worktree.id,
      projectId: worktree.workspaceProjectId ?? worktree.projectId ?? null,
      verdict: normalizedVerdict,
      summary: String(summary ?? "").slice(0, 2000) || null,
      comments: cleanComments,
      reviewedBy: actor?.userId ?? "usr_local",
      reviewedCommit: worktreeHeadCommit(worktree.id), // bind the verdict to this exact diff
      createdAt: now(),
    };
    return runTx(() => {
      state.worktreeReviews.unshift(review);
      state.worktreeReviews = state.worktreeReviews.slice(0, 500);
      appendEvent({
        invocationId: null,
        type: "worktree_reviewed",
        level: normalizedVerdict === "approved" ? "info" : "warning",
        message: `Worktree ${worktree.branchName ?? worktree.branch ?? worktree.id}: ${normalizedVerdict === "approved" ? "approved" : "changes requested"}.`,
        data: { worktreeId: worktree.id, verdict: normalizedVerdict, reviewedBy: review.reviewedBy },
      });
      return review;
    });
  }

  // The latest review for a worktree (state.worktreeReviews is newest-first).
  function latestWorktreeReview(worktreeId) {
    return (state.worktreeReviews ?? []).find((r) => r.worktreeId === worktreeId) ?? null;
  }

  return {
    addProject,
    cloneProject,
    createBlankProject,
    commitWorktreeChanges,
    createWorktree,
    createWorktreePr,
    submitWorktreeReview,
    latestWorktreeReview,
    worktreeHeadCommit,
    currentProject,
    gitProjectSummary,
    projectBranches,
    publishWorktreeBranch,
    worktreeDiff: (worktree) => worktreeDiff(worktree, { projectTargets: state.projectTargets }),
    projectGithubItems: (project) => projectGithubItems(project, { projectTargets: state.projectTargets }),
    projectForInvocation,
    readProjectTree,
    removeProject,
    removeWorktree,
    destroyWorktree,
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
      deviceId: DEFAULT_DEVICE_ID,
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

// --- worktree publish / PR helpers -----------------------------------------
// These back the console's "Publish branch" and "Open pull request" actions.
// git/gh run out-of-process; the gh executable is resolvable via env so tests
// (and locked-down installs) can inject a stand-in, mirroring the loop
// promotion pipeline's MYAGENTTOOL_GH_COMMAND(_JSON) contract.

async function runGitCapture(cwd, args, { timeout = 30_000 } = {}) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout });
    return { ok: true, stdout: String(stdout).trim(), stderr: "", code: 0 };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error?.stdout ?? "").trim(),
      stderr: String(error?.stderr ?? error?.message ?? "").trim(),
      code: error?.code ?? 1,
    };
  }
}

async function originRemoteUrl(cwd) {
  const result = await runGitCapture(cwd, ["remote", "get-url", "origin"], { timeout: 5_000 });
  return result.ok ? result.stdout : "";
}

// Mirror of tools/ai/src/loop/promotion-github.mjs resolveLoopWorktreePromotion
// PrCreateCommand — kept local so the server never imports the CLI package.
function resolveGhCommand() {
  const rawJson = process.env.MYAGENTTOOL_GH_COMMAND_JSON;
  if (rawJson) {
    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch (error) {
      throw new Error(`MYAGENTTOOL_GH_COMMAND_JSON must be JSON, for example ["gh"]. Parse error: ${error.message}`);
    }
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== "string" || item.length === 0)) {
      throw new Error('MYAGENTTOOL_GH_COMMAND_JSON must be a non-empty string array, for example ["gh"].');
    }
    const [command, ...args] = parsed;
    return { command, args };
  }
  return { command: process.env.MYAGENTTOOL_GH_COMMAND || "gh", args: [] };
}

function parseGhPrCreateOutput(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return { number: null, url: null, state: null, raw: "" };
  try {
    const parsed = JSON.parse(text);
    return { number: parsed.number ?? null, url: parsed.url ?? null, state: parsed.state ?? null, raw: text };
  } catch {
    // Real gh prints the created PR URL; derive the number from it.
    const urlMatch = text.match(/https?:\/\/\S+\/pull\/(\d+)/);
    return { number: urlMatch ? Number(urlMatch[1]) : null, url: urlMatch?.[0] ?? null, state: urlMatch ? "OPEN" : null, raw: text };
  }
}

// The PR base: an explicit worktree base branch when one was chosen, otherwise
// origin's default branch, otherwise "main".
async function resolvePrBaseBranch(cwd, worktree) {
  if (worktree.baseBranch && worktree.baseBranch !== "HEAD") {
    try {
      return normalizeWorktreeBase(worktree.baseBranch) ?? "main";
    } catch {
      /* fall through to remote default */
    }
  }
  const head = await runGitCapture(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { timeout: 5_000 });
  if (head.ok && head.stdout) return head.stdout.replace(/^origin\//, "");
  return "main";
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

export function readProjectTree(project, { relativePath = "", search = "" } = {}) {
  const root = resolve(project.path);
  const target = safeProjectPath(project, relativePath);
  const stats = statSync(target);
  if (!stats.isDirectory()) {
    throw new Error("Project tree path must be a directory.");
  }

  // Keep project.git (branch/remote/default) fresh while the workspace is browsed
  // (#908) — it was captured once at registration, so a checkout since then showed
  // a stale branch. TTL-bounded so navigation/search doesn't re-run git each keystroke.
  refreshProjectGitFacts(project);

  const gitStatus = gitStatusMap(root);
  // `git status --ignored` collapses an ignored directory to one entry, so a child
  // browsed inside it isn't in the map. Inherit `ignored` from any ancestor so the
  // whole subtree badges consistently. (review: child of ignored dir showed clean)
  const statusFor = (relPath) => {
    const own = gitStatus.get(relPath);
    if (own) return own;
    const parts = relPath.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      if (gitStatus.get(parts.slice(0, i).join("/")) === "ignored") return "ignored";
    }
    return "clean";
  };
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
        gitStatus: statusFor(relPath),
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
    // True when `git status` could not be read (#905) — the tree is not known
    // clean, it's unknown. The web can flag it instead of implying no changes.
    gitStatusUnavailable: Boolean(gitStatus.unavailable),
  };
}

export function searchProjectContent(project, { query = "", include = "", exclude = "" } = {}) {
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
  const stats = { scannedFiles: 0, skippedFiles: 0, visitedFiles: 0 };
  // A read-only content search must NOT return the contents of secret files. Skip
  // anything git ignores (reusing the --ignored classification), plus a floor of
  // credential-ish names for non-git folders. (review: content search leaked .env)
  const ignoredSet = new Set([...gitStatusMap(root)].filter(([, s]) => s === "ignored").map(([p]) => p));
  const isIgnored = (relPath) => {
    const parts = relPath.split("/");
    for (let i = 1; i <= parts.length; i += 1) {
      if (ignoredSet.has(parts.slice(0, i).join("/"))) return true;
    }
    return false;
  };
  const SECRET_FILE = /(^|\/)\.env(\.[^/]*)?$|(^|\/)\.npmrc$|(^|\/)\.git-credentials$|\.pem$|\.key$|(^|\/)id_(rsa|dsa|ed25519|ecdsa)$/i;
  walkProjectFiles(root, root, (fullPath, relPath) => {
    if (results.length >= 80 || stats.scannedFiles >= 600 || stats.visitedFiles >= 5000) return false;
    stats.visitedFiles += 1; // bound total work even when most files are skipped
    if (includePatterns.length && !matchesAnyGlob(relPath, includePatterns)) return true;
    if (excludePatterns.length && matchesAnyGlob(relPath, excludePatterns)) return true;
    if (isIgnored(relPath) || SECRET_FILE.test(relPath)) {
      stats.skippedFiles += 1;
      return true;
    }
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

export function safeProjectPath(project, relativePath = "") {
  const root = resolve(project.path);
  const target = resolve(root, String(relativePath ?? ""));
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || resolve(target) === resolve(root, "..")) {
    throw new Error("Project tree path escapes the registered project root.");
  }
  if (!existsSync(target)) {
    throw new Error("Project tree path does not exist.");
  }
  // Realpath containment: an in-tree symlink-to-a-directory must not let the
  // listing/tree escape the registered root (the read FILE path was hardened; this
  // LISTING path was left with string-only containment). (review: symlink escape)
  const realRoot = realpathSync(root);
  const realTarget = realpathSync(target);
  const realRel = relative(realRoot, realTarget);
  if (realRel === ".." || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) {
    throw new Error("Project tree path escapes the registered project root (symlink).");
  }
  return target;
}

// A per-root, short-TTL cache: `readProjectTree` calls gitStatusMap ONCE PER
// directory-level read, so expanding N levels of a tree ran N full-repo `git status`
// scans. A browse-burst (or a search + tree render) happens well inside the TTL, so
// this collapses it to one scan while staying fresh enough to reflect a run's changes
// on the next poll. (review follow-up: repo-wide git status per read)
const GIT_STATUS_TTL_MS = 2_000;
const _gitStatusCache = new Map(); // root -> { at, map }

// Refresh project.git (branch/remote/default) on workspace browse, TTL-bounded so
// a keystroke-debounced search doesn't re-run git each time (#908).
const GIT_FACTS_TTL_MS = 5_000;
const _gitFactsRefreshedAt = new Map(); // projectId -> ms

function refreshProjectGitFacts(project) {
  if (!project?.path || !project?.id) return;
  const last = _gitFactsRefreshedAt.get(project.id) ?? 0;
  if (Date.now() - last < GIT_FACTS_TTL_MS) return;
  _gitFactsRefreshedAt.set(project.id, Date.now());
  try { project.git = readGitFacts(project.path); } catch { /* keep the prior facts on a transient error */ }
}

export function gitStatusMap(root, { fresh = false } = {}) {
  const nowMs = Date.now();
  if (!fresh) {
    const hit = _gitStatusCache.get(root);
    if (hit && nowMs - hit.at < GIT_STATUS_TTL_MS) return hit.map;
  }
  const map = computeGitStatusMap(root);
  _gitStatusCache.set(root, { at: nowMs, map });
  if (_gitStatusCache.size > 64) {
    for (const [k, v] of _gitStatusCache) {
      if (nowMs - v.at >= GIT_STATUS_TTL_MS) _gitStatusCache.delete(k);
    }
  }
  return map;
}

function computeGitStatusMap(root) {
  const statuses = new Map();
  try {
    // --ignored lists ignored paths as `!!` (directories collapsed), so the file
    // browser can badge them (#161: modified/added/deleted/ignored). Bounded by the
    // 3s timeout; on a huge tree it degrades to no badges (graceful).
    const output = execFileSync("git", ["-C", root, "status", "--porcelain", "--ignored"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3_000,
      // Match worktreeDiff (#905): without this, execFileSync defaults to 1 MiB and
      // a large `status --ignored` throws ENOBUFS — which the catch below would turn
      // into a silent "clean" tree.
      maxBuffer: 64 * 1024 * 1024,
    });
    for (const line of output.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const code = line.slice(0, 2);
      const filePath = normalizeRelativePath(line.slice(3).replace(/^"|"$/g, "").replace(/\/$/, ""));
      const status = code === "!!" ? "ignored"
        : code.includes("D") ? "deleted"
        : code.includes("A") || code.includes("?") ? "added"
        : "modified";
      statuses.set(filePath, status);
    }
  } catch {
    // Distinguish "status unavailable" (git failed / missing / not a repo) from a
    // genuinely clean tree (#905), so a broken repo isn't badged clean silently.
    statuses.unavailable = true;
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

// Enumerate local + remote branches for the console's worktree-creation picker,
// as { name, remote } objects (the shape BranchRef expects). Current branch first
// so it reads as the default pick; everything else keeps git's ref ordering.
function projectBranches(project) {
  const root = resolve(project.path);
  const current = gitOutput(root, ["branch", "--show-current"]);
  // Full refnames (not %(refname:short)) so the symbolic origin/HEAD pointer is
  // detectable: its short form collapses to "origin", but the full ref still ends
  // in "/HEAD". We derive the short display name by stripping the ref prefix.
  const refNames = (ref) =>
    gitOutput(root, ["for-each-ref", "--format=%(refname)", ref])
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  const seen = new Set();
  const branches = [];
  const add = (name, remote) => {
    // Skip empties and any remote short name colliding with a local branch.
    if (!name || seen.has(name)) return;
    seen.add(name);
    branches.push({ name, remote });
  };
  for (const full of refNames("refs/heads")) {
    add(full.replace(/^refs\/heads\//, ""), false);
  }
  for (const full of refNames("refs/remotes")) {
    if (full.endsWith("/HEAD")) continue; // symbolic origin/HEAD -> origin/main pointer
    add(full.replace(/^refs\/remotes\//, ""), true);
  }
  branches.sort((a, b) => Number(b.name === current) - Number(a.name === current));
  return { branches, current: current || null };
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
    // an empty file and silently omits its files from the patch.
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
  // The repo's own default branch, used for base resolution when a worktree
  // branch has no upstream: origin/HEAD if set, else a local main/master. Null
  // when none can be found.
  const repoDefaultBranch = () => {
    try {
      const ref = git(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]).trim();
      if (ref) return ref.replace(/^refs\/remotes\//, "");
    } catch {
      /* origin/HEAD not set */
    }
    for (const cand of ["main", "master"]) {
      try {
        git(["rev-parse", "--verify", "--quiet", `refs/heads/${cand}`]);
        return cand;
      } catch {
        /* candidate not present */
      }
    }
    return null;
  };
  let base = "HEAD";
  const target = projectTargets.find((t) => t.id === worktree.targetId);
  // Diff against the branch this worktree merges INTO (its base branch) — the PR
  // diff. Prefer the worktree's OWN recorded base first, so a worktree cut from a
  // non-default branch doesn't over-report every default-branch commit not in its
  // base (audit finding); then the target/repo default. @{u} is only a last
  // resort — once the branch is PUSHED its upstream is its OWN remote ref, so
  // merge-base(@{u},HEAD)=HEAD => an EMPTY diff that blinds every post-publish
  // consumer (the auto-merge review, a re-run judge). (C1 pilot finding).
  const baseCandidates = [
    worktree.baseBranch && worktree.baseBranch !== "HEAD" ? worktree.baseBranch : null,
    target?.defaultBranch,
    repoDefaultBranch(),
  ].filter(Boolean);
  let resolved = false;
  for (const cand of baseCandidates) {
    try {
      const mb = git(["merge-base", cand, "HEAD"]).trim();
      if (mb) { base = mb; resolved = true; break; }
    } catch {
      /* try the next candidate */
    }
  }
  if (!resolved) {
    try {
      const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).trim();
      base = git(["merge-base", upstream, "HEAD"]).trim() || "HEAD";
    } catch {
      /* no default branch and no upstream → leave HEAD */
    }
  }
  result.base = base;
  let diff = "";
  try {
    diff = git(["diff", "--no-color", base, "--"]);
  } catch {
    /* no commits yet, or bad base */
  }
  // Changed paths vs base — COMMITTED work included. `result.files` is porcelain
  // (working tree only), so once an agent commits, it goes empty; any consumer
  // that needs "what did this branch change" (the auto-merge sensitive-path
  // guard, design-artifact detection) must use changedPaths instead.
  try {
    const committed = git(["-c", "core.quotepath=false", "diff", "--name-only", base, "--"]).split("\n").filter(Boolean);
    result.changedPaths = [...new Set([...committed, ...result.files.map((f) => f.path)])];
  } catch {
    result.changedPaths = result.files.map((f) => f.path);
  }
  const MAX_UNTRACKED = 200;
  let untrackedSeen = 0;
  const emptyDir = mkdtempSync(join(tmpdir(), "myagenttool-empty-diff-"));
  const emptyFile = join(emptyDir, "empty");
  writeFileSync(emptyFile, "");
  try {
    for (const f of result.files) {
      if (!f.untracked) continue;
      if (diff.length > MAX_DIFF_BYTES || untrackedSeen >= MAX_UNTRACKED) {
        result.truncated = true;
        break;
      }
      untrackedSeen += 1;
      const patch = gitDiffSafe(["diff", "--no-color", "--no-index", "--", emptyFile, f.path]);
      if (patch) diff += (diff && !diff.endsWith("\n") ? "\n" : "") + patch;
    }
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
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
