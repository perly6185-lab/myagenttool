import { branchFromIssue } from "@myagenttool/protocol/issue-prompt";
import { issueHasActiveClaim } from "./issue-claims.mjs";
import { resolveStatusWritebackConfig } from "./issue-status.mjs";

// Phase 3: auto-trigger. Periodically scan repo-backed projects for open issues
// carrying an opt-in label and start an auto-run for each new one. Safety model:
// - OFF by default (must be enabled via env).
// - Per-issue opt-in: only issues with the configured label are considered.
// - Dedup: an issue that already has any auto-run (in any state) is never
//   re-triggered, so a merged/blocked issue can't respawn every tick.
// - Bounded: a per-project cap on concurrently-active auto-runs.
// startAutoRun still enforces the local-approval and budget gates, so triggering
// never bypasses them. Merge stays human.

const ACTIVE_STATUSES = new Set(["materializing", "running", "awaiting_approval", "verifying", "publishing"]);

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function resolveAutoTriggerConfig(env = process.env) {
  const flag = env.MYAGENTTOOL_AUTOTRIGGER_ENABLED;
  // #1165 dispatch roles. Deployment shape: several devices each run their OWN
  // server over one shared backlog — symmetric peers race. A single DISPATCHER
  // assigns (writes `assigned/<worker>` labels); WORKERS only pick up their own
  // assignments. Unset role = standalone = today's behavior, byte-identical.
  const role = env.MYAGENTTOOL_AUTOTRIGGER_DISPATCH_ROLE === "dispatcher"
    ? "dispatcher"
    : env.MYAGENTTOOL_AUTOTRIGGER_DISPATCH_ROLE === "worker"
      ? "worker"
      : "standalone";
  const workers = String(env.MYAGENTTOOL_AUTOTRIGGER_WORKERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    enabled: flag === "1" || flag === "true",
    label: env.MYAGENTTOOL_AUTOTRIGGER_LABEL || "auto",
    maxConcurrent: clampInt(env.MYAGENTTOOL_AUTOTRIGGER_MAX_CONCURRENT, 1, 1, 10),
    // Only auto-run issues that carry `## Project Fields`, so the auto-PR they
    // produce can pass pr-governance unattended. On by default; opt out with "0".
    requireProjectFields: env.MYAGENTTOOL_AUTOTRIGGER_REQUIRE_PROJECT_FIELDS !== "0",
    dispatchRole: role,
    // This installation's stable id (label suffix). The scheduler defaults it
    // to the hostname when unset.
    serverId: String(env.MYAGENTTOOL_AUTOTRIGGER_SERVER_ID ?? "").trim() || null,
    // Dispatcher only: who may receive assignments (may include the dispatcher
    // itself — it then works its own assignments like any worker).
    dispatchWorkers: workers,
    // Dispatcher only: open assignments allowed per worker, and how long an
    // assignment may sit with no in-progress signal before it is reassigned.
    dispatchWorkerCap: clampInt(env.MYAGENTTOOL_AUTOTRIGGER_WORKER_CAP, 2, 1, 20),
    dispatchAssignTtlMinutes: clampInt(env.MYAGENTTOOL_AUTOTRIGGER_ASSIGN_TTL_MINUTES, 120, 5, 10_080),
    // #1169: TTL reassignment needs a progress signal to judge staleness by —
    // that signal is the statusWriteback label. Writeback off (the default)
    // means "no signal exists", so TTL reassignment is disabled rather than
    // treating every healthy long run as stale and duplicating it.
    dispatchTtlEnabled: resolveStatusWritebackConfig(env).enabled,
  };
}

/** The assignment label a dispatcher writes and a worker filters on. */
export function assignedLabel(workerId) {
  return `assigned/${workerId}`;
}

function issueLabelNames(issue) {
  return (issue?.labels ?? []).map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean);
}

// The governance gate an auto-PR must satisfy is a linked issue carrying a
// `## Project Fields` block; mirror tools/github's hasProjectFields locally.
export function issueHasProjectFields(body) {
  return /##\s+Project Fields/i.test(body ?? "");
}

