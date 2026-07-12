import { detectPromptInjection, roleAutoRunPrompt } from "@myagenttool/protocol/issue-prompt";

import { createRefusalRuntime } from "../runtime/refusal-log.mjs";
import { isTerminal } from "./invocations.mjs";
import { normalizeWorktreeLink } from "./projects.mjs";
import { intentForPath, resolveDecision } from "./auto-run-decision.mjs";
import { isSpawnedChildBody, decompositionChildBody, extractProjectFieldsBlock } from "./auto-run-spawn.mjs";
import { judgmentEvidence } from "./auto-run-judge.mjs";
import { computeMergeRisk, sensitivePathHit, DEFAULT_SENSITIVE_PATHS } from "./auto-run-risk.mjs";
import { resolveAutoRunVerifyCommandFor } from "./worktree-verify.mjs";
import { composeDesignIssueComment, designArtifactIndex, buildDesignImageUrls } from "./auto-run-design.mjs";
import { decompositionTree, issueTreeApplyFailures, humanApprovalRequiredReasons } from "../../../../tools/ai/src/issue-tree-core.mjs";
import { scoreDecompositionOverlap } from "./auto-run-epic.mjs";

// One-click "Auto" orchestrator. It closes the seam the console never had:
// turning a linked GitHub issue into a worktree AND a started agent run seeded
// with an issue-derived prompt, then — on the run completing — verifying and
// opening a PR. Merge stays human.
//
// Lifecycle: materializing -> running | awaiting_approval -> verifying ->
// publishing -> pr_open | blocked | failed. Kickoff (startAutoRun) sets the
// first status from the invocation it started; a high-risk agent lands in
// awaiting_approval because the invocation itself does (Auto never bypasses the
// local-approval gate). The reaction (advanceAutoRunForInvocation) runs the
// verification gate and opens the PR — a failed real check blocks it.
// O2: decision paths whose runs may be auto-approved by operator policy — the
// non-code paths (a design brief / a clarify question / a throwaway spike),
// never `develop` (which edits product code and opens a PR).
const AUTO_APPROVABLE_PATHS = new Set(["design", "clarify", "prototype", "decompose"]);

// Fallback Project Fields for a self-healing remediation issue (H2) when the
// culprit issue carried none — so the fix PR still passes pr-governance.
const DEFAULT_REMEDIATION_FIELDS = "## Project Fields\nMilestone: M2\nArea: server\nType: bug\nStatus: ready\nRisk: low\nAcceptance: verified\nPlatform: server\nPriority: p1\n";

/** Parse a DORA `Change-failure: #N` marker (the first ref) from a body; null if absent. */
export function extractChangeFailureRef(body) {
  const m = /change-failure:\s*#(\d+)/i.exec(String(body ?? ""));
  return m ? Number(m[1]) : null;
}

export const autoRunStates = [
  "materializing",
  "running",
  "awaiting_approval",
  "verifying",
  "publishing",
  "pr_open",
  "report_posted",
  "needs_input",
  "plan_proposed",
  "decomposed",
  "blocked",
  "done",
  "failed",
];

