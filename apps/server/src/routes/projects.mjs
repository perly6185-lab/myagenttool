import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { denyForeignProject } from "../runtime/auth.mjs";
import { summarizeAutoRuns } from "../services/auto-run-metrics.mjs";
import { readEvalTrend, summarizeEvalTrend } from "../services/eval-trend.mjs";
import { maturityScorecard } from "../read-models/maturity-scorecard.mjs";
import { normalizeAutoRunSettings, resolveAutoRunConfig } from "../services/auto-run-config.mjs";
import { computeAutoRunReadiness } from "../services/auto-run-readiness.mjs";
import { computeMergeRisk, sensitivePathHit, DEFAULT_SENSITIVE_PATHS } from "../services/auto-run-risk.mjs";
import { summarizeEpicChildren } from "../services/auto-run-epic.mjs";
import { resolveAutoRunVerifyCommandFor } from "../services/worktree-verify.mjs";

const IMAGE_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

export async function handleProjectRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  state,
  actor,
  persistStateSoon,
  currentProject,
  addProject,
  cloneProject,
  createBlankProject,
  createWorktree,
  createWorktreePr,
  publishWorktreeBranch,
  startAutoRun,
  retryAutoRun,
  mergeAutoRunPr,
  approveDesign,
  rejectDesign,
  answerClarify,
  approveDecomposition,
  rejectDecomposition,
  budgetStatusFor,
  refreshAutoRunPrDispositions,
  selectProject,
  removeProject,
  removeWorktree,
  updateProject,
  readProjectTree,
  searchProjectContent,
  gitProjectSummary,
  projectBranches,
  worktreeDiff,
  submitWorktreeReview,
  projectGithubItems,
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
    // A new project belongs to the creator's team unless one is named explicitly.
    if (!body.ownerTeamId && actor?.teamId) body.ownerTeamId = actor.teamId;
    let project;
    try {
      if (body.repoUrl) {
        project = await cloneProject({
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
    if (!body.ownerTeamId && actor?.teamId) body.ownerTeamId = actor.teamId;
    let project;
    try {
      project = await cloneProject(body);
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
    if (!body.ownerTeamId && actor?.teamId) body.ownerTeamId = actor.teamId;
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
  if (projectMatch && (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE")) {
    if (denyForeignProject({ res, sendJson, state, actor, projectId: decodeURIComponent(projectMatch[1]), notFound: { error: "project_not_found" } })) {
      return true;
    }
  }
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

  // Tenancy guard for auto-run-id routes: resolve the run's project and deny a
  // foreign actor (these routes take a global run id, not a project id). (audit)
  const denyForeignAutoRun = (autoRunId) => {
    const run = (state.autoRuns ?? []).find((r) => r.id === autoRunId);
    const projectId = run?.projectId ?? null;
    if (!projectId) return false; // unknown run → let the service return not-found
    return denyForeignProject({ res, sendJson, state, actor, projectId, notFound: { error: "auto_run_not_found" } });
  };

  const autoRunRetryMatch = url.pathname.match(/^\/api\/auto-runs\/([^\/]+)\/retry$/);
  if (autoRunRetryMatch && req.method === "POST") {
    if (denyForeignAutoRun(decodeURIComponent(autoRunRetryMatch[1]))) return true;
    try {
      const result = await retryAutoRun(decodeURIComponent(autoRunRetryMatch[1]), { actor });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: "auto_run_retry_failed", message: errorMessage(error) });
    }
    return true;
  }

  // D4: the human design gate — approve spawns the implementation child issue
  // (the click is the authorization); reject records feedback to the issue.
  const designApprovalMatch = url.pathname.match(/^\/api\/auto-runs\/([^\/]+)\/design-approval$/);
  if (designApprovalMatch && req.method === "POST") {
    if (denyForeignAutoRun(decodeURIComponent(designApprovalMatch[1]))) return true;
    try {
      const body = await readJson(req);
      const id = decodeURIComponent(designApprovalMatch[1]);
      const result = body?.action === "reject"
        ? await rejectDesign(id, { actor, feedback: body?.feedback })
        : await approveDesign(id, { actor });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: "design_approval_failed", message: errorMessage(error) });
    }
    return true;
  }

  // Epic S3: the human decomposition gate — approve spawns the N governed child
  // issues (the click is the authorization); reject records feedback to the epic.
  const decompositionApprovalMatch = url.pathname.match(/^\/api\/auto-runs\/([^\/]+)\/decomposition-approval$/);
  if (decompositionApprovalMatch && req.method === "POST") {
    if (denyForeignAutoRun(decodeURIComponent(decompositionApprovalMatch[1]))) return true;
    try {
      const body = await readJson(req);
      const id = decodeURIComponent(decompositionApprovalMatch[1]);
      const result = body?.action === "reject"
        ? await rejectDecomposition(id, { actor, feedback: body?.feedback })
        : await approveDecomposition(id, { actor });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: "decomposition_approval_failed", message: errorMessage(error) });
    }
    return true;
  }

  // E3: a human answers a clarify run's questions (posted back to the issue).
  const clarifyAnswerMatch = url.pathname.match(/^\/api\/auto-runs\/([^\/]+)\/clarify-answer$/);
  if (clarifyAnswerMatch && req.method === "POST") {
    if (denyForeignAutoRun(decodeURIComponent(clarifyAnswerMatch[1]))) return true;
    try {
      const body = await readJson(req);
      const result = await answerClarify(decodeURIComponent(clarifyAnswerMatch[1]), { actor, answers: body?.answers });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: "clarify_answer_failed", message: errorMessage(error) });
    }
    return true;
  }

  const autoRunMergeMatch = url.pathname.match(/^\/api\/auto-runs\/([^\/]+)\/merge$/);
  if (autoRunMergeMatch && req.method === "POST") {
    if (denyForeignAutoRun(decodeURIComponent(autoRunMergeMatch[1]))) return true;
    // Human-triggered PR merge (merge stays human — a person clicking Merge).
    try {
      const result = await mergeAutoRunPr(decodeURIComponent(autoRunMergeMatch[1]), { actor });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: "auto_run_merge_failed", message: errorMessage(error) });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/auto-runs") {
    // ?refresh=1 (the console's manual Refresh) also refreshes PR dispositions
    // (bounded, throttled, read-only gh) so the routing evaluation sees final
    // outcomes; the 10s poll stays cheap.
    if (url.searchParams.get("refresh") === "1" && typeof refreshAutoRunPrDispositions === "function") {
      try {
        await refreshAutoRunPrDispositions();
      } catch {
        /* best-effort */
      }
    }
    const autoRuns = state.autoRuns ?? [];
    // Surface the pending local-approval on awaiting_approval runs so the human
    // can Approve/Deny directly on the auto-run card (informed by the decision
    // already shown), instead of hunting for it in the Invocations view.
    const pendingByInvocation = new Map(
      (state.approvalRequests ?? [])
        .filter((a) => a.status === "pending" && a.invocationId)
        .map((a) => [a.invocationId, a]),
    );
    const enriched = autoRuns.map((run) => {
      let out = run;
      // Merge-risk badge for open PRs (the risk-based merge policy's read model).
      if (run.status === "pr_open") {
        // Fold in the STORED review / diff-size / sensitive-path signals when a
        // sweep already computed them, so the badge doesn't show "low" while the
        // stricter stored signals say otherwise (misleads a manual merger). (audit)
        const extra = run.review || run.diffFiles || run.diffLines != null
          ? {
              review: run.review ?? null,
              diffTooLarge: Number.isFinite(run.diffLines) && run.diffLines > (Number(state.autoRunSettings?.autoMergeMaxDiffLines) || 400),
              sensitivePath: sensitivePathHit(run.diffFiles ?? [], Array.isArray(state.autoRunSettings?.autoMergeSensitivePaths) && state.autoRunSettings.autoMergeSensitivePaths.length ? state.autoRunSettings.autoMergeSensitivePaths : DEFAULT_SENSITIVE_PATHS),
            }
          : null;
        out = { ...out, mergeRisk: computeMergeRisk(run, extra ? { extra } : {}) };
      }
      if (run.status === "awaiting_approval" && run.invocationId) {
        const approval = pendingByInvocation.get(run.invocationId);
        if (approval) {
          out = {
            ...out,
            pendingApproval: { id: approval.id, riskLevel: approval.riskLevel ?? null, riskTags: approval.riskTags ?? [], summary: approval.summary ?? null },
          };
        }
      }
      // Epic S4: live rollup of a decomposed epic's children (in-memory — each child
      // rolls up from its own auto-run once a human labels it `auto`).
      if (run.status === "decomposed") {
        out = { ...out, childRollup: summarizeEpicChildren(run, autoRuns) };
      }
      return out;
    });
    sendJson(res, 200, { autoRuns: enriched, summary: summarizeAutoRuns(autoRuns, { sloTargets: state.autoRunSettings?.sloTargets ?? null }) });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/eval-trend") {
    // Results-side view of the scheduled real-agent evals (#248). Read-only,
    // best-effort: the eval scheduler is a separate LaunchAgent, this just
    // surfaces its local trend.jsonl so capability regressions are visible.
    const records = readEvalTrend();
    sendJson(res, 200, { records, summary: summarizeEvalTrend(records) });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/maturity") {
    // Computed L0–L6 maturity scorecard: the calibration gates applied to the
    // latest measured evidence (DORA + held-out eval + backlog + governance),
    // replacing the hand-typed status. Read-only, best-effort; missing artifacts
    // yield indeterminate levels.
    sendJson(res, 200, maturityScorecard());
    return true;
  }

  const readinessMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/auto-run-readiness$/);
  if (readinessMatch && req.method === "GET") {
    // U1 preflight: can this project run an auto-run, and what's missing?
    const projectId = decodeURIComponent(readinessMatch[1]);
    const project = (state.projects ?? []).find((p) => p.id === projectId) ?? null;
    const agent = project?.defaultAgentId ? (state.agents ?? []).find((a) => a.id === project.defaultAgentId) ?? null : null;
    const settledSet = new Set(["pr_open", "report_posted", "needs_input", "blocked", "done", "failed"]);
    const readiness = computeAutoRunReadiness({
      project,
      agent,
      deviceLinked: state.device?.unlinkState === "linked" || (state.devices ?? []).length > 0,
      budget: typeof budgetStatusFor === "function" && project ? budgetStatusFor(project.id) : null,
      verifyCommand: resolveAutoRunVerifyCommandFor({ verifyCommandName: project?.verifyCommandName ?? null }),
      settings: state.autoRunSettings ?? {},
      breaker: state.autoRunBreaker ?? null,
      activeCount: (state.autoRuns ?? []).filter((r) => !settledSet.has(r.status)).length,
    });
    sendJson(res, 200, { readiness });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/auto-run-config") {
    // Effective auto-run config for the console panel: resolved values (saved
    // settings overlaid on env) + a `configured` flag per command knob. Never
    // returns command argv — those stay server-side (trust boundary).
    sendJson(res, 200, { config: resolveAutoRunConfig(state) });
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/auto-run-settings") {
    // Edit the SAFE knobs only; command argv is never accepted here. A field set
    // to null clears the override (back to env). Applied on the next server start.
    const body = await readJson(req);
    state.autoRunSettings = normalizeAutoRunSettings(body ?? {}, state.autoRunSettings ?? {});
    persistStateSoon?.();
    sendJson(res, 200, { config: resolveAutoRunConfig(state) });
    return true;
  }

  const projectAutoRunMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/auto-runs$/);
  if (projectAutoRunMatch && req.method === "POST") {
    const projectId = decodeURIComponent(projectAutoRunMatch[1]);
    if (denyForeignProject({ res, sendJson, state, actor, projectId, notFound: { error: "project_not_found" } })) {
      return true;
    }
    const body = await readJson(req);
    try {
      const result = await startAutoRun({
        projectId,
        link: body.link,
        agentId: body.agentId,
        name: body.name ?? body.branchName,
        baseBranch: body.baseBranch ?? body.startPoint,
        actor,
      });
      sendJson(res, 201, result);
    } catch (error) {
      sendJson(res, 400, { error: "auto_run_failed", message: errorMessage(error) });
    }
    return true;
  }

  const projectWorktreeMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/worktrees$/);
  if (projectWorktreeMatch && req.method === "POST") {
    if (denyForeignProject({ res, sendJson, state, actor, projectId: decodeURIComponent(projectWorktreeMatch[1]), notFound: { error: "project_not_found" } })) {
      return true;
    }
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
    if (denyForeignProject({ res, sendJson, state, actor, projectId: project.id, notFound: { error: "project_not_found" } })) return true;
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
    if (denyForeignProject({ res, sendJson, state, actor, projectId: project.id, notFound: { error: "project_not_found" } })) return true;
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
    if (denyForeignProject({ res, sendJson, state, actor, projectId: project.id, notFound: { error: "project_not_found" } })) return true;
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
    if (denyForeignProject({ res, sendJson, state, actor, projectId: project.id, notFound: { error: "project_not_found" } })) return true;
    try {
      sendJson(res, 200, await projectGithubItems(project));
    } catch (error) {
      sendJson(res, 200, { available: false, message: errorMessage(error), items: [] });
    }
    return true;
  }

  const projectBranchesMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/branches$/);
  if (projectBranchesMatch && req.method === "GET") {
    const project = state.projects.find((item) => item.id === decodeURIComponent(projectBranchesMatch[1]));
    if (!project) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: project.id, notFound: { error: "project_not_found" } })) return true;
    try {
      // Returns { name, remote } objects (BranchRef) — the console's branch picker
      // reads b.name, so bare strings would make b.name undefined and crash its filter.
      sendJson(res, 200, projectBranches(project));
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
    if (denyForeignProject({ res, sendJson, state, actor, projectId: project.id, notFound: { error: "project_not_found" } })) {
      return true;
    }
    const action = worktreeMatch[2] ?? "";
    if (!action && req.method === "DELETE") {
      const removed = removeWorktree(worktree.id);
      sendJson(res, 200, { removed, worktrees: state.worktrees });
      return true;
    }
    // Read file/tree from the WORKTREE's own directory, not the parent project
    // clone — otherwise a worktree's changes (e.g. a design run's design/*.html
    // artifacts) are invisible and the browser shows the parent's files instead.
    const worktreeDir = worktree.path ?? worktree.worktreePath ?? null;
    const worktreeView = worktreeDir ? { ...project, path: worktreeDir } : project;
    if (action === "files" && req.method === "GET") {
      try {
        const tree = readProjectTree(worktreeView, { relativePath: url.searchParams.get("path") ?? "" });
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
          const result = searchProjectContent(worktreeView, { query });
          sendJson(res, 200, { matches: (result.results ?? []).map((item) => ({ path: item.path, line: item.line, text: item.preview })) });
        } else {
          const tree = readProjectTree(worktreeView, { search: query });
          sendJson(res, 200, { matches: (tree.entries ?? []).map((item) => ({ path: item.path, text: item.name })) });
        }
      } catch (error) {
        sendJson(res, 400, { error: "worktree_search_unavailable", message: errorMessage(error) });
      }
      return true;
    }
    if (action === "file" && req.method === "GET") {
      try {
        const file = safeProjectFile(worktreeView, url.searchParams.get("path") ?? "");
        const buf = existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
        const maxBytes = 2 * 1024 * 1024; // images run larger than text
        const clipped = buf.subarray(0, maxBytes);
        // D5 (visual acceptance): images (screenshots / mockup renders) are
        // returned base64 so the console can render them inline; everything else
        // stays utf8 text as before.
        const mime = IMAGE_MIME[extname(file).toLowerCase()] ?? null;
        sendJson(res, 200, {
          path: relative(worktreeView.path, file).replaceAll("\\", "/"),
          ...(mime
            ? { encoding: "base64", mime, content: clipped.toString("base64") }
            : { encoding: "utf8", content: clipped.toString("utf8") }),
          truncated: buf.length > maxBytes,
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
        sendJson(res, 200, worktreeDiff(worktree));
      } catch (error) {
        sendJson(res, 400, { error: "worktree_diff_unavailable", message: errorMessage(error) });
      }
      return true;
    }
    if (action === "review" && req.method === "POST") {
      try {
        const body = await readJson(req);
        const review = submitWorktreeReview({
          worktreeId: worktree.id,
          verdict: body.verdict,
          comments: body.comments,
          summary: body.summary,
          actor,
        });
        sendJson(res, 201, { review });
      } catch (error) {
        sendJson(res, 400, { error: "worktree_review_failed", message: errorMessage(error) });
      }
      return true;
    }
    if (action === "attachments" && req.method === "POST") {
      try {
        const body = await readJson(req);
        sendJson(res, 201, saveAttachments(worktree, body.files));
      } catch (error) {
        sendJson(res, 400, { error: "worktree_attachment_failed", message: errorMessage(error) });
      }
      return true;
    }
    if (action === "push" && req.method === "POST") {
      try {
        const result = await publishWorktreeBranch(worktree.id);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, { error: "worktree_publish_failed", message: errorMessage(error) });
      }
      return true;
    }
    if (action === "pr" && req.method === "POST") {
      let body = {};
      try {
        body = (await readJson(req)) ?? {};
      } catch {
        body = {};
      }
      try {
        const result = await createWorktreePr(worktree.id, { title: body.title, body: body.body, base: body.base });
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, { error: "worktree_pr_failed", message: errorMessage(error) });
      }
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
  // Symlinks escape the string-path check: an in-tree symlink can point at a
  // host secret (~/.ssh, ~/.claude/.credentials.json). realpath the target and
  // the root and re-verify containment (mirrors the write path's saveAttachments
  // hardening, which the read path was missing). (audit finding)
  const realRoot = realpathSync(root);
  const realTarget = realpathSync(target);
  const realRel = relative(realRoot, realTarget);
  if (realRel === ".." || realRel.startsWith(`..${sep}`)) {
    throw new Error("Requested file escapes the worktree root (symlink).");
  }
  return target; // validated via realpath; return the original path so the
  // caller's relative(root, file) stays correct (readFileSync follows the link).
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

// Persist pasted/uploaded files into the worktree so the agent working there
// can read them. Hardened against a symlinked worktree/attachments dir (writes
// must not escape the tree), caps each file at 5 MiB, and drops a self-
// contained .gitignore so attachments never show up as untracked clutter in the
// worktree diff or get swept into a commit by ephemeral cleanup.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function saveAttachments(worktree, files) {
  const list = Array.isArray(files) ? files.slice(0, 6) : [];
  const root = resolve(worktree.path);
  const dir = join(root, ".myagenttool", "attachments");
  // Reject a symlinked attachments dir, then realpath-verify it stays under root.
  if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) {
    throw new Error("Attachment path escapes the worktree root.");
  }
  mkdirSync(dir, { recursive: true });
  const realRoot = realpathSync(root);
  const realDir = realpathSync(dir);
  if (realDir !== realRoot && !realDir.startsWith(realRoot + sep)) {
    throw new Error("Attachment path escapes the worktree root.");
  }
  writeFileSync(join(dir, ".gitignore"), "*\n");
  const attachments = [];
  const skipped = [];
  for (const file of list) {
    const declaredName =
      basename(String(file?.name ?? "file")).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "file";
    const buf = file?.dataBase64 ? Buffer.from(String(file.dataBase64), "base64") : Buffer.alloc(0);
    if (buf.length === 0 || buf.length > MAX_ATTACHMENT_BYTES) {
      skipped.push({ name: declaredName, reason: buf.length === 0 ? "empty" : "too_large" });
      continue;
    }
    const name = `${randomBytes(3).toString("hex")}-${declaredName}`;
    writeFileSync(join(dir, name), buf);
    attachments.push({ name: declaredName, path: `.myagenttool/attachments/${name}`, bytes: buf.length });
  }
  return { attachments, skipped };
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
