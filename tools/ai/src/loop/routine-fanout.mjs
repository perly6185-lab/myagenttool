import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LOOP_ENQUEUEABLE_STATES,
  appendLoopEvent,
  createLoopRegistryEntry,
  findLoopRegistryEntry,
  loopRunPath,
  normalizeLoopQueuePriority,
  updateLoopEvidence,
  updateLoopRun,
  upsertLoopRegistryEntry,
} from "./registry.mjs";
import {
  formatLoopRoutineFanoutPlan,
  formatLoopRoutineFanoutResult,
} from "./routine-formatters.mjs";
import { skillBindings } from "./routine-findings.mjs";
import {
  appendRoutineRunEvent,
  loadRoutineRun,
  readJsonFile,
  routineRunPath,
} from "./routine-runs.mjs";
import { collectRoutineSkills } from "./routine-skills.mjs";
import {
  arrayOr,
  fail,
  isObject,
  list,
  safePathSegment,
  shortStableId,
  stringOr,
  uniqueStrings,
} from "./routine-utils.mjs";

export function planLoopRoutineFanout({ routineRunId, root, schemaVersion }) {
  const run = loadRoutineRun(routineRunId, root);
  const routine = readJsonFile(resolve(run.runDir, "routine.json"));
  const findings = readJsonFile(resolve(run.runDir, "findings.json"));
  const skillSnapshot = existsSync(resolve(run.runDir, "skill-snapshot.json"))
    ? readJsonFile(resolve(run.runDir, "skill-snapshot.json"))
    : collectRoutineSkills(routine, root);
  const candidates = arrayOr(findings, [])
    .filter((finding) => isObject(finding.suggestedRun))
    .map((finding, index) => fanoutCandidate({ routine, routineRunId, finding, index, skillSnapshot }));
  const plan = {
    schemaVersion,
    routineRunId,
    routineId: routine.metadata?.id ?? run.routineId,
    plannedAt: new Date().toISOString(),
    mode: routine.goal?.fanout?.mode ?? "none",
    enabled: Boolean(routine.goal?.fanout?.enabled),
    approvalRequired: true,
    remoteWrites: routine.safety?.remoteWrites ?? "forbidden",
    githubWrites: routine.safety?.githubWrites ?? "forbidden",
    candidateCount: candidates.length,
    skippedCount: arrayOr(findings, []).length - candidates.length,
    skills: skillSnapshot.skills,
    candidates,
    boundaries: [
      "Fanout plan is local evidence only.",
      "Fanout execute creates planned loop runs by default.",
      "Fanout execute enqueues only with --enqueue or --run-worker.",
      "Fanout worker execution runs only with --run-worker and never pushes, creates PRs, or merges PRs.",
    ],
  };
  writeFileSync(resolve(run.runDir, "fanout-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  writeFileSync(resolve(run.runDir, "fanout-plan.md"), formatLoopRoutineFanoutPlan(plan), "utf8");
  appendRoutineRunEvent(run, "loop_routine_fanout_planned", "Loop routine fanout plan written.", {
    candidateCount: candidates.length,
    skippedCount: plan.skippedCount,
    plan: routineRunPath(routineRunId, "fanout-plan.json"),
  });
  return {
    routineRunId,
    planPath: routineRunPath(routineRunId, "fanout-plan.json"),
    markdownPath: routineRunPath(routineRunId, "fanout-plan.md"),
    plan,
  };
}

export function executeLoopRoutineFanout({
  routineRunId,
  approval,
  enqueue = false,
  runWorker = false,
  workerId = null,
  priority = null,
  timeoutMs = null,
  workerMode = "child-run",
  childProvider = "mock",
  childApply = false,
  isolateWorktree = false,
  baseRef = "HEAD",
  childSkipVerify = false,
  root,
  schemaVersion,
  cliPath,
  planRoutineFanout = planLoopRoutineFanout,
}) {
  if (!String(approval ?? "").trim()) fail("Missing --approval.");
  if (runWorker && !String(workerId ?? "").trim()) fail("Missing --worker when --run-worker is used.");
  if (runWorker && workerMode !== "child-run") fail("Routine fanout worker only supports child-run mode.");
  if (childApply && !isolateWorktree) fail("--child-apply requires --isolate-worktree for routine fanout worker execution.");
  const run = loadRoutineRun(routineRunId, root);
  const planPath = resolve(run.runDir, "fanout-plan.json");
  const plan = existsSync(planPath) ? readJsonFile(planPath) : planRoutineFanout({ routineRunId, root, schemaVersion }).plan;
  if (!plan.enabled) fail(`Routine fanout is disabled for routine run ${routineRunId}.`);

  const previous = existsSync(resolve(run.runDir, "fanout-result.json"))
    ? readJsonFile(resolve(run.runDir, "fanout-result.json"))
    : { createdRuns: [] };
  const existingByFinding = new Map(arrayOr(previous.createdRuns, []).map((item) => [item.findingId, item]));
  const createdRuns = [];
  const skippedRuns = [];
  const allRuns = [];
  for (const candidate of arrayOr(plan.candidates, [])) {
    if (existingByFinding.has(candidate.findingId)) {
      const existing = existingByFinding.get(candidate.findingId);
      skippedRuns.push({ ...existing, reason: "already-created" });
      allRuns.push(existing);
      continue;
    }
    const child = createPlannedLoopRunFromFinding({ candidate, routineRunId, approval, root });
    createdRuns.push(child);
    allRuns.push(child);
  }
  const shouldEnqueue = enqueue || runWorker;
  const enqueuedRuns = shouldEnqueue ? enqueueFanoutRuns({ runs: allRuns, priority: priority ?? plan.priority ?? null, timeoutMs, root }) : [];
  const workerRuns = runWorker
    ? runFanoutWorkers({
        runs: allRuns,
        workerId,
        approval,
        childProvider,
        childApply,
        isolateWorktree,
        baseRef,
        childSkipVerify,
        root,
        cliPath,
      })
    : [];
  const result = {
    schemaVersion,
    routineRunId,
    routineId: plan.routineId,
    executedAt: new Date().toISOString(),
    approval,
    options: {
      enqueue: shouldEnqueue,
      runWorker,
      workerId: workerId ?? null,
      priority: priority ?? null,
      timeoutMs: timeoutMs ?? null,
      workerMode,
      childProvider,
      childApply,
      isolateWorktree,
      baseRef: isolateWorktree ? baseRef : null,
      childSkipVerify,
    },
    createdCount: createdRuns.length,
    skippedCount: skippedRuns.length,
    enqueuedCount: enqueuedRuns.filter((item) => item.status === "enqueued" || item.status === "already-queued").length,
    workerCompletedCount: workerRuns.filter((item) => item.status === "completed").length,
    workerFailedCount: workerRuns.filter((item) => item.status === "failed").length,
    createdRuns: [...arrayOr(previous.createdRuns, []), ...createdRuns],
    skippedRuns,
    enqueuedRuns,
    workerRuns,
    boundaries: plan.boundaries,
  };
  writeFileSync(resolve(run.runDir, "fanout-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(resolve(run.runDir, "fanout-result.md"), formatLoopRoutineFanoutResult(result), "utf8");
  appendRoutineRunEvent(run, "loop_routine_fanout_executed", "Loop routine fanout executed.", {
    createdCount: createdRuns.length,
    skippedCount: skippedRuns.length,
    enqueuedCount: result.enqueuedCount,
    workerCompletedCount: result.workerCompletedCount,
    workerFailedCount: result.workerFailedCount,
    approval,
    result: routineRunPath(routineRunId, "fanout-result.json"),
  });
  return {
    routineRunId,
    resultPath: routineRunPath(routineRunId, "fanout-result.json"),
    markdownPath: routineRunPath(routineRunId, "fanout-result.md"),
    result,
  };
}

function enqueueFanoutRuns({ runs, priority, timeoutMs, root }) {
  const queuePriority = normalizeLoopQueuePriority(priority ?? "normal");
  return arrayOr(runs, []).map((run) => enqueueFanoutRun({ run, priority: queuePriority, timeoutMs, root }));
}

function enqueueFanoutRun({ run, priority, timeoutMs, root }) {
  const entry = findLoopRegistryEntry(run.loopRunId, root);
  if (!entry) return { findingId: run.findingId, loopRunId: run.loopRunId, status: "missing", state: null, error: "Loop run not found." };
  if (entry.state === "queued") return { findingId: run.findingId, loopRunId: run.loopRunId, status: "already-queued", state: entry.state, priority: entry.queuePriority };
  if (!LOOP_ENQUEUEABLE_STATES.includes(entry.state)) {
    return {
      findingId: run.findingId,
      loopRunId: run.loopRunId,
      status: "skipped",
      state: entry.state,
      error: `Cannot enqueue from state ${entry.state}.`,
    };
  }
  const timeoutAt = timeoutMs ? new Date(Date.now() + timeoutMs).toISOString() : null;
  appendLoopEvent(entry, "loop_enqueued", "queued", "Loop run enqueued by routine fanout.", {
    priority,
    timeoutAt,
    timeoutMs: timeoutMs ?? null,
    from: entry.state,
    routineFanout: true,
  });
  const queued = updateLoopRun(entry, {
    state: "queued",
    workerId: null,
    heartbeatAt: null,
    leaseExpiresAt: null,
    timeoutAt,
    queuePriority: priority,
    lastError: null,
  }, "Loop run enqueued by routine fanout.");
  return {
    findingId: run.findingId,
    loopRunId: run.loopRunId,
    status: "enqueued",
    state: queued.state,
    priority,
    timeoutAt,
  };
}

function runFanoutWorkers({ runs, workerId, approval, childProvider, childApply, isolateWorktree, baseRef, childSkipVerify, root, cliPath }) {
  return arrayOr(runs, []).map((run, index) => runFanoutWorker({
    run,
    workerId: `${safePathSegment(workerId)}-${index + 1}`,
    approval,
    childProvider,
    childApply,
    isolateWorktree,
    baseRef,
    childSkipVerify,
    root,
    cliPath,
  }));
}

function runFanoutWorker({ run, workerId, approval, childProvider, childApply, isolateWorktree, baseRef, childSkipVerify, root, cliPath }) {
  const args = [
    cliPath,
    "loop-worker-once",
    "--run",
    run.loopRunId,
    "--worker",
    workerId,
    "--mode",
    "child-run",
    "--child-provider",
    childProvider,
    "--approval",
    approval,
    "--json",
  ];
  if (childApply) args.push("--child-apply");
  if (isolateWorktree) args.push("--isolate-worktree", "--base-ref", baseRef);
  if (childSkipVerify) args.push("--child-skip-verify");
  try {
    const output = execFileSync("node", args, {
      cwd: root,
      env: {
        ...process.env,
        MYAGENTTOOL_REPO_ROOT: root,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(output);
    return {
      findingId: run.findingId,
      loopRunId: run.loopRunId,
      status: parsed.result?.status ?? parsed.run?.state ?? "unknown",
      state: parsed.run?.state ?? null,
      workerId,
      workerResult: parsed.run?.evidence?.workerResult ?? null,
      childRunId: parsed.result?.childRunId ?? null,
      childState: parsed.result?.childState ?? null,
      isolatedWorktree: Boolean(parsed.result?.isolatedWorktree),
      worktreePath: parsed.result?.worktreePath ?? null,
      error: parsed.result?.error ?? null,
    };
  } catch (error) {
    return {
      findingId: run.findingId,
      loopRunId: run.loopRunId,
      status: "failed",
      state: findLoopRegistryEntry(run.loopRunId, root)?.state ?? null,
      workerId,
      workerResult: null,
      childRunId: null,
      childState: null,
      isolatedWorktree,
      worktreePath: null,
      error: childProcessErrorMessage(error),
    };
  }
}

function fanoutCandidate({ routine, routineRunId, finding, index, skillSnapshot }) {
  const suggested = finding.suggestedRun ?? {};
  const findingId = stringOr(finding.id, `finding-${index + 1}`);
  const issue = fanoutIssue(finding, suggested);
  const childRunId = [
    new Date().toISOString().replace(/[:.]/g, "-"),
    "routine",
    safePathSegment(routine.metadata?.id ?? "routine").slice(0, 32),
    String(index + 1),
    safePathSegment(findingId).slice(0, 48),
    shortStableId(`${routineRunId}:${findingId}`),
  ].join("-");
  const priority = stringOr(suggested.priority, routine.goal?.fanout?.priority ?? "normal");
  return {
    findingId,
    title: stringOr(finding.title, findingId),
    severity: stringOr(finding.severity, "medium"),
    source: finding.source ?? null,
    evidence: arrayOr(finding.evidence, []),
    proposedAction: stringOr(finding.proposedAction, ""),
    skillBindings: arrayOr(finding.skillBindings, skillBindings(skillSnapshot)),
    suggestedRun: suggested,
    childRunId,
    issue,
    repo: finding.source?.repo ?? null,
    branch: `loop/fanout/${safePathSegment(findingId).slice(0, 48)}`,
    adapter: "mock",
    priority,
    apply: Boolean(suggested.apply ?? routine.goal?.fanout?.apply ?? false),
    verify: Boolean(suggested.verify ?? routine.goal?.fanout?.verify ?? true),
    openPr: false,
    isolateWorktree: Boolean(suggested.isolateWorktree ?? routine.goal?.fanout?.isolateWorktree ?? true),
  };
}

function createPlannedLoopRunFromFinding({ candidate, routineRunId, approval, root }) {
  const runDir = resolve(root, ".myagenttool/runs", candidate.childRunId);
  mkdirSync(runDir, { recursive: true });
  const createdAt = new Date().toISOString();
  let entry = createLoopRegistryEntry({
    runId: candidate.childRunId,
    issue: candidate.issue,
    repo: candidate.repo,
    branch: candidate.branch,
    adapter: { name: candidate.adapter },
    apply: candidate.apply,
    verify: candidate.verify,
    openPr: candidate.openPr,
    runDir,
    createdAt,
  });
  upsertLoopRegistryEntry(entry);
  appendLoopEvent(entry, "loop_run_created", "created", "Loop run registered from routine fanout.", {
    apply: candidate.apply,
    verify: candidate.verify,
    openPr: candidate.openPr,
    repo: candidate.repo,
    adapter: candidate.adapter,
    branch: candidate.branch,
    routineRunId,
    findingId: candidate.findingId,
  });
  entry = updateLoopRun(entry, { state: "planning" }, "Planning routine fanout child run.");

  const codePlan = fanoutCodePlan(candidate, routineRunId);
  writeFileSync(resolve(runDir, "code-plan.json"), `${JSON.stringify(codePlan, null, 2)}\n`, "utf8");
  entry = updateLoopEvidence(entry, { codePlan: loopRunPath(candidate.childRunId, "code-plan.json") });
  appendLoopEvent(entry, "loop_plan_written", "planning", "Routine fanout code plan written.", { path: entry.evidence.codePlan });

  const context = fanoutWorkContext({ candidate, routineRunId, codePlan, approval });
  writeFileSync(resolve(runDir, "context.json"), `${JSON.stringify(context, null, 2)}\n`, "utf8");

  const testingPlan = fanoutTestingPlan(candidate);
  writeFileSync(resolve(runDir, "testing-plan.json"), `${JSON.stringify(testingPlan, null, 2)}\n`, "utf8");
  writeFileSync(resolve(runDir, "testing-plan.md"), formatFanoutTestingPlan(testingPlan), "utf8");
  entry = updateLoopEvidence(entry, {
    testingPlan: loopRunPath(candidate.childRunId, "testing-plan.md"),
    testingPlanJson: loopRunPath(candidate.childRunId, "testing-plan.json"),
  });
  appendLoopEvent(entry, "loop_testing_plan_written", "planning", "Routine fanout testing plan written.", {
    changes: testingPlan.changes,
    risk: testingPlan.risk,
  });

  writeFileSync(resolve(runDir, "manifest.md"), formatFanoutManifest({ candidate, routineRunId, codePlan, testingPlan }), "utf8");
  entry = updateLoopEvidence(entry, { manifest: loopRunPath(candidate.childRunId, "manifest.md") });
  appendLoopEvent(entry, "loop_manifest_written", "planning", "Routine fanout manifest written.", { path: entry.evidence.manifest });
  entry = updateLoopRun(entry, { state: "planned", lastError: null }, "Loop run planned from routine fanout.");

  return {
    findingId: candidate.findingId,
    loopRunId: candidate.childRunId,
    runDir: loopRunPath(candidate.childRunId, "").replace(/\/$/, ""),
    state: entry.state,
    issue: candidate.issue,
    branch: candidate.branch,
    priority: candidate.priority,
  };
}

function fanoutIssue(finding, suggested) {
  const value = suggested.issue
    ?? finding.source?.issue
    ?? finding.source?.pr
    ?? finding.source?.check
    ?? finding.source?.runId
    ?? "routine";
  return String(value || "routine");
}

function fanoutCodePlan(candidate, routineRunId) {
  return {
    branch: candidate.branch,
    summary: candidate.title,
    productFlow: {
      roleFlow: "Engineering operator reviews a routine finding.",
      scenario: `Routine fanout follow-up for ${candidate.findingId}.`,
      frequency: "As needed after routine triage.",
      ownerSurface: "Loop Engine CLI and registry evidence.",
      usabilityTask: "Inspect the child run manifest and decide whether to enqueue or handle manually.",
      whatNotToShow: "No automatic remote writes or GitHub mutations.",
      partialAcceptanceOrFollowUp: "Child run is planned only; execution is a later operator decision.",
    },
    affectedSurfaces: ["Loop Engine routine fanout"],
    prototypeStates: ["planned child run evidence"],
    acceptanceSignals: [
      "Child run is visible in the loop registry.",
      "Child run records the source routine run and finding id.",
      "No enqueue, apply, push, PR create, or PR merge action is performed.",
      ...fanoutSkillAcceptance(candidate),
    ],
    whatNotToShow: ["Do not apply changes automatically.", "Do not mutate GitHub or remotes."],
    visualQaTasks: [],
    filesToTouch: [],
    steps: [
      candidate.proposedAction || "Review the finding and choose a follow-up action.",
      "Inspect source evidence before enqueueing or executing any work.",
    ],
    commands: ["pnpm ai:loop-registry-check"],
    risks: [`Finding severity: ${candidate.severity}`, `Routine run: ${routineRunId}`, ...fanoutSkillChecks(candidate).map((check) => `Skill check: ${check}`)],
    followUpIssues: [],
    prSummary: "Routine fanout created a planned child run only.",
  };
}

function fanoutWorkContext({ candidate, routineRunId, codePlan, approval }) {
  return {
    issue: candidate.issue,
    repo: candidate.repo,
    branch: candidate.branch,
    runId: candidate.childRunId,
    adapter: { name: candidate.adapter, kind: "internal" },
    plan: codePlan,
    routineFanout: {
      routineRunId,
      findingId: candidate.findingId,
      source: candidate.source,
      evidence: candidate.evidence,
      skillBindings: candidate.skillBindings,
      suggestedRun: candidate.suggestedRun,
      approval,
      isolateWorktree: candidate.isolateWorktree,
    },
  };
}

function fanoutTestingPlan(candidate) {
  const skillChecks = fanoutSkillChecks(candidate);
  return {
    change: "docs",
    changes: ["docs"],
    risk: candidate.severity === "high" ? "high" : "medium",
    requiredEvidence: [
      "Registry can be rebuilt from child run events.",
      "Operator approval is recorded in routine fanout result.",
      ...fanoutSkillAcceptance(candidate),
    ],
    commands: ["pnpm ai:loop-registry-check"],
    manualEvidence: ["Review finding evidence before enqueue or execution.", ...skillChecks],
    skillGuidance: fanoutSkillGuidance(candidate),
  };
}

function formatFanoutTestingPlan(plan) {
  return `# Testing Plan

Change: ${plan.change}
Risk: ${plan.risk}

## Required Evidence

${list(plan.requiredEvidence)}

## Commands

${list(plan.commands)}

## Manual Evidence

${list(plan.manualEvidence)}
`;
}

function formatFanoutManifest({ candidate, routineRunId, codePlan, testingPlan }) {
  return `# Loop Run Manifest

Run: ${candidate.childRunId}
Source routine run: ${routineRunId}
Finding: ${candidate.findingId}
Issue: ${candidate.issue}
Branch: ${candidate.branch}
Adapter: ${candidate.adapter}
Apply: ${candidate.apply ? "yes" : "no"}
Verify: ${candidate.verify ? "yes" : "no"}
Open PR: ${candidate.openPr ? "yes" : "no"}

## Summary

${codePlan.summary}

## Evidence

${list(candidate.evidence)}

## Skill Bindings

${formatFanoutSkillBindings(candidate)}

## Steps

${list(codePlan.steps)}

## Verification

${list(testingPlan.commands)}
`;
}

function fanoutSkillAcceptance(candidate) {
  return uniqueStrings(arrayOr(candidate.skillBindings, []).flatMap((skill) => arrayOr(skill.acceptance, []).map((item) => `${skill.id}: ${item}`)));
}

function fanoutSkillChecks(candidate) {
  return uniqueStrings(arrayOr(candidate.skillBindings, []).flatMap((skill) => arrayOr(skill.checks, []).map((item) => `${skill.id}: ${item}`)));
}

function fanoutSkillGuidance(candidate) {
  const guidance = arrayOr(candidate.skillBindings, []).map((skill) => `${skill.id}: ${skill.title} (${skill.path}, sha256 ${String(skill.sha256 ?? "").slice(0, 12)})`);
  return guidance.length > 0 ? guidance : ["Routine fanout is planning-only unless explicit worker options are passed."];
}

function formatFanoutSkillBindings(candidate) {
  const bindings = arrayOr(candidate.skillBindings, []);
  if (bindings.length === 0) return "- None.";
  return bindings.map((skill) => [
    `- ${skill.id}: ${skill.title} (${skill.path}, sha256 ${String(skill.sha256 ?? "").slice(0, 12)})`,
    ...arrayOr(skill.acceptance, []).map((item) => `  - Acceptance: ${item}`),
    ...arrayOr(skill.checks, []).map((item) => `  - Check: ${item}`),
  ].join("\n")).join("\n");
}

function childProcessErrorMessage(error) {
  const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
  const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
  return [error?.message ?? String(error), stdout, stderr].filter(Boolean).join("\n");
}