// Which label-filtered open issues to auto-run for one project: skip ones that
// already have an auto-run, and stop at the project's concurrency headroom. Pure.
export function selectAutoTriggerCandidates({ issues = [], autoRuns = [], issueClaims = [], projectId, maxConcurrent = 1, requireProjectFields = true, nowIso, assignedTo = null }) {
  const projectRuns = autoRuns.filter((run) => run.projectId === projectId);
  const handled = new Set(projectRuns.map((run) => run.link?.number).filter((n) => Number.isFinite(n)));
  const active = projectRuns.filter((run) => ACTIVE_STATUSES.has(run.status)).length;
  let headroom = Math.max(0, maxConcurrent - active);

  const selected = [];
  for (const issue of issues) {
    if (headroom <= 0) break;
    if (!Number.isFinite(issue?.number)) continue;
    if (issue.state && issue.state !== "open") continue;
    if (handled.has(issue.number)) continue;
    // Skip issues that can't yield a governance-passing PR (no Project Fields).
    if (requireProjectFields && !issueHasProjectFields(issue.body)) continue;
    // #1143: an issue someone actively holds (develop OR review) is theirs —
    // an unattended trigger must not race the human working on it.
    if (issueHasActiveClaim({ issueClaims, projectId, issueNumber: issue.number, nowIso })) continue;
    // #1165 worker role: only work what the dispatcher assigned to THIS server.
    if (assignedTo && !issueLabelNames(issue).includes(assignedLabel(assignedTo))) continue;
    selected.push(issue);
    headroom -= 1;
  }
  return selected;
}

// #1165/#1169: which issues the dispatcher should (re)assign this tick, which
// finished assignments to settle, and which stranded labels to adopt. Pure —
// no gh, no clock reads. Single-writer by design: only the dispatcher runs
// this, so its `assignments` bookkeeping is authoritative.
//
// Lifecycle rules (each closes a reviewed failure mode, see #1169):
// - settle-on-absence: an open record whose issue is no longer in the open
//   labeled listing has FINISHED (closed / label removed) — settle it, or its
//   phantom load fills every worker's cap and dispatch starves forever.
// - progress hands-off: `status/in-progress` AND `status/review` both mean a
//   worker/human is on it; TTL reassignment additionally requires the
//   statusWriteback signal to EXIST (`ttlEnabled`) — without it a healthy long
//   run would be "stale" by definition and get duplicated onto a second server.
// - claims gate: an issue someone actively holds locally (#1143) is theirs;
//   dispatching it would churn TTL cycles against a human.
// - label adoption: an `assigned/<w>` label for one of OUR workers with no
//   record is OUR stranded write (crash before persist) — adopt it so TTL and
//   load apply. Labels naming unknown ids stay respected as foreign.
// - a stale assignment never returns to its own worker (an add+remove of the
//   same label in one edit is at best churn); it waits until another has room.
export function planDispatch({
  issues = [],
  assignments = [],
  issueClaims = [],
  projectId,
  workers = [],
  workerCap = 2,
  requireProjectFields = true,
  ttlMinutes = 120,
  ttlEnabled = true,
  nowIso,
}) {
  const assign = [];
  const reassign = [];
  const settle = [];
  const adopt = [];
  if (!workers.length) return { assign, reassign, settle, adopt };
  const nowMs = Date.parse(nowIso ?? new Date().toISOString());
  const open = (assignments ?? []).filter((a) => a?.projectId === projectId && a.status === "open");
  const openByIssue = new Map(open.map((a) => [a.issueNumber, a]));
  const load = new Map(workers.map((w) => [w, 0]));
  for (const a of open) if (load.has(a.workerId)) load.set(a.workerId, (load.get(a.workerId) ?? 0) + 1);

  // Settle-on-absence: the listing is the dispatcher's whole view; an open
  // record with no matching open issue is finished work. Free its load NOW so
  // this same tick can assign into the freed slots.
  const openIssueNumbers = new Set(issues.filter((i) => !i.state || i.state === "open").map((i) => i.number));
  for (const record of open) {
    if (openIssueNumbers.has(record.issueNumber)) continue;
    settle.push({ record });
    openByIssue.delete(record.issueNumber);
    if (load.has(record.workerId)) load.set(record.workerId, Math.max(0, (load.get(record.workerId) ?? 1) - 1));
  }

  const pickWorker = (exclude) => {
    let best = null;
    for (const w of workers) {
      if (w === exclude) continue;
      if ((load.get(w) ?? 0) >= workerCap) continue;
      if (best === null || (load.get(w) ?? 0) < (load.get(best) ?? 0)) best = w;
    }
    return best;
  };

  for (const issue of issues) {
    if (!Number.isFinite(issue?.number)) continue;
    if (issue.state && issue.state !== "open") continue;
    if (requireProjectFields && !issueHasProjectFields(issue.body)) continue;
    const labels = issueLabelNames(issue);
    // In-progress OR review = someone is on it (review deliberately removes
    // in-progress, so checking only the latter re-opened the TTL hole).
    if (labels.includes("status/in-progress") || labels.includes("status/review")) continue;
    // #1143 claims: an actively held issue is a person's — never dispatch it.
    if (issueHasActiveClaim({ issueClaims, projectId, issueNumber: issue.number, nowIso })) continue;
    const assignedLabels = labels.filter((l) => l.startsWith("assigned/"));
    let record = openByIssue.get(issue.number) ?? null;

    // Adopt OUR stranded label (crash between label write and persist): a
    // record dated now, so load counts it and TTL eventually applies.
    if (!record && assignedLabels.length) {
      const ownLabel = assignedLabels.map((l) => l.slice("assigned/".length)).find((w) => workers.includes(w));
      if (ownLabel) {
        record = { projectId, issueNumber: issue.number, workerId: ownLabel, status: "open", assignedAt: nowIso ?? new Date(nowMs).toISOString(), adopted: true };
        adopt.push({ issue, record });
        openByIssue.set(issue.number, record);
        if (load.has(ownLabel)) load.set(ownLabel, (load.get(ownLabel) ?? 0) + 1);
      }
    }

    if (assignedLabels.length || record) {
      if (ttlEnabled && record && nowMs - Date.parse(record.assignedAt) > ttlMinutes * 60_000) {
        const next = pickWorker(record.workerId);
        if (next) {
          reassign.push({ issue, from: record.workerId, to: next, record });
          load.set(next, (load.get(next) ?? 0) + 1);
          if (load.has(record.workerId)) load.set(record.workerId, Math.max(0, (load.get(record.workerId) ?? 1) - 1));
        }
      }
      continue;
    }

    const worker = pickWorker(null);
    if (worker === null) continue; // every worker at cap — next tick
    assign.push({ issue, workerId: worker });
    load.set(worker, (load.get(worker) ?? 0) + 1);
  }
  return { assign, reassign, settle, adopt };
}