export function createAutoRunService({
  state,
  now,
  nextId,
  appendEvent,
  refuse: injectedRefuse,
  persistStateSoon,
  createWorktree,
  destroyWorktree,
  findAgent,
  defaultAgent,
  budgetStatusFor,
  sendAlert,
  createInvocation,
  findInvocation,
  cancelInvocation,
  autoApproveInvocation,
  startInvocationIfAllowed,
  commitWorktreeChanges,
  publishWorktreeBranch,
  createWorktreePr,
  verifyWorktree,
  writeIssueStatus,
  decideIssuePath,
  decisionSettings = null,
  fetchIssueBody,
  postIssueReport,
  spawnChildIssue,
  judgeAcceptance,
  reviewDiff,
  listWorktreeChangedFiles,
  worktreeHeadSha,
  readWorktreeTextFile,
  spawnChildIssueDirect,
  mergePr,
  fetchPrChecks,
  renderDesignImages,
  createDecompositionChild,
  runDeploy,
  runRollback,
  fileRemediationIssue,
}) {
  // Production injects the shared refusal writer; fall back to one bound to this
  // service's own state so a directly-constructed service (unit tests) still
  // records the veto instead of throwing (refusal model Phase 2, #760).
  const refuse = injectedRefuse ?? createRefusalRuntime({ state, now, nextId, appendEvent }).refuse;
  // Best-effort issue body fetch (issue links only): richer context for both the
  // decision and the role prompt. Null on any failure — the run proceeds on the
  // title alone rather than failing on a gh hiccup.
  async function maybeFetchIssueBody(link, projectId) {
    if (typeof fetchIssueBody !== "function") return null;
    if (link?.type !== "issue" || !Number.isFinite(link?.number)) return null;
    const project = state.projects.find((item) => item.id === projectId) ?? null;
    if (!project?.path) return null;
    try {
      const body = await fetchIssueBody({ issueNumber: link.number, repoPath: project.path });
      return typeof body === "string" && body.trim() ? body : null;
    } catch {
      return null;
    }
  }

  // Shared spend/safety refusal used by BOTH a fresh start and a self-repair
  // continuation: kill switch, project budget, and the circuit breaker. Returns a
  // short reason to refuse, or null when it's safe to spend. A repair spawns a NEW
  // agent run (real spend), so it must clear the same gates a fresh run does — and
  // the original run's spend makes over-budget likeliest exactly at repair time.
  function autoRunSpendRefusal(projectId) {
    if (state.autoRunSettings?.autonomyKillSwitch) return "autonomy kill switch is on";
    if (typeof budgetStatusFor === "function" && projectId) {
      const budget = budgetStatusFor(projectId);
      if (budget?.over) return `project is over budget ($${budget.spentUsd} of $${budget.limitUsd})`;
    }
    const breaker = state.autoRunBreaker;
    if (breaker?.openUntil && Date.parse(now()) < Date.parse(breaker.openUntil)) {
      return `circuit breaker open until ${breaker.openUntil}`;
    }
    return null;
  }

  // The agent's summary from the completed invocation — the deliverable for an
  // investigation (there is no diff to ship).
  function extractRunSummary(invocation) {
    const result = invocation?.result;
    if (!result) return null;
    if (typeof result === "string") return result.slice(0, 4000);
    if (typeof result.summary === "string") return result.summary.slice(0, 4000);
    if (typeof result.text === "string") return result.text.slice(0, 4000);
    try {
      return JSON.stringify(result).slice(0, 2000);
    } catch {
      return null;
    }
  }

  // Governed child-issue spawning (slice 4): a design/prototype deliverable
  // becomes a pending-decision child issue. Guards: opt-in (composer wires
  // spawnChildIssue only when enabled), issue links only, depth-1 (a spawned
  // child never spawns grandchildren), and one child per parent issue (dedup
  // across all runs). Best-effort: a spawn failure never breaks the run.
  async function maybeSpawnChildIssue(autoRun, worktree, design) {
    if (typeof spawnChildIssue !== "function") return null;
    if (autoRun.link?.type !== "issue" || !Number.isFinite(autoRun.link?.number)) return null;
    if (autoRun.isChildIssue) return null;
    const repoPath = worktree?.repoPath ?? null;
    if (!repoPath) return null;
    const alreadySpawned = state.autoRuns.some(
      (run) => run.link?.number === autoRun.link.number && Array.isArray(run.childIssues) && run.childIssues.length > 0,
    );
    if (alreadySpawned) return null;
    try {
      const child = await spawnChildIssue({ parentLink: autoRun.link, design, repoPath });
      if (!child || !Number.isFinite(child.number)) return null;
      appendEvent({
        invocationId: autoRun.invocationId,
        type: "auto_run_child_spawned",
        level: "info",
        message: `Auto-run ${autoRun.id} spawned pending-decision child issue #${child.number}.`,
        data: { autoRunId: autoRun.id, parentIssue: autoRun.link.number, childIssue: child.number, url: child.url ?? null },
      });
      return { child: { number: child.number, url: child.url ?? null } };
    } catch (error) {
      return { error: `Child issue spawn failed: ${String(error?.message ?? error)}` };
    }
  }

  // Layer B (opt-in designImagesToIssue, default off): rasterize the design/*.html
  // mockups to PNGs (operator render command), commit + push the design branch,
  // and return raw image URLs so the previews render INLINE on the issue. Pushing
  // a branch is the one outward step here — it happens only behind the opt-in flag
  // and only when there are images to host. Best-effort throughout: any failure
  // returns {} and Layer A's text index still posts (never blocks the report).
  async function maybeHostDesignImages(autoRun, worktree) {
    if (!state.autoRunSettings?.designImagesToIssue) return {};
    try {
      if (typeof renderDesignImages === "function") {
        await renderDesignImages(autoRun.worktreeId);
      }
      // Commit what the renderer wrote (git push only ships committed files),
      // SCOPED to design/ so a stray file the operator's renderer drops elsewhere
      // (a cache dir, a root screenshot) never rides the push. Re-list after.
      if (typeof commitWorktreeChanges === "function") {
        try { await commitWorktreeChanges(autoRun.worktreeId, { message: "chore(design): render mockup previews", pathspec: ["design"] }); } catch { /* nothing to commit */ }
      }
      let files = [];
      if (typeof listWorktreeChangedFiles === "function") {
        try { files = (await listWorktreeChangedFiles(autoRun.worktreeId)) ?? []; } catch { files = []; }
      }
      const images = designArtifactIndex(files).images;
      if (!images.length || typeof publishWorktreeBranch !== "function") return {};
      const pub = await publishWorktreeBranch(autoRun.worktreeId);
      if (!pub?.ok) return {};
      return buildDesignImageUrls({ remoteUrl: pub.remoteUrl, branch: pub.branch, images });
    } catch {
      return {};
    }
  }

  // Epic decomposition (Slice 2): read the agent's proposed plan from the worktree
  // (decomposition/PLAN.json — a JSON array of child briefs, or {children:[...]}),
  // build the governed tree (capped), and validate it. NOTHING is spawned here —
  // the tree is a PROPOSAL a human approves in Slice 3. Pure/read-only; never throws.
  function buildDecompositionProposal(autoRun, worktree, invocation) {
    const cap = Number(state.autoRunSettings?.epicMaxChildren) > 0 ? Math.min(Number(state.autoRunSettings.epicMaxChildren), 20) : 8;
    // Read PLAN.json with a generous cap (it is JSON.parse'd, so mid-file
    // truncation would fail to parse; a 20-child plan is ~40KB). (review fix)
    const raw = typeof readWorktreeTextFile === "function" ? readWorktreeTextFile(autoRun.worktreeId, "decomposition/PLAN.json", 500_000) : null;
    let children = [];
    let parseError = null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        children = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.children) ? parsed.children : [];
      } catch (error) {
        parseError = String(error?.message ?? error).slice(0, 200);
      }
    }
    const truncated = children.length > cap;
    const tree = decompositionTree({ parentLink: autoRun.link, children: children.slice(0, cap) });
    // STRUCTURAL defects only (title/milestone/acceptance/labels/product-flow). We
    // pass a sentinel approval so the "human approval required" line — which the S3
    // human gate satisfies at spawn time — is NOT reported as a defect to fix here.
    const failures = issueTreeApplyFailures(tree, "proposed");
    const approvalReasons = humanApprovalRequiredReasons(tree);
    // S5: score how much the proposed children overlap — a high-overlap pair often
    // means one child's scope is already covered by another (the live run's #28).
    const overlap = scoreDecompositionOverlap(tree);
    const summary = extractRunSummary(invocation) ?? "";
    const lines = [
      summary ? `${summary}\n` : "",
      `**Proposed decomposition — ${tree.issues.length} child issue(s)** (nothing created yet; awaiting approval):`,
      ...tree.issues.map((c, i) => `${i + 1}. ${c.title}${c.acceptanceCriteria?.length ? ` — ${c.acceptanceCriteria.length} acceptance criteria` : ""}`),
      truncated ? `\n_(capped at ${cap}; the agent proposed ${children.length})_` : "",
      failures.length ? `\n⚠️ ${failures.length} governance issue(s) to resolve before spawning:\n${failures.map((f) => `- ${f}`).join("\n")}` : "\n✅ All proposed children pass structural governance validation.",
      overlap.flagged.length ? `\n⚠️ Possible overlap (children may cover the same scope — review before spawning):\n${overlap.flagged.map((p) => `- #${p.a + 1} “${p.a != null ? tree.issues[p.a].title : ""}” ↔ #${p.b + 1} “${tree.issues[p.b].title}” (${Math.round(p.score * 100)}%)`).join("\n")}` : "",
      approvalReasons.length ? `\nℹ️ Approving the plan is the required human sign-off for: ${approvalReasons.join(", ")}.` : "",
      parseError ? `\n⚠️ decomposition/PLAN.json did not parse: ${parseError}` : "",
    ].filter(Boolean);
    return {
      status: {
        report: summary || null,
        decompositionPlan: { tree, failures, approvalReasons, overlap, truncated, proposedCount: children.length, parseError },
        error: failures.length || parseError || !tree.issues.length ? "The proposed plan needs attention before it can be approved." : null,
      },
      comment: lines.join("\n"),
    };
  }

  // Best-effort: post the investigation summary back to the issue (opt-in, gated
  // by the same GitHub-write config as status writeback). Fire-and-forget.
  function maybePostIssueReport(autoRun, worktree, body) {
    if (typeof postIssueReport !== "function") return;
    if (autoRun.link?.type !== "issue" || !Number.isFinite(autoRun.link?.number)) return;
    const repoPath = worktree?.repoPath ?? null;
    if (!repoPath || !body) return;
    Promise.resolve(postIssueReport({ issueNumber: autoRun.link.number, repoPath, body })).catch(() => {});
  }
  function commitMessageFor(autoRun) {
    const link = autoRun.link;
    if (link?.type === "issue" && Number.isFinite(link.number)) {
      return `Auto-run: ${link.title ?? "changes"} (#${link.number})`;
    }
    return "Auto-run changes";
  }
  // Best-effort issue status writeback (Phase 4). Only for issue-linked runs;
  // fire-and-forget so a slow/failed gh never blocks the orchestrator.
  function maybeWriteIssueStatus(autoRun, worktree, to) {
    if (typeof writeIssueStatus !== "function") return;
    if (autoRun.link?.type !== "issue" || !Number.isFinite(autoRun.link?.number)) return;
    const repoPath = worktree?.repoPath ?? null;
    if (!repoPath) return;
    Promise.resolve(writeIssueStatus({ issueNumber: autoRun.link.number, repoPath, to })).catch(() => {});
  }
  // Reaction states already handled — advancing past them would re-open a PR.
  // `blocked` (verification failed) is terminal here; a human retries/fixes.
  const settledStatuses = new Set(["pr_open", "report_posted", "needs_input", "plan_proposed", "decomposed", "blocked", "done", "failed", "cancelled"]);

  // The PR body an auto-run opens with, carrying the verification evidence so the
  // pull request is honest about whether checks ran and passed.
  function verificationEvidenceBody(verification, judgment) {
    const state = verification.verified ? (verification.passed ? "passed" : "failed") : "not run (no verification command configured)";
    return `Automated auto-run pull request.\n\n## Verification\n- Checks: ${state}\n${judgmentEvidence(judgment)}\n${verification.summary ? `\n${verification.summary}\n` : ""}`;
  }

  function autoRunStatusForInvocation(invocation) {
    if (invocation.status === "waiting_for_local_approval") return "awaiting_approval";
    if (invocation.status === "rejected") return "failed";
    return "running";
  }

  // A3 circuit breaker bookkeeping on terminal transitions. A `failed` run
  // increments the consecutive-failure count and opens the breaker at the
  // operator threshold; a successful terminal resets it. `blocked`/`needs_input`
  // are deliberate gate outcomes, not execution failures — they're neutral.
  function updateBreakerForTerminal(status) {
    const breaker = (state.autoRunBreaker ??= { consecutiveFailures: 0, openUntil: null });
    if (status === "failed") {
      breaker.consecutiveFailures += 1;
      const threshold = Number(state.autoRunSettings?.breakerFailureThreshold ?? 0);
      if (threshold > 0 && breaker.consecutiveFailures >= threshold && !breaker.openUntil) {
        const cooldownMin = Number(state.autoRunSettings?.breakerCooldownMinutes ?? 15) || 15;
        breaker.openUntil = new Date(Date.parse(now()) + cooldownMin * 60_000).toISOString();
        void sendAlert?.({
          kind: "circuit_breaker_open",
          severity: "high",
          message: `Auto-run circuit breaker opened after ${breaker.consecutiveFailures} consecutive failures; paused until ${breaker.openUntil}.`,
          data: { consecutiveFailures: breaker.consecutiveFailures, openUntil: breaker.openUntil },
        });
      }
    } else if (status === "pr_open" || status === "report_posted" || status === "done") {
      breaker.consecutiveFailures = 0;
      breaker.openUntil = null;
    }
  }

  function setAutoRunStatus(autoRun, status, extra) {
    autoRun.status = status;
    autoRun.updatedAt = now();
    if (extra) Object.assign(autoRun, extra);
    updateBreakerForTerminal(status);
    appendEvent({
      invocationId: autoRun.invocationId,
      type: "auto_run_status_changed",
      level: status === "failed" ? "warn" : "info",
      message: `Auto-run ${autoRun.id} → ${status}.`,
      data: { autoRunId: autoRun.id, status, worktreeId: autoRun.worktreeId },
    });
  }

  // Start an auto-run for a linked issue/PR: materialize the worktree, seed the
  // agent prompt from the issue, and start the invocation inside the worktree.
  // `name` is the branch name the caller already derives (shared branchFromIssue),
  // so the server does not re-implement issue branch naming.
  async function startAutoRun({ projectId, link, agentId, name, baseBranch, actor } = {}) {
    const normalizedLink = normalizeWorktreeLink(link);
    if (!normalizedLink) {
      throw new Error("A GitHub issue or PR link is required to start an auto-run.");
    }
    const agent = agentId ? findAgent(agentId) : defaultAgent();
    if (!agent) {
      throw new Error("No agent is registered to run this issue.");
    }
    if (agent.status === "disabled") {
      throw new Error("The selected agent is disabled.");
    }
    if (agent.location?.type === "local_device" && state.device?.unlinkState !== "linked") {
      throw new Error("The target device is unlinked; link it before starting an auto-run.");
    }
    // O0 cost brake — hard gates BEFORE any spend (worktree/agent). The kill
    // switch halts all autonomous runs immediately; the budget gate refuses when
    // the project is over its cap. Both are fail-closed and cover the manual
    // [Auto] button, the API, and auto-trigger (all funnel through here).
    if (state.autoRunSettings?.autonomyKillSwitch) {
      throw new Error("Autonomy is disabled by the kill switch. Turn it off in Auto-run configuration to resume.");
    }
    if (typeof budgetStatusFor === "function" && projectId) {
      const budget = budgetStatusFor(projectId);
      if (budget?.over) {
        void sendAlert?.({
          kind: "budget_exceeded",
          severity: "high",
          message: `Auto-run blocked: project over budget ($${budget.spentUsd} of $${budget.limitUsd}).`,
          data: { projectId, spentUsd: budget.spentUsd, limitUsd: budget.limitUsd, link: normalizedLink },
        });
        throw new Error(`Budget exceeded for this project (spent $${budget.spentUsd} of $${budget.limitUsd}). Raise the budget or reset spend before starting more runs.`);
      }
    }
    // A3 circuit breaker: too many consecutive failures pauses starts (an outage
    // or rate-limit storm shouldn't keep burning attempts). Auto-closes after the
    // cooldown; alerted when it opened (in setAutoRunStatus).
    const breaker = state.autoRunBreaker;
    if (breaker?.openUntil && Date.parse(now()) < Date.parse(breaker.openUntil)) {
      throw new Error(`Circuit breaker open after ${breaker.consecutiveFailures} consecutive failures; auto-runs paused until ${breaker.openUntil}.`);
    }
    // A3 global concurrency cap (0 = unlimited): system-wide backpressure on top
    // of the per-project cap. Auto-trigger simply retries next scan (soft queue).
    const globalMax = Number(state.autoRunSettings?.globalMaxConcurrent ?? 0);
    if (globalMax > 0) {
      const active = (state.autoRuns ?? []).filter((r) => !settledStatuses.has(r.status)).length;
      if (active >= globalMax) {
        throw new Error(`At capacity: ${active}/${globalMax} auto-runs active. Auto-trigger will retry when one frees up.`);
      }
    }

    const autoRunId = nextId("aur_demo");
    const createdAt = now();

    // 0. Decision step: the injected decider (or the heuristic floor) triages the
    // issue into a path BEFORE any execution. The decision is data, not action.
    // Both the decider and the role prompt get the issue body when it's readable.
    const issueBody = await maybeFetchIssueBody(normalizedLink, projectId ?? state.currentProjectId);
    // B1a: scan the untrusted issue body for prompt-injection markers. A hit
    // never blocks the run (avoids weaponizing false positives into a DoS), but
    // it is recorded, alerted, and — crucially — makes the run ineligible for
    // O2 auto-approval, so a human always reviews a suspicious body.
    const injection = detectPromptInjection(issueBody);
    if (injection.suspicious) {
      void sendAlert?.({
        kind: "prompt_injection_suspected",
        severity: "high",
        message: `Auto-run on ${normalizedLink.type} #${normalizedLink.number}: possible prompt injection in the body (${injection.markers.join(", ")}). Human review required.`,
        data: { link: normalizedLink, markers: injection.markers },
      });
    }
    const decision = await resolveDecision({
      link: normalizedLink,
      issueBody,
      decideIssuePath,
      // Console-saved overrides when present; undefined falls back to the env
      // defaults inside resolveDecision (decisionConfig()).
      minConfidence: decisionSettings?.minConfidence,
      fastPath: decisionSettings?.fastPath,
      // Opt-in: an epic/initiative routes to decompose (a plan, not a diff).
      epicDecomposition: state.autoRunSettings?.epicDecomposition === true,
    });

    // 1. Materialize the worktree from the issue.
    const { worktree } = createWorktree({
      projectId,
      name: name || `issue-${normalizedLink.number}`,
      baseBranch,
      // Fork from the FRESH remote base (origin/<base>), not the stale local branch —
      // otherwise every run's PR conflicts with work merged since the local checkout.
      fetchBase: true,
      agentId: agent.id,
      link: normalizedLink,
    });

    // Record the auto-run BEFORE starting the invocation so the dedup key exists
    // even if invocation creation throws — otherwise auto-trigger, which dedups on
    // autoRuns, would re-pick this issue every tick and pile up orphan worktrees.
    const autoRun = {
      id: autoRunId,
      status: "materializing",
      projectId: worktree.sourceProjectId ?? worktree.projectId ?? projectId ?? null,
      worktreeId: worktree.id,
      invocationId: null,
      agentId: agent.id,
      link: normalizedLink,
      decision,
      // Legacy field, derived from the decision path for record continuity.
      intent: intentForPath(decision.path),
      // The issue body as fetched at start — the content the approval is granted
      // against. A self-repair reuses THIS (not a live re-fetch) so a preApproved
      // continuation can never run content edited after the human approved. Capped.
      issueBody: typeof issueBody === "string" && issueBody ? issueBody.slice(0, 8000) : null,
      // B1a: prompt-injection flag (null when clean) — surfaced + blocks O2 auto-approval.
      promptInjection: injection.suspicious ? { suspicious: true, markers: injection.markers } : null,
      // Depth-1 guard: a spawned child issue may never spawn grandchildren.
      isChildIssue: isSpawnedChildBody(issueBody),
      branchName: worktree.branchName ?? worktree.branch ?? null,
      requestedBy: actor?.userId ?? "usr_local",
      createdAt,
      updatedAt: createdAt,
    };
    state.autoRuns.unshift(autoRun);
    // The routing decision is auditable evidence: path, who decided, and why.
    appendEvent({
      invocationId: null,
      type: "auto_run_decided",
      level: "info",
      message: `Auto-run ${autoRunId} routed to "${decision.path}" by ${decision.decidedBy}.`,
      data: {
        autoRunId,
        path: decision.path,
        decidedBy: decision.decidedBy,
        confidence: decision.confidence,
        spawnChildIssues: decision.spawnChildIssues,
        rationale: decision.rationale,
      },
    });

    // 2. Seed the prompt from the issue, and 3. start the agent run in the worktree.
    let invocation;
    try {
      // Pre-flight context: tell a code-writing run the exact command its output
      // will be checked by, so it can make the check pass before finishing.
      const verifyProject = state.projects.find((p) => p.id === (worktree.sourceProjectId ?? worktree.projectId ?? projectId ?? state.currentProjectId)) ?? null;
      const verifyCmdArr = resolveAutoRunVerifyCommandFor({ verifyCommandName: verifyProject?.verifyCommandName ?? null });
      const verifyCommand = Array.isArray(verifyCmdArr) && verifyCmdArr.length ? verifyCmdArr.join(" ") : null;
      const task = roleAutoRunPrompt(normalizedLink, { path: decision.path, issueBody, verifyCommand });
      invocation = createInvocation(task, agent, {
        actor,
        // role carries the decided path so role-restricted agent-skills render
        // for this run (creation.mjs → renderAgentSkillsIntoWorktree).
        metadata: { worktreeId: worktree.id, projectId: worktree.projectId, autoRunId, role: decision.path },
      });
      startInvocationIfAllowed(invocation, agent);
    } catch (error) {
      setAutoRunStatus(autoRun, "failed", { error: `Could not start the agent run: ${String(error?.message ?? error)}` });
      persistStateSoon();
      throw error;
    }

    autoRun.invocationId = invocation.id;
    setAutoRunStatus(autoRun, autoRunStatusForInvocation(invocation));
    appendEvent({
      invocationId: invocation.id,
      type: "auto_run_started",
      level: "info",
      message: `Auto-run started for ${normalizedLink.type} #${normalizedLink.number}.`,
      data: { autoRunId, worktreeId: worktree.id, invocationId: invocation.id, status: autoRun.status },
    });
    // O2 graduated approval: auto-approve NON-CODE paths (design/clarify/
    // prototype — these produce a summary/spike, never a product-code PR) when
    // the operator opts in, lifting the human from the low-risk paths. develop
    // (edits code + opens a PR) ALWAYS stays human, and merge always stays human.
    // Uses the existing approve path (a human's click, applied by policy), fully
    // audited; the approval hook flips the run to running. Default off = today.
    if (
      autoRun.status === "awaiting_approval" &&
      state.autoRunSettings?.autoApproveNonCodePaths &&
      AUTO_APPROVABLE_PATHS.has(decision.path) &&
      !injection.suspicious && // B1a: a suspicious body always needs a human
      typeof autoApproveInvocation === "function"
    ) {
      const approved = autoApproveInvocation({ invocationId: invocation.id, actor: { userId: "usr_autorun_policy" } });
      if (approved) {
        appendEvent({
          invocationId: invocation.id,
          type: "auto_run_auto_approved",
          level: "info",
          message: `Auto-run ${autoRunId} auto-approved by operations policy (non-code path: ${decision.path}).`,
          data: { autoRunId, path: decision.path },
        });
      }
    }
    // The run has begun (or is parked for approval) — mark the issue in-progress.
    if (autoRun.status !== "failed") {
      maybeWriteIssueStatus(autoRun, worktree, "in-progress");
    }
    persistStateSoon();
    return { autoRun, worktree, invocation };
  }

  // Reaction: when an auto-run's invocation reaches a terminal state, advance the
  // state machine. On success, publish the branch and open the PR (Phase 2 will
  // front-run a verification gate here). On failure, mark the auto-run failed.
  // Called fire-and-forget from completion, so it never throws.
  async function advanceAutoRunForInvocation(invocation) {
    try {
      const autoRun = state.autoRuns.find((item) => item.invocationId === invocation?.id);
      if (!autoRun || settledStatuses.has(autoRun.status)) return null;

      if (invocation.status === "succeeded") {
        const worktree = state.worktrees.find((item) => item.id === autoRun.worktreeId) ?? null;

        // Epic decomposition (opt-in): the deliverable is a PROPOSED plan of child
        // issues, not a diff. Read the agent's decomposition/PLAN.json, build +
        // validate the governed tree, and park at plan_proposed for a human to
        // approve (Slice 3 does the fan-out). No commit, no verify, no PR.
        if (autoRun.decision?.path === "decompose") {
          const proposal = buildDecompositionProposal(autoRun, worktree, invocation);
          maybePostIssueReport(autoRun, worktree, proposal.comment);
          setAutoRunStatus(autoRun, "plan_proposed", proposal.status);
          maybeWriteIssueStatus(autoRun, worktree, "review");
          persistStateSoon();
          return autoRun;
        }

        // Commit the agent's edits so they actually reach the PR (publish only
        // ships commits), and stop early if the run produced nothing to open a PR
        // with — otherwise gh pr create would fail with a confusing error.
        if (typeof commitWorktreeChanges === "function") {
          let commitResult;
          try {
            commitResult = await commitWorktreeChanges(autoRun.worktreeId, { message: commitMessageFor(autoRun) });
          } catch (error) {
            setAutoRunStatus(autoRun, "failed", { error: `Commit failed: ${String(error?.message ?? error)}` });
            persistStateSoon();
            return autoRun;
          }
          if (!commitResult.hasCommits) {
            // No diff — route by the decided path instead of treating it as a
            // dead end. A design/prototype run's deliverable IS the findings; a
            // clarify run hands its questions back to a human; only a develop
            // run with no diff is blocked. Old persisted records without a
            // decision fall back to the legacy intent mapping.
            const path = autoRun.decision?.path
              ?? ({ investigation: "design", question: "clarify" }[autoRun.intent] ?? "develop");
            if (path === "design" || path === "prototype") {
              const summary = extractRunSummary(invocation) ?? "Investigation complete — no code change was needed.";
              maybePostIssueReport(autoRun, worktree, summary);
              const spawn = await maybeSpawnChildIssue(autoRun, worktree, summary);
              setAutoRunStatus(autoRun, "report_posted", {
                report: summary,
                error: null,
                ...(spawn?.child ? { childIssues: [spawn.child] } : {}),
                ...(spawn?.error ? { spawnError: spawn.error } : {}),
              });
              // The design is delivered and waits on a human — the issue label
              // should say review, not linger at in-progress. (Pilot finding.)
              maybeWriteIssueStatus(autoRun, worktree, "review");
            } else if (path === "clarify") {
              const questions = autoRun.decision?.clarifyingQuestions ?? [];
              const summary = extractRunSummary(invocation);
              const report = questions.length
                ? `${summary ? `${summary}\n\n` : ""}Open questions:\n${questions.map((q) => `- ${q}`).join("\n")}`
                : summary;
              setAutoRunStatus(autoRun, "needs_input", {
                report,
                error: "The run needs a human decision before it can proceed.",
              });
              maybeWriteIssueStatus(autoRun, worktree, "review");
            } else {
              setAutoRunStatus(autoRun, "blocked", { error: "The agent run produced no changes to open a pull request with." });
            }
            persistStateSoon();
            return autoRun;
          }

          // D3 design artifacts (opt-in designArtifacts setting): a design run
          // whose ONLY changes are visual mockups under design/ delivers them as
          // report + in-console preview — not a PR. Any product-code change
          // keeps today's behavior (verify → publish → PR, the "diverted" path).
          // designImagesToIssue (Layer B) IMPLIES this path — otherwise turning on
          // only the "embed previews" toggle would silently open a PR and never
          // render/embed anything (review finding: the two toggles were uncoupled).
          const decidedPath = autoRun.decision?.path
            ?? ({ investigation: "design", question: "clarify" }[autoRun.intent] ?? "develop");
          if (
            commitResult.hasCommits &&
            decidedPath === "design" &&
            (state.autoRunSettings?.designArtifacts || state.autoRunSettings?.designImagesToIssue) &&
            typeof listWorktreeChangedFiles === "function"
          ) {
            let changed = [];
            try {
              changed = (await listWorktreeChangedFiles(autoRun.worktreeId)) ?? [];
            } catch {
              changed = [];
            }
            const designOnly = changed.length > 0 && changed.every((p) => String(p).startsWith("design/"));
            if (designOnly) {
              // E1: prefer the FULL written brief (design/BRIEF.md) over the thin
              // terminal summary — the agent puts the depth in the file.
              const brief = typeof readWorktreeTextFile === "function" ? readWorktreeTextFile(autoRun.worktreeId, "design/BRIEF.md") : null;
              const summary = brief || extractRunSummary(invocation) || "Design delivered as visual mockups (see the design artifacts).";
              // Layer B (opt-in): render + push the mockups so real pixels render
              // inline on the issue; {} when off/unavailable.
              const imageUrls = await maybeHostDesignImages(autoRun, worktree);
              // Layer A: the brief IS what a human sees on the issue; index the
              // mockups beneath it so the reader knows a richer visual exists and
              // where to open it. Layer B's URLs embed the previews inline.
              maybePostIssueReport(autoRun, worktree, composeDesignIssueComment({ brief: summary, artifacts: changed, imageUrls }));
              const spawn = await maybeSpawnChildIssue(autoRun, worktree, summary);
              setAutoRunStatus(autoRun, "report_posted", {
                report: summary,
                designArtifacts: changed,
                ...(Object.keys(imageUrls).length ? { designImageUrls: imageUrls } : {}),
                error: null,
                ...(spawn?.child ? { childIssues: [spawn.child] } : {}),
                ...(spawn?.error ? { spawnError: spawn.error } : {}),
              });
              maybeWriteIssueStatus(autoRun, worktree, "review");
              persistStateSoon();
              return autoRun;
            }
          }

          // E2: a prototype run's committed changes are a THROWAWAY spike — deliver
          // the findings (report_posted, spike stays browsable in the worktree),
          // never verify→publish→PR (which could auto-merge a spike).
          if (commitResult.hasCommits && decidedPath === "prototype") {
            const brief = typeof readWorktreeTextFile === "function" ? readWorktreeTextFile(autoRun.worktreeId, "prototype/FINDINGS.md") : null;
            const summary = brief || extractRunSummary(invocation) || "Prototype spike complete — see the findings.";
            maybePostIssueReport(autoRun, worktree, summary);
            const spawn = await maybeSpawnChildIssue(autoRun, worktree, summary);
            setAutoRunStatus(autoRun, "report_posted", {
              report: summary,
              error: null,
              ...(spawn?.child ? { childIssues: [spawn.child] } : {}),
              ...(spawn?.error ? { spawnError: spawn.error } : {}),
            });
            maybeWriteIssueStatus(autoRun, worktree, "review");
            persistStateSoon();
            return autoRun;
          }
        }

        // Verification gate: run the project's checks in the worktree. A real
        // check that fails BLOCKS the PR; an unconfigured gate opens the PR but
        // labels it unverified (never fabricates a pass).
        setAutoRunStatus(autoRun, "verifying");
        let verification = { passed: true, verified: false, summary: "No verification command configured." };
        try {
          if (typeof verifyWorktree === "function") {
            verification = await verifyWorktree({ worktree, autoRun });
          }
        } catch (error) {
          verification = { passed: false, verified: true, summary: `Verification error: ${String(error?.message ?? error)}` };
        }
        autoRun.verification = { passed: verification.passed, verified: verification.verified, summary: verification.summary ?? null };
        if (verification.verified && !verification.passed) {
          // Self-repair: feed the failing check back to the agent for another attempt
          // in the SAME worktree, rather than blocking on the first failure. Bounded
          // by the attempt cap. Only develop runs repair — design/clarify/etc. produce
          // no code to re-verify.
          const maxRepairs = state.autoRunSettings?.maxRepairAttempts ?? 2;
          const attempts = autoRun.repairAttempts ?? 0;
          const repairEligible = maxRepairs > 0 && attempts < maxRepairs && (autoRun.decision?.path ?? "develop") === "develop";
          // A repair spawns a NEW agent run, so it must clear the same spend/safety
          // gates a fresh run does — otherwise it spends past the budget, ignores the
          // kill switch, and defeats the breaker (worst case: the original run's spend
          // just tipped the project over budget). Only probed when a repair would run.
          const repairRefusal = repairEligible ? autoRunSpendRefusal(autoRun.projectId) : null;
          if (repairEligible && !repairRefusal) {
            const agent = findAgent(autoRun.agentId);
            if (agent && typeof createInvocation === "function") {
              autoRun.repairAttempts = attempts + 1;
              // Reuse the issue body APPROVED at start, NOT a live re-fetch: a
              // preApproved repair must run the exact content the human approved,
              // else an issue edited after approval would reach the agent unapproved
              // (a TOCTOU that skips both the gate and the injection scan).
              const issueBody = autoRun.issueBody ?? null;
              const repairTask =
                `${roleAutoRunPrompt(autoRun.link, { path: "develop", issueBody })}\n\n` +
                `Your previous attempt is ALREADY in this worktree but FAILED the verification check:\n\n` +
                `${String(verification.summary ?? "").slice(0, 2000)}\n\n` +
                `Fix the failing check without expanding scope. This is repair attempt ${autoRun.repairAttempts} of ${maxRepairs}.`;
              let repair = null;
              try {
                repair = createInvocation(repairTask, agent, {
                  preApproved: true, // continuation of an already human-approved run on unchanged content — no re-gate
                  metadata: { worktreeId: autoRun.worktreeId, projectId: autoRun.projectId, autoRunId: autoRun.id, role: "develop", repairAttempt: autoRun.repairAttempts },
                });
              } catch {
                repair = null;
              }
              if (repair) {
                autoRun.invocationId = repair.id;
                setAutoRunStatus(autoRun, autoRunStatusForInvocation(repair), { error: null });
                appendEvent({
                  invocationId: repair.id,
                  type: "auto_run_repair_started",
                  level: "info",
                  message: `Auto-run ${autoRun.id} self-repair attempt ${autoRun.repairAttempts}/${maxRepairs} after a failed check.`,
                  data: { autoRunId: autoRun.id, attempt: autoRun.repairAttempts },
                });
                startInvocationIfAllowed(repair, agent);
                persistStateSoon();
                return autoRun;
              }
            }
          }
          const blockReason = repairRefusal
            ? `Self-repair paused: ${repairRefusal}. ${verification.summary ?? ""}`.trim()
            : verification.summary ?? "Verification failed.";
          setAutoRunStatus(autoRun, "blocked", { error: blockReason });
          persistStateSoon();
          return autoRun;
        }
        // Acceptance judge (Phase B): did the diff solve THIS issue — the quality
        // the build/tests can't see. A real negative verdict blocks; an infra
        // failure (null) never does, it just labels the PR honestly.
        let judgment;
        if (typeof judgeAcceptance === "function") {
          try {
            judgment = await judgeAcceptance({ worktree, autoRun });
          } catch {
            judgment = null;
          }
          autoRun.judgment = judgment
            ? { solved: judgment.solved, confidence: judgment.confidence, summary: judgment.summary ?? null, gaps: judgment.gaps ?? [] }
            : { solved: null, confidence: null, summary: "Judge errored — verdict unavailable.", gaps: [] };
          if (judgment && judgment.solved === false) {
            const gaps = judgment.gaps.length ? ` Gaps: ${judgment.gaps.join("; ")}` : "";
            setAutoRunStatus(autoRun, "blocked", { error: `Acceptance judge: the change does not solve the issue.${gaps}` });
            maybeWriteIssueStatus(autoRun, worktree, "review");
            persistStateSoon();
            return autoRun;
          }
        }
        // D5 (visual acceptance): surface any image files the change produced
        // (e.g. an operator's playwright verify command writing screenshots into
        // the worktree) so a human sees the visual before merging.
        let screenshots = [];
        if (typeof listWorktreeChangedFiles === "function") {
          try {
            const changed = (await listWorktreeChangedFiles(autoRun.worktreeId)) ?? [];
            screenshots = changed.filter((f) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(String(f))).slice(0, 20);
          } catch {
            screenshots = [];
          }
        }
        setAutoRunStatus(autoRun, "publishing");
        try {
          await publishWorktreeBranch(autoRun.worktreeId);
          // H2: if this run remediates a failed deploy, its issue body carries a
          // `Change-failure: #N` marker — propagate it onto the PR body so DORA's
          // change-failure rate + recovery see the remediation (fix-forward).
          const changeFailureRef = extractChangeFailureRef(autoRun.issueBody);
          const prBody = verificationEvidenceBody(verification, judgment) + (changeFailureRef ? `\n\nChange-failure: #${changeFailureRef}\n` : "");
          const pr = await createWorktreePr(autoRun.worktreeId, { body: prBody });
          setAutoRunStatus(autoRun, "pr_open", { prNumber: pr?.number ?? null, prUrl: pr?.url ?? null, error: null, ...(screenshots.length ? { screenshots } : {}) });
          maybeWriteIssueStatus(autoRun, worktree, "review");
        } catch (error) {
          setAutoRunStatus(autoRun, "failed", { error: String(error?.message ?? error) });
        }
      } else {
        // failed | timed_out | cancelled | rejected
        setAutoRunStatus(autoRun, "failed", { error: `Agent run ${invocation.status}.` });
      }
      persistStateSoon();
      return autoRun;
    } catch {
      // Never let a reaction error escape the fire-and-forget caller.
      return null;
    }
  }

  // Reflect a granted approval on the run card: without this the auto-run sat
  // at awaiting_approval until a terminal state. (Pilot finding.)
  function syncAutoRunOnApproval(invocation) {
    const autoRun = state.autoRuns.find((item) => item.invocationId === invocation?.id);
    if (!autoRun || autoRun.status !== "awaiting_approval") return null;
    setAutoRunStatus(autoRun, "running");
    persistStateSoon();
    return autoRun;
  }

  // Reflect a DENIED approval: the human rejected the run at the gate, so mark it
  // terminal AND reclaim the worktree + branch it created. Two bugs this closes
  // (both seen live): without the teardown an abandoned branch blocks a fresh run
  // on the same issue ("branch issue-N already exists"); without this hook the run
  // sat at awaiting_approval forever. destroyWorktree is SAFE — it preserves a
  // worktree that holds un-pushed work (a denied retry can reuse one a prior
  // approved run committed to), so an empty run is reclaimed and a work-bearing one
  // is kept for recovery.
  function syncAutoRunOnDenial(invocation) {
    const autoRun = state.autoRuns.find((item) => item.invocationId === invocation?.id);
    if (!autoRun || settledStatuses.has(autoRun.status)) return null;
    const worktreeId = autoRun.worktreeId ?? null;
    if (worktreeId && typeof destroyWorktree === "function") {
      try {
        destroyWorktree(worktreeId, { deleteBranch: true });
      } catch {
        // Teardown is best-effort; the run is marked failed regardless below.
      }
    }
    const kept = worktreeId && state.worktrees.some((w) => w.id === worktreeId);
    setAutoRunStatus(autoRun, "failed", {
      error: kept
        ? "Local approval denied. The worktree was kept because it holds un-pushed work."
        : "Local approval denied — the worktree and branch were reclaimed.",
    });
    refuse({
      subject: { kind: "invocation", id: invocation.id },
      requester: { kind: "automation", id: autoRun.id },
      category: "human",
      code: "approval_denied",
      decidedBy: { kind: "user", id: "usr_local" },
      summary: `Auto-run ${autoRun.id} was denied at the approval gate.`,
      evidence: { autoRunId: autoRun.id, worktreeId, worktreeKept: Boolean(kept) },
      remedy: "Re-run the issue and approve it at the local gate.",
      retryAfter: null,
      appealTo: "device_owner",
      event: {
        invocationId: invocation.id,
        type: "auto_run_denied",
        level: "warn",
        message: `Auto-run ${autoRun.id} was denied at the approval gate; worktree ${kept ? "kept (holds un-pushed work)" : "and branch reclaimed"}.`,
        data: { autoRunId: autoRun.id, worktreeId, worktreeKept: Boolean(kept) },
      },
    });
    persistStateSoon();
    return autoRun;
  }

  // Retry a failed/blocked auto-run on its existing worktree: rebuild the role
  // prompt and start a fresh invocation for the same record. Without this a
  // failed run dead-ended — the trigger dedup (correctly) never re-picks an
  // issue that has a settled run. (Pilot finding.)
  // Operator STOP for an in-flight run (运营性 / local control): cancel the underlying
  // agent invocation and settle the run as `cancelled`. Because `cancelled` is in
  // settledStatuses, the invocation-terminal reaction (advanceAutoRunForInvocation)
  // then skips it instead of re-deriving `failed`. Non-destructive: the worktree is left
  // intact (a fresh run can reuse it), matching retry/teardown's non-destructive posture.
  function cancelAutoRun(autoRunId, { actor } = {}) {
    const autoRun = state.autoRuns.find((item) => item.id === autoRunId);
    if (!autoRun) throw new Error("Auto-run not found.");
    if (settledStatuses.has(autoRun.status)) {
      throw new Error("This run has already settled; only an in-flight run can be cancelled.");
    }
    if (autoRun.invocationId && typeof cancelInvocation === "function") {
      const invocation = findInvocation(autoRun.invocationId);
      if (invocation && !isTerminal(invocation.status)) {
        try {
          cancelInvocation(invocation, actor);
        } catch {
          // Best-effort: even if the agent cancel signal fails, still settle the run so
          // the operator isn't stuck watching a run they've explicitly stopped.
        }
      }
    }
    setAutoRunStatus(autoRun, "cancelled", { error: null });
    persistStateSoon();
    return autoRun;
  }

  async function retryAutoRun(autoRunId, { actor } = {}) {
    const autoRun = state.autoRuns.find((item) => item.id === autoRunId);
    if (!autoRun) throw new Error("Auto-run not found.");
    if (!["failed", "blocked"].includes(autoRun.status)) {
      throw new Error("Only a failed or blocked auto-run can be retried.");
    }
    const worktree = state.worktrees.find((item) => item.id === autoRun.worktreeId) ?? null;
    if (!worktree) throw new Error("The auto-run's worktree no longer exists; start a fresh run instead.");
    const agent = (autoRun.agentId ? findAgent(autoRun.agentId) : null) ?? defaultAgent();
    if (!agent) throw new Error("No agent is registered to retry this run.");
    if (agent.status === "disabled") throw new Error("The selected agent is disabled.");
    if (agent.location?.type === "local_device" && state.device?.unlinkState !== "linked") {
      throw new Error("The target device is unlinked; link it before retrying.");
    }

    const issueBody = await maybeFetchIssueBody(autoRun.link, autoRun.projectId);
    const retryPath = autoRun.decision?.path ?? "develop";
    const task = roleAutoRunPrompt(autoRun.link, { path: retryPath, issueBody });
    let invocation;
    try {
      invocation = createInvocation(task, agent, {
        actor,
        // Same role seeding as the initial run so role-restricted skills render.
        metadata: { worktreeId: worktree.id, projectId: worktree.projectId, autoRunId: autoRun.id, role: retryPath },
      });
      startInvocationIfAllowed(invocation, agent);
    } catch (error) {
      setAutoRunStatus(autoRun, "failed", { error: `Retry could not start the agent run: ${String(error?.message ?? error)}` });
      persistStateSoon();
      throw error;
    }
    autoRun.invocationId = invocation.id;
    // Fresh repair budget for the retry — otherwise a run that exhausted its
    // repairs stays at the cap and the retried attempt gets zero self-repair.
    autoRun.repairAttempts = 0;
    setAutoRunStatus(autoRun, autoRunStatusForInvocation(invocation), { error: null, prNumber: null, prUrl: null });
    appendEvent({
      invocationId: invocation.id,
      type: "auto_run_retried",
      level: "info",
      message: `Auto-run ${autoRun.id} retried on its existing worktree.`,
      data: { autoRunId: autoRun.id, worktreeId: worktree.id, invocationId: invocation.id, status: autoRun.status },
    });
    persistStateSoon();
    return { autoRun, invocation };
  }

  // Human-triggered PR merge from the console. The merge stays human — this only
  // runs when a person clicks Merge on a pr_open run; it is never automatic.
  // Guards: the run must have an open PR; a MERGED run is a no-op. On success
  // the record flips to prState=MERGED (the routing eval then counts it merged).
  async function mergeAutoRunPr(autoRunId, { actor } = {}) {
    const autoRun = state.autoRuns.find((item) => item.id === autoRunId);
    if (!autoRun) throw new Error("Auto-run not found.");
    if (autoRun.prState === "MERGED") return { ok: true, alreadyMerged: true, prNumber: autoRun.prNumber };
    if (autoRun.status !== "pr_open" || !autoRun.prNumber) {
      throw new Error("Only an auto-run with an open PR can be merged.");
    }
    if (typeof mergePr !== "function") throw new Error("PR merge is not available on this server.");
    const project = state.projects.find((item) => item.id === autoRun.projectId) ?? null;
    const repoPath = project?.path;
    if (!repoPath) throw new Error("The auto-run's project path is unavailable.");

    // Opt-in hard gate: when the operator requires green checks, refuse a merge
    // unless the checks are all green (unknown/failing/pending all block). Re-fetch
    // FRESH here — trusting the throttled poll's prChecks would let a since-gone-red
    // PR through on stale-green. A fetch failure leaves prChecks as-is → still gated.
    if (state.autoRunSettings?.requireChecksGreenToMerge) {
      // FAIL CLOSED: runPrChecks returns null on a gh failure (not throw), so a
      // stale cached SUCCESS must not satisfy the gate — require a CONFIRMED
      // fresh green this call. (audit finding)
      let confirmed = false;
      if (typeof fetchPrChecks === "function") {
        const fresh = await fetchPrChecks({ prNumber: autoRun.prNumber, repoPath });
        if (fresh) {
          autoRun.prChecks = fresh;
          autoRun.prStateCheckedAt = now();
          confirmed = true;
        }
      }
      if (!confirmed || autoRun.prChecks?.state !== "SUCCESS") {
        const posture = !confirmed ? "unconfirmed (fresh fetch failed)" : autoRun.prChecks.state.toLowerCase();
        throw new Error(`Merge blocked: setting requires green PR checks, but checks are ${posture}. Fix the checks or disable "require green checks to merge".`);
      }
    }

    const result = await mergePr({ prNumber: autoRun.prNumber, repoPath });
    if (!result?.ok) {
      throw new Error(result?.error || "gh pr merge failed.");
    }
    autoRun.prState = "MERGED";
    autoRun.prStateCheckedAt = now();
    appendEvent({
      invocationId: autoRun.invocationId,
      type: "auto_run_pr_merged",
      level: "info",
      message: `Auto-run ${autoRun.id} PR #${autoRun.prNumber} merged by ${actor?.userId ?? "usr_local"}.`,
      data: { autoRunId: autoRun.id, prNumber: autoRun.prNumber, method: result.method ?? "squash" },
    });
    persistStateSoon();
    // D1 deploy stage: fire the deploy asynchronously so the merge call returns
    // promptly; the deployment record + card update land when it finishes.
    void maybeDeployAfterMerge(autoRun);
    return { ok: true, prNumber: autoRun.prNumber, prState: "MERGED" };
  }

  // D1 deploy stage: after a PR merges, run the operator's deploy command (opt-in
  // deployOnMerge + a configured command). Records one `deployments` entry per
  // attempt and stamps autoRun.deployment. A deploy is a continuation of an already
  // human-approved+merged run — no new gate — but it still honors the kill switch
  // (an emergency stop halts delivery too). Best-effort: a deploy that can't RUN
  // (null) is an infra miss and is NOT recorded as a failure (only a deploy that
  // ran and reported failure is); never throws. Idempotent per merged PR.
  async function maybeDeployAfterMerge(autoRun) {
    if (!autoRun || autoRun.prState !== "MERGED") return null;
    if (!state.autoRunSettings?.deployOnMerge || typeof runDeploy !== "function") return null;
    if (state.autoRunSettings?.autonomyKillSwitch) return null;
    if (autoRun.deployment && autoRun.deployment.prNumber === autoRun.prNumber) return null;
    const project = state.projects.find((p) => p.id === autoRun.projectId) ?? null;
    let outcome = null;
    try {
      outcome = await runDeploy({ link: autoRun.link, prNumber: autoRun.prNumber, repoPath: project?.path ?? null });
    } catch {
      outcome = null;
    }
    if (!outcome) return null; // couldn't run → infra miss, not a change-failure
    const record = {
      id: nextId("dep_demo"),
      autoRunId: autoRun.id,
      projectId: autoRun.projectId ?? null,
      prNumber: autoRun.prNumber ?? null,
      status: outcome.deployed ? "deployed" : "failed",
      summary: outcome.summary || null,
      at: now(),
    };
    state.deployments = [record, ...(state.deployments ?? [])].slice(0, 500);
    autoRun.deployment = { status: record.status, at: record.at, summary: record.summary, prNumber: record.prNumber };
    appendEvent({
      invocationId: autoRun.invocationId,
      type: outcome.deployed ? "auto_run_deployed" : "auto_run_deploy_failed",
      level: outcome.deployed ? "info" : "warn",
      message: `Auto-run ${autoRun.id} deploy of PR #${autoRun.prNumber} ${outcome.deployed ? "succeeded" : "FAILED"}.`,
      data: { autoRunId: autoRun.id, prNumber: autoRun.prNumber, deployed: outcome.deployed },
    });
    if (!outcome.deployed) {
      void sendAlert?.({
        kind: "deploy_failed",
        severity: "high",
        message: `Auto-run ${autoRun.id}: deploy of PR #${autoRun.prNumber} FAILED. ${record.summary ?? ""}`.trim(),
        data: { autoRunId: autoRun.id, prNumber: autoRun.prNumber },
      });
      // Self-healing (H1): auto-rollback restores the last good version. This IS the
      // recovery — fast + automatic, so L5's "recovery <1h" becomes real. Recorded
      // as a `rolled_back` deployment that summarizeDeployments counts as the
      // recovery for this failure. Best-effort; a rollback that can't run is left
      // for a human (the deploy_failed alert already fired).
      const rolledBack = await maybeRollbackDeploy(autoRun, project);
      // Self-healing (H2): file a remediation issue so the loop fixes it FORWARD
      // (rollback restores service; the remediation fixes the root cause). The fix
      // PR carries the Change-failure: #N marker (propagated from the issue body).
      await maybeRemediateDeploy(autoRun, project, { summary: record.summary, rolledBack: Boolean(rolledBack) });
    }
    persistStateSoon();
    return record;
  }

  // Self-healing (H2): file an auto-labeled remediation issue after a failed deploy
  // so the existing auto-trigger picks it up → fixes → re-deploys (the fix-forward
  // recovery). Opt-in + best-effort (a GitHub write; a failure never throws).
  // Idempotent per merged PR (won't file twice for the same failure).
  async function maybeRemediateDeploy(autoRun, project, { summary, rolledBack } = {}) {
    if (!state.autoRunSettings?.remediateOnDeployFailure || typeof fileRemediationIssue !== "function") return null;
    if (autoRun.remediationIssue) return null;
    const culprit = autoRun.prNumber;
    if (!Number.isFinite(culprit)) return null;
    const title = `Fix failed deploy of PR #${culprit}`;
    const body =
      `The deploy of PR #${culprit}${rolledBack ? " was auto-rolled back after it" : ""} failed. Fix the underlying problem so the change can be re-deployed safely. Filed automatically by the self-healing delivery loop.\n\n` +
      `## Failure\n${String(summary ?? "(no summary)").slice(0, 2000)}\n\n` +
      // The DORA change-failure marker: this remediation names the culprit PR. It
      // is propagated onto the fix PR body so github:dora's CFR/recovery sees it.
      `Change-failure: #${culprit}\n\n` +
      `${extractProjectFieldsBlock(autoRun.issueBody) || DEFAULT_REMEDIATION_FIELDS}`;
    let created = null;
    let remediationError = null;
    try {
      created = await fileRemediationIssue({ repoPath: project?.path ?? null, title, body, labels: ["auto"] });
    } catch (error) {
      remediationError = error;
      created = null;
    }
    if (!created?.number) {
      // Remediation was opted-in but the fix-forward issue couldn't be filed → surface
      // it so a human files the fix. Otherwise the root cause is silently never
      // addressed: rollback (if any) only restored the previous version, it did not
      // fix the bug that failed the deploy.
      const detail =
        remediationError instanceof Error
          ? remediationError.message
          : remediationError != null
            ? String(remediationError)
            : "the issue could not be created";
      appendEvent({
        invocationId: autoRun.invocationId,
        type: "auto_run_remediation_failed",
        level: "warn",
        message: `Auto-run ${autoRun.id}: could not file the remediation issue for the failed deploy of PR #${culprit} — file the fix-forward manually (${detail}).`,
        data: { autoRunId: autoRun.id, prNumber: culprit },
      });
      void sendAlert?.({
        kind: "remediation_failed",
        severity: "medium",
        message: `Auto-run ${autoRun.id}: remediation issue for the failed deploy of PR #${culprit} could not be filed (${detail}).`,
        data: { autoRunId: autoRun.id, prNumber: culprit },
      });
      return null;
    }
    autoRun.remediationIssue = { number: created.number, url: created.url ?? null, culpritPr: culprit };
    appendEvent({
      invocationId: autoRun.invocationId,
      type: "auto_run_remediation_filed",
      level: "warn",
      message: `Auto-run ${autoRun.id}: filed remediation issue #${created.number} for the failed deploy of PR #${culprit}.`,
      data: { autoRunId: autoRun.id, prNumber: culprit, remediationIssue: created.number },
    });
    return created;
  }

  // Self-healing (H1): run the operator rollback command after a failed deploy.
  async function maybeRollbackDeploy(autoRun, project) {
    if (!state.autoRunSettings?.rollbackOnDeployFailure || typeof runRollback !== "function") return null;
    let rb = null;
    let rollbackError = null;
    try {
      rb = await runRollback({ link: autoRun.link, prNumber: autoRun.prNumber, repoPath: project?.path ?? null });
    } catch (error) {
      rollbackError = error;
      rb = null;
    }
    if (!rb?.deployed) {
      // Rollback was opted-in but couldn't restore the previous version → the failed
      // deploy is likely STILL LIVE. That is worse than a plain deploy failure (the
      // deploy_failed alert already implied "we'll handle it"), so surface it loudly
      // instead of silently leaving it — an operator has to step in NOW.
      const detail =
        rollbackError instanceof Error
          ? rollbackError.message
          : rollbackError != null
            ? String(rollbackError)
            : "the rollback command reported it did not roll back";
      appendEvent({
        invocationId: autoRun.invocationId,
        type: "auto_run_rollback_failed",
        level: "error",
        message: `Auto-run ${autoRun.id}: auto-rollback of the failed deploy of PR #${autoRun.prNumber} did NOT succeed — the bad deploy may still be live (${detail}).`,
        data: { autoRunId: autoRun.id, prNumber: autoRun.prNumber ?? null },
      });
      void sendAlert?.({
        kind: "rollback_failed",
        severity: "critical",
        message: `Auto-run ${autoRun.id}: auto-rollback FAILED for PR #${autoRun.prNumber} — the failed deploy may still be live; manual intervention needed.`,
        data: { autoRunId: autoRun.id, prNumber: autoRun.prNumber ?? null },
      });
      return null; // couldn't run or reported failure → surfaced; left for a human
    }
    const rbRecord = {
      id: nextId("dep_demo"),
      autoRunId: autoRun.id,
      projectId: autoRun.projectId ?? null,
      prNumber: autoRun.prNumber ?? null,
      status: "rolled_back",
      summary: rb.summary || `Rolled back after the failed deploy of PR #${autoRun.prNumber}.`,
      at: now(),
    };
    state.deployments = [rbRecord, ...(state.deployments ?? [])].slice(0, 500);
    autoRun.deployment = { status: "rolled_back", at: rbRecord.at, summary: rbRecord.summary, prNumber: rbRecord.prNumber };
    appendEvent({
      invocationId: autoRun.invocationId,
      type: "auto_run_rolled_back",
      level: "warn",
      message: `Auto-run ${autoRun.id}: auto-rolled back the failed deploy of PR #${autoRun.prNumber}.`,
      data: { autoRunId: autoRun.id, prNumber: autoRun.prNumber },
    });
    void sendAlert?.({
      kind: "deploy_rolled_back",
      severity: "high",
      message: `Auto-run ${autoRun.id}: auto-rolled back the failed deploy of PR #${autoRun.prNumber}.`,
      data: { autoRunId: autoRun.id, prNumber: autoRun.prNumber },
    });
    return rbRecord;
  }

  // D4 (issue→UI-design plan): the human design gate. Approving a posted design
  // spawns the implementation child issue carrying the brief + artifact list —
  // the explicit click IS the authorization (works even when automatic spawning
  // is off). Rejecting records feedback back onto the issue. Both audited.
  async function approveDesign(autoRunId, { actor } = {}) {
    const autoRun = state.autoRuns.find((item) => item.id === autoRunId);
    if (!autoRun) throw new Error("Auto-run not found.");
    if ((autoRun.decision?.path ?? null) !== "design") throw new Error("Only a design run's report can be approved.");
    if (autoRun.status !== "report_posted") throw new Error("Only a posted design report can be approved.");
    const by = actor?.userId ?? "usr_local";
    if (autoRun.designApproval?.status === "approved" || autoRun.designApproval?.status === "approving") {
      // Already approved, or a near-simultaneous approve is mid-flight — short
      // circuit so two POSTs (double-click / CSRF burst) don't spawn two child
      // issues. (audit finding: approveDesign TOCTOU)
      return { ok: true, alreadyApproved: true, childIssues: autoRun.childIssues ?? [] };
    }
    if (Array.isArray(autoRun.childIssues) && autoRun.childIssues.length > 0) {
      // The implementation issue already exists (auto-spawned at report time);
      // the approval is the human sign-off on record.
      autoRun.designApproval = { status: "approved", by, at: now() };
      appendEvent({
        invocationId: autoRun.invocationId,
        type: "auto_run_design_approved",
        level: "info",
        message: `Auto-run ${autoRun.id} design approved by ${by} (implementation issue already spawned).`,
        data: { autoRunId: autoRun.id, childIssues: autoRun.childIssues },
      });
      persistStateSoon();
      return { ok: true, childIssues: autoRun.childIssues };
    }
    if (autoRun.link?.type !== "issue" || !Number.isFinite(autoRun.link?.number)) {
      throw new Error("The design run has no linked issue to spawn an implementation issue from.");
    }
    const worktree = state.worktrees.find((item) => item.id === autoRun.worktreeId) ?? null;
    const repoPath = worktree?.repoPath ?? null;
    if (!repoPath) throw new Error("The design run's repository is unavailable.");
    if (typeof spawnChildIssueDirect !== "function") throw new Error("Child-issue creation is not available on this server.");
    autoRun.designApproval = { status: "approving", by, at: now() }; // claim before the await
    const design = [
      autoRun.report || "Design approved.",
      ...(Array.isArray(autoRun.designArtifacts) && autoRun.designArtifacts.length
        ? ["", "Design artifacts (in the design worktree):", ...autoRun.designArtifacts.map((a) => `- ${a}`)]
        : []),
    ].join("\n");
    const child = await spawnChildIssueDirect({ parentLink: autoRun.link, design, repoPath });
    if (!child || !Number.isFinite(child.number)) throw new Error("Child issue creation failed.");
    autoRun.childIssues = [{ number: child.number, url: child.url ?? null }];
    autoRun.designApproval = { status: "approved", by, at: now() };
    appendEvent({
      invocationId: autoRun.invocationId,
      type: "auto_run_design_approved",
      level: "info",
      message: `Auto-run ${autoRun.id} design approved by ${by}; implementation issue #${child.number} spawned.`,
      data: { autoRunId: autoRun.id, childIssue: child.number, url: child.url ?? null },
    });
    persistStateSoon();
    return { ok: true, childIssues: autoRun.childIssues };
  }

  async function rejectDesign(autoRunId, { actor, feedback } = {}) {
    const autoRun = state.autoRuns.find((item) => item.id === autoRunId);
    if (!autoRun) throw new Error("Auto-run not found.");
    if ((autoRun.decision?.path ?? null) !== "design") throw new Error("Only a design run's report can be rejected.");
    if (autoRun.status !== "report_posted") throw new Error("Only a posted design report can be rejected.");
    const by = actor?.userId ?? "usr_local";
    const note = String(feedback ?? "").trim().slice(0, 2000);
    autoRun.designApproval = { status: "rejected", by, at: now(), feedback: note || null };
    const worktree = state.worktrees.find((item) => item.id === autoRun.worktreeId) ?? null;
    maybePostIssueReport(autoRun, worktree, `Design not approved by ${by}.${note ? `\n\nRequested changes:\n${note}` : ""}`);
    refuse({
      subject: { kind: "invocation", id: autoRun.invocationId },
      requester: { kind: "automation", id: autoRun.id },
      category: "human",
      code: "deliverable_rejected",
      decidedBy: { kind: "user", id: by },
      summary: `Auto-run ${autoRun.id} design rejected by ${by}.`,
      evidence: { autoRunId: autoRun.id, feedback: note || null },
      remedy: note || "Revise the design to address the reviewer's requested changes and re-post.",
      retryAfter: null,
      appealTo: "device_owner",
      event: {
        invocationId: autoRun.invocationId,
        type: "auto_run_design_rejected",
        level: "info",
        message: `Auto-run ${autoRun.id} design rejected by ${by}.`,
        data: { autoRunId: autoRun.id, feedback: note || null },
      },
    });
    persistStateSoon();
    return { ok: true };
  }

  // Epic decomposition (Slice 3): the human approves a proposed plan → spawn the N
  // governed child issues. The click IS the authorization (ungated by the
  // spawn-issues env flag, like design approval). Re-validates the tree WITH the
  // approval as evidence so a structurally-broken plan is never spawned. Idempotent
  // (a second approve returns the already-created children, never double-spawns).
  async function approveDecomposition(autoRunId, { actor } = {}) {
    const autoRun = state.autoRuns.find((item) => item.id === autoRunId);
    if (!autoRun) throw new Error("Auto-run not found.");
    if ((autoRun.decision?.path ?? null) !== "decompose") throw new Error("Only a decomposition run's plan can be approved.");
    // Idempotency BEFORE the status guard: a second approve (status now decomposed,
    // or a near-simultaneous approving) short-circuits instead of erroring — two
    // POSTs (double-click / CSRF burst) must never double-spawn. (mirrors approveDesign)
    if (autoRun.decompositionApproval?.status === "approved" || autoRun.decompositionApproval?.status === "approving") {
      return { ok: true, alreadyApproved: true, childIssues: autoRun.childIssues ?? [] };
    }
    if (autoRun.status !== "plan_proposed") throw new Error("Only a proposed plan can be approved.");
    const by = actor?.userId ?? "usr_local";
    const specs = autoRun.decompositionPlan?.tree?.issues ?? [];
    if (!specs.length) throw new Error("The proposed plan has no child issues to create.");
    const failures = issueTreeApplyFailures(autoRun.decompositionPlan.tree, `approved by ${by}`);
    if (failures.length) throw new Error(`The plan is not safe to spawn:\n${failures.map((f) => `- ${f}`).join("\n")}`);
    if (autoRun.link?.type !== "issue" || !Number.isFinite(autoRun.link?.number)) throw new Error("The epic has no linked issue to spawn children from.");
    const worktree = state.worktrees.find((item) => item.id === autoRun.worktreeId) ?? null;
    const repoPath = worktree?.repoPath ?? null;
    if (!repoPath) throw new Error("The epic run's repository is unavailable.");
    if (typeof createDecompositionChild !== "function") throw new Error("Child-issue creation is not available on this server.");
    autoRun.decompositionApproval = { status: "approving", by, at: now() }; // claim before the awaits
    // Carry forward children a PRIOR (partial) approve already created, and skip
    // their specs — a retry never double-creates the same child. (review F1/F2:
    // partial/total failure must stay recoverable, and a crash-then-reapprove must
    // not duplicate issues on GitHub.)
    const already = new Set((autoRun.childIssues ?? []).map((c) => c.title));
    const created = [...(autoRun.childIssues ?? [])];
    const errors = [];
    for (const spec of specs) {
      if (already.has(spec.title)) continue;
      try {
        const child = await createDecompositionChild({ repoPath, title: spec.title, body: decompositionChildBody({ parentLink: autoRun.link, spec }) });
        if (child && Number.isFinite(child.number)) { created.push({ number: child.number, url: child.url ?? null, title: spec.title }); already.add(spec.title); }
        else errors.push(`${spec.title}: no issue number returned`);
      } catch (error) {
        errors.push(`${spec.title}: ${String(error?.message ?? error).slice(0, 200)}`);
      }
    }
    autoRun.childIssues = created;
    // Only a FULLY-created plan settles as `decomposed`. On any failure the run
    // stays `plan_proposed` with a retryable `partial` approval so a re-approve
    // creates the rest — the idempotency guard above lets `partial` through.
    const complete = errors.length === 0 && created.length === specs.length;
    if (complete) {
      autoRun.decompositionApproval = { status: "approved", by, at: now(), created: created.length, errors: [] };
      setAutoRunStatus(autoRun, "decomposed", { error: null });
    } else {
      autoRun.decompositionApproval = { status: "partial", by, at: now(), created: created.length, errors };
      setAutoRunStatus(autoRun, "plan_proposed", { error: `${errors.length} of ${specs.length} child issue(s) failed to create — approve again to retry the rest.` });
    }
    maybePostIssueReport(autoRun, worktree, [
      `Decomposition approved by ${by} — created ${created.length}/${specs.length} child issue(s):`,
      ...created.map((c) => `- #${c.number} ${c.title}`),
      ...(errors.length ? ["", "Failed to create (approve again to retry):", ...errors.map((e) => `- ${e}`)] : []),
      "",
      "Label a child `auto` to start it (or run it manually) — children are never implemented automatically.",
    ].join("\n"));
    appendEvent({
      invocationId: autoRun.invocationId,
      type: complete ? "auto_run_decomposition_approved" : "auto_run_decomposition_partial",
      level: complete ? "info" : "warn",
      message: `Auto-run ${autoRun.id} decomposition approved by ${by}: ${created.length}/${specs.length} child issue(s) created${errors.length ? `, ${errors.length} failed` : ""}.`,
      data: { autoRunId: autoRun.id, childIssues: created, errors },
    });
    persistStateSoon();
    return { ok: true, childIssues: created, errors, complete };
  }

  async function rejectDecomposition(autoRunId, { actor, feedback } = {}) {
    const autoRun = state.autoRuns.find((item) => item.id === autoRunId);
    if (!autoRun) throw new Error("Auto-run not found.");
    if ((autoRun.decision?.path ?? null) !== "decompose") throw new Error("Only a decomposition run's plan can be rejected.");
    if (autoRun.status !== "plan_proposed") throw new Error("Only a proposed plan can be rejected.");
    const by = actor?.userId ?? "usr_local";
    const note = String(feedback ?? "").trim().slice(0, 2000);
    autoRun.decompositionApproval = { status: "rejected", by, at: now(), feedback: note || null };
    const worktree = state.worktrees.find((item) => item.id === autoRun.worktreeId) ?? null;
    maybePostIssueReport(autoRun, worktree, `Decomposition plan not approved by ${by}.${note ? `\n\nRequested changes:\n${note}` : ""}`);
    refuse({
      subject: { kind: "invocation", id: autoRun.invocationId },
      requester: { kind: "automation", id: autoRun.id },
      category: "human",
      code: "deliverable_rejected",
      decidedBy: { kind: "user", id: by },
      summary: `Auto-run ${autoRun.id} decomposition rejected by ${by}.`,
      evidence: { autoRunId: autoRun.id, feedback: note || null },
      remedy: note || "Revise the decomposition plan to address the reviewer's requested changes and re-propose.",
      retryAfter: null,
      appealTo: "device_owner",
      event: {
        invocationId: autoRun.invocationId,
        type: "auto_run_decomposition_rejected",
        level: "info",
        message: `Auto-run ${autoRun.id} decomposition rejected by ${by}.`,
        data: { autoRunId: autoRun.id, feedback: note || null },
      },
    });
    persistStateSoon();
    return { ok: true };
  }

  // Risk-based merge (opt-in, default off): auto-merge low-risk PRs on the same
  // periodic tick as the reaper. STRICT bar — a PR is auto-merged only when the
  // standard signals are green (computeMergeRisk === "low") AND the AI diff
  // review passed AND the diff is under the size cap. No review configured =>
  // review "missing" => never auto-merges (falls to the human merge dialog).
  // Respects the kill switch + circuit breaker; every auto-merge is audited +
  // alerted. Merge itself still goes through mergeAutoRunPr (re-fetches checks).
  // E3 (decision-path expansion): a human answers a clarify run's questions. The
  // answers are posted back to the issue (so a re-triggered run has the context)
  // and recorded; the human then re-labels the issue `auto` (or starts it) to
  // proceed with the answers in the issue body. Human-only, audited.
  async function answerClarify(autoRunId, { actor, answers } = {}) {
    const autoRun = state.autoRuns.find((item) => item.id === autoRunId);
    if (!autoRun) throw new Error("Auto-run not found.");
    if ((autoRun.decision?.path ?? null) !== "clarify") throw new Error("Only a clarify run's questions can be answered.");
    if (autoRun.status !== "needs_input") throw new Error("Only a run awaiting input can be answered.");
    const text = String(answers ?? "").trim();
    if (!text) throw new Error("An answer is required.");
    const by = actor?.userId ?? "usr_local";
    const worktree = state.worktrees.find((item) => item.id === autoRun.worktreeId) ?? null;
    const questions = autoRun.decision?.clarifyingQuestions ?? [];
    const body = [
      `Clarifications from ${by}:`,
      "",
      ...(questions.length ? questions.map((q, i) => `> ${q}`) : []),
      questions.length ? "" : null,
      text,
    ].filter((l) => l !== null).join("\n");
    maybePostIssueReport(autoRun, worktree, body);
    autoRun.clarifyAnswer = { by, at: now(), text: text.slice(0, 4000) };
    appendEvent({
      invocationId: autoRun.invocationId,
      type: "auto_run_clarify_answered",
      level: "info",
      message: `Auto-run ${autoRun.id} clarify questions answered by ${by}.`,
      data: { autoRunId: autoRun.id, issue: autoRun.link?.number ?? null },
    });
    persistStateSoon();
    return { ok: true };
  }

  const breakerOpen = () => {
    const b = state.autoRunBreaker;
    return Boolean(b?.openUntil && Date.parse(b.openUntil) > Date.parse(now()));
  };

  async function autoMergeSweep() {
    const settings = state.autoRunSettings ?? {};
    if (!settings.autoMergeLowRisk) return { merged: [], evaluated: 0 };
    if (settings.autonomyKillSwitch) return { merged: [], evaluated: 0, halted: "kill-switch" };
    if (breakerOpen()) return { merged: [], evaluated: 0, halted: "breaker-open" };
    const maxDiffLines = Number(settings.autoMergeMaxDiffLines) || 400;
    const open = (state.autoRuns ?? []).filter(
      (r) => r.status === "pr_open" && r.prState !== "MERGED" && r.prState !== "CLOSED" && r.prNumber,
    );
    const merged = [];
    for (const autoRun of open) {
      // Re-check the emergency brakes EACH iteration — a sweep can run for minutes
      // (per-PR gh + LLM calls), so an operator flipping the kill switch (or the
      // breaker opening) mid-sweep must stop the rest. (audit finding)
      if ((state.autoRunSettings ?? {}).autonomyKillSwitch || breakerOpen()) break;
      // Budget brake: an over-budget project must not auto-merge OR spend a review
      // call — mirror startAutoRun (budget is per-project, checked in the loop).
      if (typeof budgetStatusFor === "function" && budgetStatusFor(autoRun.projectId)?.over) continue;

      const project = state.projects.find((p) => p.id === autoRun.projectId) ?? null;
      const repoPath = project?.path;
      // Fresh checks — FAIL CLOSED. runPrChecks returns null (not throw) on a gh
      // failure, so only trust the check state when we CONFIRMED it this sweep;
      // otherwise a stale cached SUCCESS could auto-merge a since-red PR. (audit)
      let checksConfirmed = false;
      if (repoPath && typeof fetchPrChecks === "function") {
        try {
          const fresh = await fetchPrChecks({ prNumber: autoRun.prNumber, repoPath });
          if (fresh) {
            autoRun.prChecks = fresh;
            autoRun.prStateCheckedAt = now();
            checksConfirmed = true;
          }
        } catch {
          /* unconfirmed */
        }
      }
      if (!checksConfirmed) continue; // could not confirm checks → never auto-merge
      // Standard signals must be green before we spend a review call.
      if (computeMergeRisk(autoRun).level !== "low") continue;
      // Invalidate a cached review/diff when the PR head moved since the verdict
      // was taken — the guard is only as fresh as the diff it reviewed. (audit)
      let headSha = null;
      if (typeof worktreeHeadSha === "function") {
        try { headSha = await worktreeHeadSha(autoRun.worktreeId); } catch { headSha = null; }
      }
      if (headSha && autoRun.reviewedHeadSha && headSha !== autoRun.reviewedHeadSha) {
        autoRun.review = undefined;
        autoRun.diffFiles = undefined;
        autoRun.diffLines = undefined;
      }
      // AI diff review + diff size + changed files (the strict bar), lazily.
      if (typeof reviewDiff === "function" && !autoRun.review) {
        try {
          const r = await reviewDiff({ autoRun });
          if (r) {
            if (r.review) autoRun.review = r.review;
            if (Number.isFinite(r.diffLines)) autoRun.diffLines = r.diffLines;
            if (Array.isArray(r.files)) autoRun.diffFiles = r.files;
            autoRun.reviewedHeadSha = headSha;
          }
        } catch {
          /* review best-effort; a missing review keeps it out of "low" below */
        }
      }
      const sensitivePaths = Array.isArray(settings.autoMergeSensitivePaths) && settings.autoMergeSensitivePaths.length
        ? settings.autoMergeSensitivePaths
        : DEFAULT_SENSITIVE_PATHS;
      const extra = {
        review: autoRun.review ?? { status: "missing" },
        diffTooLarge: Number.isFinite(autoRun.diffLines) && autoRun.diffLines > maxDiffLines,
        sensitivePath: sensitivePathHit(autoRun.diffFiles ?? [], sensitivePaths),
      };
      if (computeMergeRisk(autoRun, { extra }).level !== "low") continue;
      try {
        await mergeAutoRunPr(autoRun.id, { actor: { userId: "usr_autorun_automerge" } });
        merged.push(autoRun.id);
        appendEvent({
          invocationId: autoRun.invocationId,
          type: "auto_run_auto_merged",
          level: "info",
          message: `Auto-run ${autoRun.id} PR #${autoRun.prNumber} AUTO-merged (low risk).`,
          data: { autoRunId: autoRun.id, prNumber: autoRun.prNumber, diffLines: autoRun.diffLines ?? null, link: autoRun.link },
        });
        void sendAlert?.({
          kind: "auto_merged",
          severity: "medium",
          message: `Auto-run ${autoRun.id} PR #${autoRun.prNumber} auto-merged (low risk).`,
          data: { autoRunId: autoRun.id, prNumber: autoRun.prNumber, link: autoRun.link },
        });
      } catch {
        /* merge refused (checks flipped, conflict, gate) → leave for a human */
      }
    }
    if (merged.length) persistStateSoon();
    return { merged, evaluated: open.length };
  }

  // O1 reliability: reap runs stuck in an active state so nothing lingers
  // forever (leaking its worktree, showing as active). Runs on boot (crash
  // reconcile) and on a periodic tick. awaiting_approval is NEVER reaped — it
  // legitimately waits for a human indefinitely.
  const REAPABLE = new Set(["materializing", "running", "verifying", "publishing"]);
  const REAP_MARGIN_MS = 5 * 60 * 1000; // grace past the agent's own timeout
  const DEFAULT_MAX_IDLE_MS = 30 * 60 * 1000; // floor for states with no agent timeout

  async function reapStuckAutoRuns({ maxIdleMs = DEFAULT_MAX_IDLE_MS } = {}) {
    const nowMs = Date.parse(now());
    let reaped = 0;
    let readvanced = 0;
    for (const run of [...(state.autoRuns ?? [])]) {
      if (!REAPABLE.has(run.status)) continue;
      const inv = run.invocationId && typeof findInvocation === "function" ? findInvocation(run.invocationId) : null;
      // Crash between completion and reaction: the invocation is terminal but the
      // run is still active — re-drive the normal reaction so no work is lost.
      if (inv && isTerminal(inv.status)) {
        try {
          await advanceAutoRunForInvocation(inv);
          readvanced += 1;
        } catch {
          /* leave it; the stuck-deadline check will catch a truly wedged run */
        }
        continue;
      }
      // Orphaned by a restart: the invocation record is gone.
      if (run.invocationId && !inv) {
        setAutoRunStatus(run, "failed", { error: "Run reaped: its invocation no longer exists (server restart)." });
        void sendAlert?.({ kind: "run_reaped", severity: "medium", message: `Auto-run ${run.id} reaped (orphaned invocation).`, data: { autoRunId: run.id, reason: "orphaned", link: run.link } });
        reaped += 1;
        continue;
      }
      // Stuck: no progress past the deadline (agent timeout + margin, or the floor).
      const idleMs = nowMs - Date.parse(run.updatedAt ?? run.createdAt ?? now());
      const agent = run.agentId ? findAgent(run.agentId) : null;
      const deadlineMs = Math.max(maxIdleMs, Number(agent?.adapter?.timeoutSeconds ?? 0) * 1000 + REAP_MARGIN_MS);
      if (Number.isFinite(idleMs) && idleMs > deadlineMs) {
        setAutoRunStatus(run, "failed", { error: `Run reaped: no progress for ${Math.round(idleMs / 1000)}s (stuck).` });
        void sendAlert?.({ kind: "run_reaped", severity: "medium", message: `Auto-run ${run.id} reaped (stuck ${Math.round(idleMs / 1000)}s).`, data: { autoRunId: run.id, reason: "stuck", idleSeconds: Math.round(idleMs / 1000), link: run.link } });
        reaped += 1;
      }
    }
    if (reaped > 0) persistStateSoon();
    return { reaped, readvanced };
  }

  return { startAutoRun, advanceAutoRunForInvocation, syncAutoRunOnApproval, syncAutoRunOnDenial, retryAutoRun, cancelAutoRun, mergeAutoRunPr, maybeDeployAfterMerge, reapStuckAutoRuns, autoMergeSweep, approveDesign, rejectDesign, answerClarify, approveDecomposition, rejectDecomposition };
}
