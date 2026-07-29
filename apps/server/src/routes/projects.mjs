import { randomBytes } from "node:crypto";
import { constants as fsConstants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { canProvision, denyForeignProject, teamOf, LOCAL_TEAM_ID } from "../runtime/auth.mjs";
import { computeDispatchEvaluation } from "../read-models/dispatch-evaluation.mjs";
import { computeIssueOwnership } from "../read-models/issue-ownership.mjs";
import { recordHttpGateRefusal } from "./refusal-http-gate.mjs";
import { deriveFinalStatus, summarizeAutoRuns } from "../services/auto-run-metrics.mjs";
import { summarizeDeployments } from "../services/auto-run-deploy-metrics.mjs";
import { renderOfficecliPreview, readOfficecliDocParagraphs, readOfficecliSheet, readOfficecliDeck, OfficecliPreviewError } from "../services/officecli-preview.mjs";
import { computeBlockOps, paragraphToMd } from "../services/officecli-block-ops.mjs";
import { parseDocumentMd, alignBlocks } from "../services/officecli-doc-md.mjs";
import { computeSheetOps, cellEditableText } from "../services/officecli-sheet-ops.mjs";
import { computeDeckOps } from "../services/officecli-deck-ops.mjs";
import { readEvalTrend, summarizeEvalTrend } from "../services/eval-trend.mjs";
import { maturityScorecard, latestDora } from "../read-models/maturity-scorecard.mjs";
import { normalizeAutoRunSettings, resolveAutoRunConfig } from "../services/auto-run-config.mjs";
import { computeAutoRunReadiness } from "../services/auto-run-readiness.mjs";
import { computeMergeRisk, sensitivePathHit, DEFAULT_SENSITIVE_PATHS } from "../services/auto-run-risk.mjs";
import { summarizeEpicChildren } from "../services/auto-run-epic.mjs";
import { resolveAutoRunVerifyCommandFor } from "../services/worktree-verify.mjs";
import { PdfDocumentReadError, readProjectPdf } from "../services/pdf-document-read.mjs";
import { CadPreviewError, inspectCadDocument, renderCadDocument } from "../services/cad-preview.mjs";
import { assetCapabilityMatrix, deriveAssetRuntimeReadiness, describeProjectAsset, summarizeAssetForRemote } from "../services/asset-capabilities.mjs";
import { AssetPreviewError, readAssetPreview } from "../services/asset-preview.mjs";

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
  refuse,
  persistStateSoon,
  currentProject,
  addProject,
  cloneProject,
  createBlankProject,
  createWorktree,
  createWorktreePr,
  publishWorktreeBranch,
  ensureLocalOrigin,
  startAutoRun,
  retryAutoRun,
  reverifyAutoRun,
  cancelAutoRun,
  mergeAutoRunPr,
  recordRoutingOverride,
  setReportSchedule,
  postReportNow,
  claimIssue,
  releaseIssueClaim,
  listIssueClaims,
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
  readProjectDocuments,
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

  // #1210: give a project somewhere to push, without an internet account.
  const localOriginMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/local-origin$/);
  if (localOriginMatch && req.method === "POST") {
    const projectId = decodeURIComponent(localOriginMatch[1]);
    if (denyForeignProject({ res, sendJson, state, actor, projectId, notFound: { error: "project_not_found" } })) {
      return true;
    }
    try {
      sendJson(res, 201, await ensureLocalOrigin(projectId));
    } catch (error) {
      sendJson(res, 400, { error: "local_origin_unavailable", message: errorMessage(error) });
    }
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
    const projectId = decodeURIComponent(projectMatch[1]);
    try {
      removed = removeProject(projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Refusal model (#758): the project isn't in a state where it may be
      // removed (in use / invariant). The HTTP 400 already surfaces it — record
      // only, no new event.
      recordHttpGateRefusal(refuse, {
        subjectKind: "registration",
        subjectId: projectId,
        code: "subject_not_actionable",
        summary: `Project removal was blocked: ${message}`,
        evidence: { projectId, message },
        remedy: "Resolve what holds the project (in-use references or an invariant), then remove it.",
      });
      sendJson(res, 400, {
        error: "project_remove_blocked",
        message,
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
    if (run && !run.projectId && actor?.teamId != null && run.teamId !== actor.teamId) {
      sendJson(res, 404, { error: "auto_run_not_found" });
      return true;
    }
    const projectId = run?.projectId ?? null;
    if (!projectId) return false; // unknown run → let the service return not-found
    return denyForeignProject({ res, sendJson, state, actor, projectId, notFound: { error: "auto_run_not_found" } });
  };

  const autoRunRetryMatch = url.pathname.match(/^\/api\/auto-runs\/([^\/]+)\/retry$/);
  if (autoRunRetryMatch && req.method === "POST") {
    if (denyForeignAutoRun(decodeURIComponent(autoRunRetryMatch[1]))) return true;
    try {
      const body = await readJson(req);
      const result = await retryAutoRun(decodeURIComponent(autoRunRetryMatch[1]), { actor, terminalId: body?.terminalId });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: "auto_run_retry_failed", message: errorMessage(error) });
    }
    return true;
  }

  const autoRunCancelMatch = url.pathname.match(/^\/api\/auto-runs\/([^\/]+)\/cancel$/);
  if (autoRunCancelMatch && req.method === "POST") {
    if (denyForeignAutoRun(decodeURIComponent(autoRunCancelMatch[1]))) return true;
    try {
      const body = await readJson(req);
      const result = cancelAutoRun(decodeURIComponent(autoRunCancelMatch[1]), { actor, terminalId: body?.terminalId });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: "auto_run_cancel_failed", message: errorMessage(error) });
    }
    return true;
  }

  const autoRunReverifyMatch = url.pathname.match(/^\/api\/auto-runs\/([^\/]+)\/reverify$/);
  if (autoRunReverifyMatch && req.method === "POST") {
    if (denyForeignAutoRun(decodeURIComponent(autoRunReverifyMatch[1]))) return true;
    try {
      const body = await readJson(req);
      const result = await reverifyAutoRun(decodeURIComponent(autoRunReverifyMatch[1]), {
        actor,
        terminalId: body?.terminalId,
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: "auto_run_reverify_failed", message: errorMessage(error) });
    }
    return true;
  }

  const routingOverrideMatch = url.pathname.match(/^\/api\/auto-runs\/([^\/]+)\/routing-override$/);
  if (routingOverrideMatch && req.method === "POST") {
    if (denyForeignAutoRun(decodeURIComponent(routingOverrideMatch[1]))) return true;
    try {
      const body = await readJson(req);
      const result = recordRoutingOverride(decodeURIComponent(routingOverrideMatch[1]), {
        actor,
        actualPath: body?.actualPath,
        reason: body?.reason,
        expectedRevision: body?.expectedRevision,
        idempotencyKey: body?.idempotencyKey,
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error?.status ?? 400, {
        error: error?.code ?? "routing_override_failed",
        message: errorMessage(error),
        ...(error?.currentRevision == null ? {} : { currentRevision: error.currentRevision }),
      });
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
        await refreshAutoRunPrDispositions({ teamId: actor?.teamId ?? null });
      } catch {
        /* best-effort */
      }
    }
    const visibleProjectIds = new Set(
      (state.projects ?? [])
        .filter((project) => actor?.teamId == null || teamOf(project) === actor.teamId)
        .map((project) => project.id),
    );
    const autoRuns = (state.autoRuns ?? []).filter((run) =>
      (run.projectId && visibleProjectIds.has(run.projectId))
      || (!run.projectId && actor?.teamId != null && run.teamId === actor.teamId));
    // Surface the pending local-approval on awaiting_approval runs so the human
    // can Approve/Deny directly on the auto-run card (informed by the decision
    // already shown), instead of hunting for it in the Invocations view.
    const pendingByInvocation = new Map(
      (state.approvalRequests ?? [])
        .filter((a) => a.status === "pending" && a.invocationId)
        .map((a) => [a.invocationId, a]),
    );
    const enriched = autoRuns.map((run) => {
      const { idempotencyKey: _routingIdempotencyKey, ...routingOverride } = run.routingOverride ?? {};
      let out = run.routingOverride ? { ...run, routingOverride } : run;
      // Derived terminal grade (clean / degraded / unverified success, or failed)
      // for a per-run quality badge; null while the run is still in flight.
      const finalStatus = deriveFinalStatus(run);
      if (finalStatus) out = { ...out, finalStatus };
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
    sendJson(res, 200, {
      autoRuns: enriched,
      summary: summarizeAutoRuns(autoRuns, {
        sloTargets: state.autoRunSettings?.sloTargets ?? null,
        routingThresholds: state.autoRunSettings?.routingThresholds ?? null,
      }),
      // D2 deploy metrics: change-failure rate + recovery + frequency over the
      // deploy stage's records (feeds the DORA panel and maturity L5 in D3).
      deployments: summarizeDeployments(
        (state.deployments ?? []).filter((deployment) => visibleProjectIds.has(deployment.projectId)),
      ),
    });
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
    // latest measured evidence (DORA + held-out eval + backlog + governance +
    // deploy/orchestration recovery), replacing the hand-typed status. Read-only,
    // best-effort; missing artifacts yield indeterminate levels.
    sendJson(res, 200, maturityScorecard({ deployments: state.deployments ?? [], invocations: state.invocations ?? [] }));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/dora") {
    // DORA Four Keys (lead time, deploy frequency, CI-green, change-fail) — the
    // latest `github:dora` artifact. Read-only, best-effort (null if never run).
    sendJson(res, 200, { dora: latestDora() });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/dispatch-evaluation") {
    // #1174 (R2 of #1170): per-worker / per-(worker×area) dispatch outcomes.
    // Unlike /api/maturity and /api/dora (global artifacts), this is per-project
    // data, so it MUST be team-scoped — filter assignments to projects the
    // actor's team owns, then aggregate.
    const teamId = actor?.teamId ?? null;
    const visibleProjectIds = new Set(
      (state.projects ?? []).filter((p) => teamId == null || teamOf(p) === teamId).map((p) => p.id),
    );
    const scoped = (state.dispatchAssignments ?? []).filter((a) => visibleProjectIds.has(a?.projectId));
    sendJson(res, 200, computeDispatchEvaluation(scoped));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/issue-ownership") {
    // #6: "who owns this issue" — the develop/review claim lease + the Layer-B
    // dispatch assignment, unified per issue. Per-project data, so team-scoped like
    // /api/dispatch-evaluation (decision soft-claims are a different domain and are
    // intentionally not folded in — see read-models/issue-ownership.mjs).
    const teamId = actor?.teamId ?? null;
    const visibleProjectIds = new Set(
      (state.projects ?? []).filter((p) => teamId == null || teamOf(p) === teamId).map((p) => p.id),
    );
    sendJson(res, 200, computeIssueOwnership(state, { includeProject: (projectId) => visibleProjectIds.has(projectId) }));
    return true;
  }

  const readinessMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/auto-run-readiness$/);
  if (readinessMatch && req.method === "GET") {
    // U1 preflight: can this project run an auto-run, and what's missing?
    const projectId = decodeURIComponent(readinessMatch[1]);
    const project = (state.projects ?? []).find((p) => p.id === projectId) ?? null;
    const agent = project?.defaultAgentId ? (state.agents ?? []).find((a) => a.id === project.defaultAgentId) ?? null : null;
    // Capacity waits remain in-flight for the operator but deliberately release
    // an execution slot until their durable retry becomes due.
    const settledSet = new Set(["waiting_capacity", "pr_open", "report_posted", "needs_input", "plan_proposed", "decomposed", "blocked", "done", "failed", "cancelled"]);
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
    if (!canProvision(actor)) {
      sendJson(res, 403, { error: "forbidden", message: "Only an owner or admin can update global Auto-run settings." });
      return true;
    }
    const body = await readJson(req);
    state.autoRunSettings = normalizeAutoRunSettings(body ?? {}, state.autoRunSettings ?? {});
    persistStateSoon?.();
    sendJson(res, 200, { config: resolveAutoRunConfig(state) });
    return true;
  }

  // Scheduled work-report → channel push. GET reads the current config; PUT edits
  // it (arming/rearming nextRunAt); post-now sends immediately for setup/testing.
  // The schedule is a single GLOBAL admin-plane singleton (it names a channel
  // target and posts platform-wide data), so ALL THREE verbs — read included —
  // are gated to the admin/local scope. The local owner IS team_local, so the
  // gate must admit it (a bare `teamId != null` 403s the only real local user).
  const foreignTenant = actor?.teamId != null && actor.teamId !== LOCAL_TEAM_ID;
  if (url.pathname === "/api/report-schedule" || url.pathname === "/api/report-schedule/post-now") {
    if (foreignTenant) { sendJson(res, 403, { error: "admin_only" }); return true; }
  }
  if (req.method === "GET" && url.pathname === "/api/report-schedule") {
    sendJson(res, 200, { reportSchedule: state.reportSchedule ?? null });
    return true;
  }
  if (req.method === "PUT" && url.pathname === "/api/report-schedule") {
    const body = await readJson(req);
    const config = typeof setReportSchedule === "function" ? setReportSchedule(body ?? {}) : null;
    sendJson(res, 200, { reportSchedule: config });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/report-schedule/post-now") {
    const result = typeof postReportNow === "function" ? postReportNow() : { posted: false, reason: "unavailable" };
    sendJson(res, result.posted ? 200 : 409, result);
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

  // #1143 issue claims: the self-service claim surface. Claiming is the write
  // chokepoint's decision (409 on a foreign develop claim); reading an issue is
  // never gated, so GET simply lists.
  const projectIssueClaimsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/issue-claims$/);
  if (projectIssueClaimsMatch && req.method === "GET") {
    const projectId = decodeURIComponent(projectIssueClaimsMatch[1]);
    if (denyForeignProject({ res, sendJson, state, actor, projectId, notFound: { error: "project_not_found" } })) {
      return true;
    }
    sendJson(res, 200, {
      issueClaims: listIssueClaims({ projectId, includeSettled: url.searchParams.get("includeSettled") === "1" }),
    });
    return true;
  }
  if (projectIssueClaimsMatch && req.method === "POST") {
    const projectId = decodeURIComponent(projectIssueClaimsMatch[1]);
    if (denyForeignProject({ res, sendJson, state, actor, projectId, notFound: { error: "project_not_found" } })) {
      return true;
    }
    const body = await readJson(req);
    const result = claimIssue({
      projectId,
      issueNumber: body?.issueNumber,
      mode: body?.mode ?? "develop",
      actor,
    });
    if (!result.ok) {
      const conflict = Boolean(result.claim);
      sendJson(res, conflict ? 409 : 400, { error: conflict ? "issue_already_claimed" : "invalid_claim", message: result.reason, claim: result.claim ?? null });
      return true;
    }
    sendJson(res, 201, { claim: result.claim, renewed: result.renewed === true });
    return true;
  }

  const issueClaimReleaseMatch = url.pathname.match(/^\/api\/issue-claims\/([^/]+)\/release$/);
  if (issueClaimReleaseMatch && req.method === "POST") {
    const claimId = decodeURIComponent(issueClaimReleaseMatch[1]);
    const claim = (state.issueClaims ?? []).find((item) => item.id === claimId) ?? null;
    // A foreign-team claim is indistinguishable from a missing one (404, not
    // 403) — same anti-enumeration stance as denyForeignProject.
    if (!claim || denyForeignProject({ res, sendJson, state, actor, projectId: claim.projectId, notFound: { error: "issue_claim_not_found" } })) {
      if (!claim) sendJson(res, 404, { error: "issue_claim_not_found" });
      return true;
    }
    const released = releaseIssueClaim(claimId, { actor, outcome: "released" });
    sendJson(res, 200, { released, claim });
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

  const projectDocumentsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/documents$/);
  if (projectDocumentsMatch && req.method === "GET") {
    const project = state.projects.find((item) => item.id === decodeURIComponent(projectDocumentsMatch[1]));
    if (!project) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: project.id, notFound: { error: "project_not_found" } })) return true;
    try {
      const worktreeId = url.searchParams.get("worktree");
      const worktree = worktreeId ? (state.worktrees ?? []).find((item) => item.id === worktreeId && item.projectId === project.id) : null;
      if (worktreeId && !worktree) {
        sendJson(res, 404, { error: "worktree_not_found" });
        return true;
      }
      const root = worktree?.path ?? worktree?.worktreePath ?? project.path;
      const result = readProjectDocuments({ ...project, path: root }, {
        type: url.searchParams.get("type") ?? "all",
        search: url.searchParams.get("q") ?? "",
        limit: url.searchParams.get("limit") ?? 200,
      });
      sendJson(res, 200, {
        ...result,
        worktreeId: worktree?.id ?? null,
        documents: result.documents.map((document) => {
          const readiness = deriveAssetRuntimeReadiness(state)[document.assetFamily];
          return {
            ...document, worktreeId: worktree?.id ?? null,
            readiness: readiness === undefined ? document.readiness
              : readiness ? { state: "ready", reason: "available_on_owning_terminal" }
                : { state: "waiting_capability", reason: "local_application_required" },
          };
        }),
      });
    } catch (error) {
      sendJson(res, 400, { error: "project_documents_unavailable", message: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  const assetCapabilitiesMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/asset-capabilities$/);
  if (assetCapabilitiesMatch && req.method === "GET") {
    const project = state.projects.find((item) => item.id === decodeURIComponent(assetCapabilitiesMatch[1]));
    if (!project) { sendJson(res, 404, { error: "project_not_found" }); return true; }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: project.id, notFound: { error: "project_not_found" } })) return true;
    const worktreeId = url.searchParams.get("worktree");
    const worktree = worktreeId ? (state.worktrees ?? []).find((item) => item.id === worktreeId && item.projectId === project.id) : null;
    if (worktreeId && !worktree) { sendJson(res, 404, { error: "worktree_not_found" }); return true; }
    try {
      const root = worktree?.path ?? worktree?.worktreePath ?? project.path;
      const descriptor = describeProjectAsset({
        projectId: project.id,
        projectRoot: root,
        relativePath: url.searchParams.get("path") ?? "",
        terminalId: actor?.deviceId ?? project.terminalId ?? state.devices?.[0]?.id ?? "local-terminal",
        worktreeId: worktree?.id ?? null,
        runtimeReadiness: deriveAssetRuntimeReadiness(state),
      });
      res.setHeader("Cache-Control", "private, no-store");
      sendJson(res, 200, { descriptor, remoteSummary: summarizeAssetForRemote(descriptor), matrixVersion: 1 });
    } catch (error) {
      const code = error?.code ?? "asset_unavailable";
      const status = code === "asset_path_outside_project" || code === "invalid_asset_path" ? 400 : code === "ENOENT" ? 404 : 400;
      sendJson(res, status, { error: code, message: "This asset is not available inside the selected project." });
    }
    return true;
  }

  if (url.pathname === "/api/asset-capabilities" && req.method === "GET") {
    sendJson(res, 200, { version: 1, verbs: [
      "discover", "preview", "inspect", "create", "edit", "transform",
      "render", "compare", "export", "open_external", "attach_evidence",
    ], families: assetCapabilityMatrix() });
    return true;
  }

  const assetPreviewMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/asset-preview$/);
  if (assetPreviewMatch && req.method === "GET") {
    const project = state.projects.find((item) => item.id === decodeURIComponent(assetPreviewMatch[1]));
    if (!project) { sendJson(res, 404, { error: "project_not_found" }); return true; }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: project.id, notFound: { error: "project_not_found" } })) return true;
    const worktreeId = url.searchParams.get("worktree");
    const worktree = worktreeId ? (state.worktrees ?? []).find((item) => item.id === worktreeId && item.projectId === project.id) : null;
    if (worktreeId && !worktree) { sendJson(res, 404, { error: "worktree_not_found" }); return true; }
    try {
      const root = worktree?.path ?? worktree?.worktreePath ?? project.path;
      const preview = readAssetPreview({
        projectPath: root, relativeFile: url.searchParams.get("path") ?? "", range: req.headers.range ?? null,
      });
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      if (preview.family === "markdown") {
        sendJson(res, 200, {
          path: preview.path, family: preview.family, text: preview.text,
          size: preview.size, truncated: false,
        });
        return true;
      }
      res.statusCode = preview.family === "video" ? 206 : 200;
      res.setHeader("Content-Type", preview.mimeType);
      res.setHeader("Content-Length", String(preview.bytes.length));
      res.setHeader("Content-Disposition", "inline");
      if (preview.family === "video") {
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Range", `bytes ${preview.start}-${preview.end}/${preview.size}`);
      }
      res.end(preview.bytes);
    } catch (error) {
      const code = error instanceof AssetPreviewError ? error.code : "asset_preview_failed";
      const status = code === "asset_not_found" ? 404
        : code === "asset_preview_too_large" ? 413
          : code === "invalid_asset_range" ? 416
            : code === "asset_preview_unsupported" ? 415 : 400;
      sendJson(res, status, { error: code, message: error instanceof AssetPreviewError ? error.message : "Asset preview is unavailable." });
    }
    return true;
  }

  const pdfDocumentMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/pdf-document$/);
  if (pdfDocumentMatch && req.method === "GET") {
    const project = state.projects.find((item) => item.id === decodeURIComponent(pdfDocumentMatch[1]));
    if (!project) { sendJson(res, 404, { error: "project_not_found" }); return true; }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: project.id, notFound: { error: "project_not_found" } })) return true;
    const worktreeId = url.searchParams.get("worktree");
    const worktree = worktreeId ? (state.worktrees ?? []).find((item) => item.id === worktreeId && item.projectId === project.id) : null;
    if (worktreeId && !worktree) { sendJson(res, 404, { error: "worktree_not_found" }); return true; }
    try {
      const root = worktree?.path ?? worktree?.worktreePath ?? project.path;
      const pdf = readProjectPdf({ projectPath: root, relativeFile: url.searchParams.get("path") ?? "", range: req.headers.range ?? null });
      res.statusCode = req.headers.range ? 206 : 200;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Length", String(pdf.bytes.length));
      res.setHeader("Accept-Ranges", "bytes");
      if (req.headers.range) res.setHeader("Content-Range", `bytes ${pdf.start}-${pdf.end}/${pdf.size}`);
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(pdf.bytes);
    } catch (error) {
      const code = error instanceof PdfDocumentReadError ? error.code : "pdf_read_failed";
      const status = code === "not_found" ? 404 : code === "pdf_too_large" ? 413 : code === "range_not_satisfiable" || code === "invalid_range" ? 416 : 400;
      if (status === 416) res.setHeader("Content-Range", "bytes */*");
      sendJson(res, status, { error: code, message: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  const cadDocumentMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/cad-document(\/layout)?$/);
  if (cadDocumentMatch && req.method === "GET") {
    const project = state.projects.find((item) => item.id === decodeURIComponent(cadDocumentMatch[1]));
    if (!project) { sendJson(res, 404, { error: "project_not_found" }); return true; }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: project.id, notFound: { error: "project_not_found" } })) return true;
    const worktreeId = url.searchParams.get("worktree");
    const worktree = worktreeId ? (state.worktrees ?? []).find((item) => item.id === worktreeId && item.projectId === project.id) : null;
    if (worktreeId && !worktree) { sendJson(res, 404, { error: "worktree_not_found" }); return true; }
    const rootPath = worktree?.path ?? worktree?.worktreePath ?? project.path;
    const args = { projectPath: rootPath, relativeFile: url.searchParams.get("path") ?? "" };
    try {
      const result = cadDocumentMatch[2]
        ? await renderCadDocument({ ...args, layout: url.searchParams.get("layout") ?? "Model", visibleLayers: url.searchParams.get("layersMode") === "selected" ? url.searchParams.getAll("layers") : undefined })
        : await inspectCadDocument(args);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
      sendJson(res, 200, result);
    } catch (error) {
      const code = error instanceof CadPreviewError ? error.code : "cad_processing_failed";
      const status = code === "cad_not_found" ? 404 : code === "cad_file_too_large" || code === "cad_output_too_large" || code.endsWith("_limit_exceeded") ? 413 : code === "ezdxf_unavailable" || code === "oda_unavailable" ? 503 : 400;
      sendJson(res, status, { error: code, message: error instanceof CadPreviewError ? error.message : "CAD preview could not be produced." });
    }
    return true;
  }

  const officecliPreviewMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/officecli-preview$/);
  if (officecliPreviewMatch && req.method === "GET") {
    const project = state.projects.find((item) => item.id === decodeURIComponent(officecliPreviewMatch[1]));
    if (!project) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: project.id, notFound: { error: "project_not_found" } })) return true;
    const worktreeId = url.searchParams.get("worktree");
    const worktree = worktreeId ? (state.worktrees ?? []).find((w) => w.id === worktreeId && w.projectId === project.id) : null;
    const rootPath = worktree?.path ?? worktree?.worktreePath ?? project.path;
    try {
      const preview = await renderOfficecliPreview({ projectPath: rootPath, relativeFile: url.searchParams.get("path") ?? "" });
      sendJson(res, 200, preview);
    } catch (error) {
      // Map the typed preview errors to a precise HTTP status; anything else is a
      // 400 with the message (a render failure is user-facing, not a 500).
      const code = error instanceof OfficecliPreviewError ? error.code : "preview_failed";
      const status = code === "not_found" ? 404 : code === "officecli_unavailable" ? 503 : 400;
      sendJson(res, status, { error: code, message: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  const docOutlineMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/officecli-doc-outline$/);
  if (docOutlineMatch && req.method === "GET") {
    const project = state.projects.find((item) => item.id === decodeURIComponent(docOutlineMatch[1]));
    if (!project) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: project.id, notFound: { error: "project_not_found" } })) return true;
    const worktreeId = url.searchParams.get("worktree");
    const worktree = worktreeId ? (state.worktrees ?? []).find((w) => w.id === worktreeId && w.projectId === project.id) : null;
    const rootPath = worktree?.path ?? worktree?.worktreePath ?? project.path;
    try {
      const outline = await readOfficecliDocParagraphs({ projectPath: rootPath, relativeFile: url.searchParams.get("path") ?? "" });
      // Attach the markdown projection per paragraph (heading + inline runs) so the
      // editor displays it directly — a single, server-owned source of truth for
      // the projection (no client-side mirror to drift).
      const paragraphs = outline.paragraphs.map((p) => ({ ...p, md: paragraphToMd(p) }));
      sendJson(res, 200, { ...outline, paragraphs });
    } catch (error) {
      const code = error instanceof OfficecliPreviewError ? error.code : "outline_failed";
      const status = code === "not_found" ? 404 : code === "officecli_unavailable" ? 503 : 400;
      sendJson(res, status, { error: code, message: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  // L1 in-app block editing: compute the batch item list for a markdown-style edit
  // of a .docx. The client sends the edited block list ({path|null, md}); the
  // server re-reads the CURRENT outline (so the diff is against real worktree state,
  // never the client's possibly-stale snapshot) and runs the tested block-ops
  // mapper. Pure/read — the resulting commands still flow through the governed
  // `apply.batch` capability (both allowlists) before anything is written.
  const blockOpsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/officecli-block-ops$/);
  if (blockOpsMatch && req.method === "POST") {
    const project = state.projects.find((item) => item.id === decodeURIComponent(blockOpsMatch[1]));
    if (!project) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: project.id, notFound: { error: "project_not_found" } })) return true;
    const body = await readJson(req);
    const worktreeId = body?.worktree ?? body?.worktreeId ?? null;
    const worktree = worktreeId ? (state.worktrees ?? []).find((w) => w.id === worktreeId && w.projectId === project.id) : null;
    const rootPath = worktree?.path ?? worktree?.worktreePath ?? project.path;
    // Two input modes: `blocks` (the block editor, each carrying its paraId) or
    // `text` (the whole-document markdown textarea — re-aligned to paraIds here).
    const blocks = Array.isArray(body?.blocks) ? body.blocks : null;
    const text = typeof body?.text === "string" ? body.text : null;
    if (!blocks && text === null) {
      sendJson(res, 400, { error: "invalid_blocks", message: "A blocks array or document text is required." });
      return true;
    }
    try {
      const outline = await readOfficecliDocParagraphs({ projectPath: rootPath, relativeFile: body?.file ?? body?.path ?? "" });
      const edited = blocks
        ? blocks
        : alignBlocks(
            outline.paragraphs.map((p) => ({ path: p.path, md: paragraphToMd(p), complex: p.complex })),
            parseDocumentMd(text),
          );
      const { commands } = computeBlockOps({ original: outline.paragraphs, edited });
      sendJson(res, 200, { commands });
    } catch (error) {
      const code = error instanceof OfficecliPreviewError ? error.code : "block_ops_failed";
      const status = code === "not_found" ? 404 : code === "officecli_unavailable" ? 503 : 400;
      sendJson(res, status, { error: code, message: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  // xlsx grid editing: read a worksheet as a grid, and compute the cell-edit ops.
  const sheetMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/officecli-sheet$/);
  if (sheetMatch && req.method === "GET") {
    const project = state.projects.find((item) => item.id === decodeURIComponent(sheetMatch[1]));
    if (!project) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: project.id, notFound: { error: "project_not_found" } })) return true;
    const worktreeId = url.searchParams.get("worktree");
    const worktree = worktreeId ? (state.worktrees ?? []).find((w) => w.id === worktreeId && w.projectId === project.id) : null;
    const rootPath = worktree?.path ?? worktree?.worktreePath ?? project.path;
    try {
      const grid = await readOfficecliSheet({ projectPath: rootPath, relativeFile: url.searchParams.get("path") ?? "", sheet: url.searchParams.get("sheet") ?? undefined });
      // Attach each cell's editable text (a formula shows as `=…`) — server-owned,
      // so the grid UI has no projection logic to drift.
      const cells = Object.fromEntries(Object.entries(grid.cells).map(([addr, cell]) => [addr, { ...cell, edit: cellEditableText(cell) }]));
      sendJson(res, 200, { ...grid, cells });
    } catch (error) {
      const code = error instanceof OfficecliPreviewError ? error.code : "sheet_failed";
      const status = code === "not_found" ? 404 : code === "officecli_unavailable" ? 503 : 400;
      sendJson(res, status, { error: code, message: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  const sheetOpsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/officecli-sheet-ops$/);
  if (sheetOpsMatch && req.method === "POST") {
    const project = state.projects.find((item) => item.id === decodeURIComponent(sheetOpsMatch[1]));
    if (!project) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: project.id, notFound: { error: "project_not_found" } })) return true;
    const body = await readJson(req);
    const worktreeId = body?.worktree ?? body?.worktreeId ?? null;
    const worktree = worktreeId ? (state.worktrees ?? []).find((w) => w.id === worktreeId && w.projectId === project.id) : null;
    const rootPath = worktree?.path ?? worktree?.worktreePath ?? project.path;
    const editedCells = body?.cells && typeof body.cells === "object" ? body.cells : null;
    if (!editedCells) {
      sendJson(res, 400, { error: "invalid_cells", message: "A cells map is required." });
      return true;
    }
    try {
      const grid = await readOfficecliSheet({ projectPath: rootPath, relativeFile: body?.file ?? body?.path ?? "", sheet: body?.sheet ?? undefined });
      const { commands } = computeSheetOps({ sheet: grid.sheet, original: grid.cells, edited: editedCells });
      sendJson(res, 200, { commands, sheet: grid.sheet });
    } catch (error) {
      const code = error instanceof OfficecliPreviewError ? error.code : "sheet_ops_failed";
      const status = code === "not_found" ? 404 : code === "officecli_unavailable" ? 503 : 400;
      sendJson(res, status, { error: code, message: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  // pptx slide editing: read the deck's slides+shapes, and compute shape-text ops.
  const deckMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/officecli-deck$/);
  if (deckMatch && req.method === "GET") {
    const project = state.projects.find((item) => item.id === decodeURIComponent(deckMatch[1]));
    if (!project) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: project.id, notFound: { error: "project_not_found" } })) return true;
    const worktreeId = url.searchParams.get("worktree");
    const worktree = worktreeId ? (state.worktrees ?? []).find((w) => w.id === worktreeId && w.projectId === project.id) : null;
    const rootPath = worktree?.path ?? worktree?.worktreePath ?? project.path;
    try {
      const deck = await readOfficecliDeck({ projectPath: rootPath, relativeFile: url.searchParams.get("path") ?? "" });
      sendJson(res, 200, deck);
    } catch (error) {
      const code = error instanceof OfficecliPreviewError ? error.code : "deck_failed";
      const status = code === "not_found" ? 404 : code === "officecli_unavailable" ? 503 : 400;
      sendJson(res, status, { error: code, message: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  const deckOpsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/officecli-deck-ops$/);
  if (deckOpsMatch && req.method === "POST") {
    const project = state.projects.find((item) => item.id === decodeURIComponent(deckOpsMatch[1]));
    if (!project) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: project.id, notFound: { error: "project_not_found" } })) return true;
    const body = await readJson(req);
    const worktreeId = body?.worktree ?? body?.worktreeId ?? null;
    const worktree = worktreeId ? (state.worktrees ?? []).find((w) => w.id === worktreeId && w.projectId === project.id) : null;
    const rootPath = worktree?.path ?? worktree?.worktreePath ?? project.path;
    const editedShapes = body?.shapes && typeof body.shapes === "object" ? body.shapes : null;
    if (!editedShapes) {
      sendJson(res, 400, { error: "invalid_shapes", message: "A shapes map is required." });
      return true;
    }
    try {
      const deck = await readOfficecliDeck({ projectPath: rootPath, relativeFile: body?.file ?? body?.path ?? "" });
      // The original editable-shape text map, from the fresh read.
      const original = {};
      for (const slide of deck.slides) for (const shape of slide.shapes) if (shape.editable) original[shape.path] = shape.text;
      const { commands } = computeDeckOps({ original, edited: editedShapes });
      sendJson(res, 200, { commands });
    } catch (error) {
      const code = error instanceof OfficecliPreviewError ? error.code : "deck_ops_failed";
      const status = code === "not_found" ? 404 : code === "officecli_unavailable" ? 503 : 400;
      sendJson(res, status, { error: code, message: error instanceof Error ? error.message : String(error) });
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
    if (action === "office-document-manage" && req.method === "POST") {
      try {
        const body = await readJson(req);
        sendJson(res, 200, manageOfficeDocument(worktree, body));
      } catch (error) {
        sendJson(res, 400, { error: "office_document_manage_failed", message: errorMessage(error) });
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

// One level only — readProjectTree does a single readdir, so this knows a
// directory EXISTS but nothing about what is in it. It used to answer `[]` for
// every directory, which asserts "empty" and is a claim it cannot make; the
// browser could not tell an unread directory from a genuinely empty one and
// rendered both as nothing (#1200). Absent `children` means "not read yet"; the
// client fetches it with ?path=. `[]` is then honest: an empty directory.
function treeEntriesToNodes(entries) {
  return entries.map((entry) => ({
    name: entry.name,
    path: entry.path,
    dir: entry.kind === "directory",
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
const OFFICE_IMPORT_EXTENSIONS = new Set([".docx", ".xlsx", ".pptx"]);

export function manageOfficeDocument(worktree, body) {
  const operation = String(body?.operation ?? "");
  if (!["rename", "move", "copy", "delete"].includes(operation)) throw new Error("Unsupported document operation.");
  const root = resolve(worktree.path);
  const source = resolveOfficeDocumentPath(root, body?.source, { mustExist: true });
  if (lstatSync(source.absolute).isSymbolicLink() || !lstatSync(source.absolute).isFile()) throw new Error("Source must be a regular Office document.");
  if (operation === "delete") {
    unlinkSync(source.absolute);
    return { operation, source: source.relative };
  }
  const destination = resolveOfficeDocumentPath(root, body?.destination, { mustExist: false, createParent: true });
  if (extname(source.relative).toLowerCase() !== extname(destination.relative).toLowerCase()) {
    throw new Error("Destination must keep the source document type.");
  }
  if (existsSync(destination.absolute)) throw new Error("A document already exists at the destination.");
  if (operation === "copy") copyFileSync(source.absolute, destination.absolute, fsConstants.COPYFILE_EXCL);
  else renameSync(source.absolute, destination.absolute);
  return { operation, source: source.relative, destination: destination.relative };
}

function resolveOfficeDocumentPath(root, input, { mustExist, createParent = false }) {
  const value = String(input ?? "").trim().replaceAll("\\", "/");
  if (!value || value.startsWith("/") || value.startsWith("~") || value.split("/").includes("..")) throw new Error("Document path must be relative to the worktree.");
  if (!OFFICE_IMPORT_EXTENSIONS.has(extname(value).toLowerCase())) throw new Error("Document path must end in .docx, .xlsx, or .pptx.");
  const absolute = resolve(root, value);
  const rel = relative(root, absolute);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Document path escapes the worktree.");
  const parent = dirname(absolute);
  let cursor = root;
  for (const part of relative(root, parent).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error("Document path escapes the worktree through a symlink.");
  }
  if (createParent) mkdirSync(parent, { recursive: true });
  const realRoot = realpathSync(root);
  const realParent = realpathSync(parent);
  if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) throw new Error("Document path escapes the worktree.");
  if (mustExist && !existsSync(absolute)) throw new Error("Source document does not exist.");
  return { absolute, relative: value };
}

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