// Runtime around the pure selectors. `listLabeledIssues(project, label)`,
// `startAutoRun`, and (dispatcher only) `editIssueLabels` are injected so a
// scan is fully testable without gh or a server.
export function createAutoTriggerRuntime({ state, config, listLabeledIssues, startAutoRun, editIssueLabels, appendEvent, persistStateSoon, log }) {
  function readyProjects() {
    const readyProjectIds = new Set((state.projectTargets ?? []).filter((t) => t.state === "ready").map((t) => t.projectId));
    return (state.projects ?? []).filter((p) => p.source !== "worktree" && readyProjectIds.has(p.id));
  }

  function recordAssignment(project, issue, workerId, nowIso, { adopted = false } = {}) {
    const row = {
      id: `dsp_${project.id}_${issue.number}_${Date.parse(nowIso)}`,
      projectId: project.id,
      issueNumber: issue.number,
      workerId,
      status: "open",
      adopted,
      assignedAt: nowIso,
      expiredAt: null,
    };
    (state.dispatchAssignments ??= []).unshift(row);
    // Bounded: open records are the working set, settled tail for evidence.
    if (state.dispatchAssignments.length > 500) {
      const openRows = state.dispatchAssignments.filter((r) => r.status === "open");
      const settled = state.dispatchAssignments.filter((r) => r.status !== "open").slice(0, 300);
      state.dispatchAssignments = [...openRows, ...settled];
    }
    return row;
  }

  // #1165 dispatcher tick: plan against the shared backlog, then apply — write
  // the `assigned/<worker>` label (the cross-server signal) and the local
  // bookkeeping record (the staleness clock). Label write FIRST: if it fails
  // we record nothing and the issue is retried next tick; a record without a
  // label would silently park the issue forever.
  async function dispatchProject(project, issues, nowIso) {
    const plan = planDispatch({
      issues,
      assignments: state.dispatchAssignments ?? [],
      issueClaims: state.issueClaims ?? [],
      projectId: project.id,
      workers: config.dispatchWorkers,
      workerCap: config.dispatchWorkerCap,
      requireProjectFields: config.requireProjectFields,
      ttlMinutes: config.dispatchAssignTtlMinutes,
      // #1169: TTL without a progress signal duplicates healthy long runs.
      ttlEnabled: config.dispatchTtlEnabled !== false,
      nowIso,
    });
    let mutated = 0;
    // Settle-on-absence (#1169): finished issues free their load. No gh write —
    // the issue is gone from the listing; only the bookkeeping settles.
    for (const { record } of plan.settle) {
      record.status = "completed";
      record.completedAt = nowIso;
      appendEvent?.({
        invocationId: null,
        type: "auto_trigger_assignment_completed",
        level: "info",
        message: `Assignment of issue #${record.issueNumber} to ${record.workerId} settled (issue closed or left the pool).`,
        data: { projectId: project.id, issueNumber: record.issueNumber, workerId: record.workerId },
      });
      mutated += 1;
    }
    // Adoption (#1169): our own stranded labels (crash before persist) become
    // records again, so TTL and the load map see them. No gh write needed.
    for (const { issue, record } of plan.adopt) {
      recordAssignment(project, issue, record.workerId, nowIso, { adopted: true });
      appendEvent?.({
        invocationId: null,
        type: "auto_trigger_assignment_adopted",
        level: "warn",
        message: `Adopted stranded assignment label for issue #${issue.number} (${record.workerId}) — likely a crash before the bookkeeping persisted.`,
        data: { projectId: project.id, issueNumber: issue.number, workerId: record.workerId },
      });
      mutated += 1;
    }
    let assigned = 0;
    for (const { issue, workerId } of plan.assign) {
      try {
        await editIssueLabels(project, { issueNumber: issue.number, add: [assignedLabel(workerId)], remove: [] });
        recordAssignment(project, issue, workerId, nowIso);
        appendEvent?.({
          invocationId: null,
          type: "auto_trigger_assigned",
          level: "info",
          message: `Dispatcher assigned issue #${issue.number} to ${workerId}.`,
          data: { projectId: project.id, issueNumber: issue.number, workerId },
        });
        assigned += 1;
      } catch (error) {
        log?.(`auto-trigger[dispatch]: assign #${issue.number} → ${workerId} failed: ${error?.message ?? error}`);
      }
    }
    for (const { issue, from, to, record } of plan.reassign) {
      try {
        await editIssueLabels(project, { issueNumber: issue.number, add: [assignedLabel(to)], remove: [assignedLabel(from)] });
        record.status = "expired";
        record.expiredAt = nowIso;
        recordAssignment(project, issue, to, nowIso);
        appendEvent?.({
          invocationId: null,
          type: "auto_trigger_reassigned",
          level: "warn",
          message: `Dispatcher reassigned stale issue #${issue.number}: ${from} → ${to} (no progress within ${config.dispatchAssignTtlMinutes}m).`,
          data: { projectId: project.id, issueNumber: issue.number, from, to },
        });
        assigned += 1;
      } catch (error) {
        log?.(`auto-trigger[dispatch]: reassign #${issue.number} ${from}→${to} failed: ${error?.message ?? error}`);
      }
    }
    // One durable flush for the whole tick's bookkeeping (#1169) — the
    // per-record flush bought nothing (debounce fired between awaits anyway).
    if (mutated + assigned > 0) persistStateSoon?.();
    return assigned;
  }

  async function scanOnce() {
    if (!config.enabled) return { enabled: false, scanned: 0, started: 0, assigned: 0 };
    const role = config.dispatchRole ?? "standalone";
    // A worker only ever works its own assignments; a dispatcher whose id is in
    // the worker list works its own assignments too. Standalone = no filter.
    const assignedTo =
      role === "worker"
        ? config.serverId
        : role === "dispatcher" && config.dispatchWorkers?.includes(config.serverId)
          ? config.serverId
          : null;
    const dispatching = role === "dispatcher" && typeof editIssueLabels === "function";

    let scanned = 0;
    let started = 0;
    let assigned = 0;
    for (const project of readyProjects()) {
      scanned += 1;
      let issues = [];
      try {
        issues = await listLabeledIssues(project, config.label);
      } catch (error) {
        log?.(`auto-trigger: issue list failed for ${project.id}: ${error?.message ?? error}`);
        continue;
      }
      const nowIso = new Date().toISOString();
      if (dispatching) {
        assigned += await dispatchProject(project, issues, nowIso);
      }
      // The dispatcher role without a self-assignment never starts work itself.
      if (role === "dispatcher" && assignedTo === null) continue;
      const candidates = selectAutoTriggerCandidates({
        issues,
        autoRuns: state.autoRuns ?? [],
        issueClaims: state.issueClaims ?? [],
        projectId: project.id,
        maxConcurrent: config.maxConcurrent,
        requireProjectFields: config.requireProjectFields,
        nowIso,
        assignedTo,
      });
      for (const issue of candidates) {
        try {
          await startAutoRun({
            projectId: project.id,
            // Respect the project's configured agent: without this, every
            // triggered run fell to defaultAgent() — the demo echo agent, which
            // never edits code. (Found by the field pilot.)
            agentId: project.defaultAgentId ?? undefined,
            link: { type: "issue", number: issue.number, title: issue.title, url: issue.url ?? null, state: "open" },
            name: branchFromIssue({ number: issue.number, title: issue.title }),
            actor: { userId: "usr_local" },
          });
          started += 1;
        } catch (error) {
          log?.(`auto-trigger: #${issue.number} skipped: ${error?.message ?? error}`);
        }
      }
    }
    return { enabled: true, scanned, started, assigned };
  }

  return { scanOnce };
}
