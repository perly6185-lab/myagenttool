export function formatLoopRoutineCheck({ routine, sourcePath, validation }) {
  return `# Loop Routine Check

Routine: ${routine.metadata.id}
Source: ${sourcePath}
OK: ${validation.ok ? "yes" : "no"}

Errors:
${list(validation.errors)}

Warnings:
${list(validation.warnings)}
`;
}

export function formatLoopRoutinePlan(plan) {
  return `# Loop Routine Plan

Routine: ${plan.routineId}
Source: ${plan.sourcePath}
Valid: ${plan.valid ? "yes" : "no"}
Can run now: ${plan.execution.canRunNow ? "yes" : "no"}
Schedule: ${plan.schedule.mode}${plan.schedule.cron ? ` (${plan.schedule.cron})` : ""}

## Inputs

${plan.inputs.map((input) => `- ${input.id}: ${input.type} (${input.supportedInRun ? "implemented" : "planned"}) - ${input.summary}`).join("\n") || "- None."}

## Skills

${plan.skills.map((skill) => `- ${skill.id}: ${skill.path} (${skill.exists ? "found" : "missing"}${skill.required ? ", required" : ""})`).join("\n") || "- None."}

## Checks

${plan.checks.map((check) => `- ${check.id}: ${check.type}${check.command ? ` ${check.command}` : ""} (${check.allowed ? "allowed" : "blocked"})`).join("\n") || "- None."}

## Outputs

- Summary: ${plan.outputs.summary}
- Findings: ${plan.outputs.findings}
- Enqueue findings: ${plan.outputs.enqueueFindings ? "yes" : "no"}

## Safety

- Remote writes: ${plan.safety.remoteWrites}
- GitHub writes: ${plan.safety.githubWrites}
- Approval gates: ${plan.safety.requiresApprovalFor.join(", ") || "none"}

## Risks

${list(plan.risks)}
`;
}

export function formatLoopRoutineRunList(result) {
  return `# Loop Routine Runs

Runs: ${result.routineRunCount}
Routine filter: ${result.filters.routineId ?? "all"}
Status filter: ${result.filters.status ?? "all"}
Limit: ${result.filters.limit}

## Runs

${result.runs.map((run) => `- ${run.routineRunId}: ${run.routineId} ${run.status} findings=${run.findingCount} suggested=${run.suggestedRunCount} started=${run.startedAt ?? "unknown"}`).join("\n") || "- None."}
`;
}

export function formatLoopRoutineLatest(result) {
  if (!result.routineRun) {
    return `# Latest Loop Routine Run

Routine: ${result.routineId}
Run: none
`;
  }
  return `# Latest Loop Routine Run

Routine: ${result.routineId}
Run: ${result.routineRun.routineRunId}
Status: ${result.routineRun.status}
Started: ${result.routineRun.startedAt ?? "unknown"}
Completed: ${result.routineRun.completedAt ?? "unknown"}
Findings: ${result.routineRun.findingCount}
Suggested runs: ${result.routineRun.suggestedRunCount}
`;
}

export function formatLoopRoutineShow(result) {
  return `# Loop Routine Run

Run: ${result.routineRunId}
Routine: ${result.routineId}
Status: ${result.status}
Started: ${result.startedAt ?? "unknown"}
Completed: ${result.completedAt ?? "unknown"}
Run dir: ${result.runDir}

## Summary

- Inputs: ${result.summary.inputCount}
- Skills: ${result.summary.skillCount}
- Checks: ${result.summary.checkCount}
- Failed checks: ${result.summary.failedCheckCount}
- Findings: ${result.summary.findingCount}
- Suggested runs: ${result.summary.suggestedRunCount}
- Fanout candidates: ${result.summary.fanoutCandidateCount ?? "not planned"}
- Fanout created: ${result.summary.fanoutCreatedCount ?? "not executed"}
- Fanout enqueued: ${result.summary.fanoutEnqueuedCount ?? "not executed"}
- Fanout worker completed: ${result.summary.fanoutWorkerCompletedCount ?? "not executed"}

## Evidence

${list(result.evidence)}

## Findings

${result.findings.map((finding) => `- ${finding.id}: ${finding.severity} ${finding.title}${finding.suggestedRun ? " -> suggested-run" : ""}`).join("\n") || "- None."}

## Fanout

- Plan: ${result.fanout.plan ? `${result.fanout.plan.candidateCount} candidates` : "none"}
- Result: ${result.fanout.result ? `${result.fanout.result.createdCount} created, ${result.fanout.result.enqueuedCount ?? 0} enqueued` : "none"}
`;
}

export function formatLoopRoutineFindings(result) {
  return `# Loop Routine Findings

Routine run: ${result.routineRunId}
Findings: ${result.findingCount}
Severity filter: ${result.filters.severity ?? "all"}
Suggested-run filter: ${result.filters.withSuggestedRun ? "yes" : "no"}

## Findings

${result.findings.map((finding) => [
    `- ${finding.id}: ${finding.severity} ${finding.title}`,
    `  Source: ${formatFindingSource(finding.source)}`,
    `  Proposed action: ${finding.proposedAction || "none"}`,
    `  Suggested run: ${finding.suggestedRun ? "yes" : "no"}`,
  ].join("\n")).join("\n") || "- None."}
`;
}

export function formatLoopRoutineFanoutPlan(plan) {
  return `# Loop Routine Fanout Plan

Routine run: ${plan.routineRunId}
Routine: ${plan.routineId}
Enabled: ${plan.enabled ? "yes" : "no"}
Mode: ${plan.mode}
Approval required: ${plan.approvalRequired ? "yes" : "no"}
Candidates: ${plan.candidateCount}
Skipped findings: ${plan.skippedCount}

## Candidates

${arrayOr(plan.candidates, []).map((candidate) => `- ${candidate.findingId}: ${candidate.title} -> ${candidate.childRunId} (${candidate.priority})`).join("\n") || "- None."}

## Boundaries

${list(plan.boundaries)}
`;
}

export function formatLoopRoutineSchedulePlan(plan) {
  return `# Loop Routine Schedule Plan

Planned: ${plan.plannedAt}
Routines: ${plan.routineCount}
Due: ${plan.dueCount}

## Routines

${plan.routines.map((routine) => `- ${routine.routineId ?? "(invalid)"}: ${routine.due ? "due" : "blocked"} (${routine.reason}) ${routine.sourcePath}`).join("\n") || "- None."}

## Boundaries

${list(plan.boundaries ?? [])}
`;
}

export function formatLoopRoutineScheduleRun(result) {
  return `# Loop Routine Schedule Run

Ran: ${result.ranAt}
Dry run: ${result.dryRun ? "yes" : "no"}
Due: ${result.dueCount}
Runs: ${result.runCount}

## Runs

${result.runs.map((run) => `- ${run.routineId}: ${run.status}${run.routineRunId ? ` (${run.routineRunId})` : ""}${run.error ? ` - ${run.error}` : ""}`).join("\n") || "- None."}

## Skipped

${result.skipped.map((run) => `- ${run.routineId ?? "(invalid)"}: ${run.reason}`).join("\n") || "- None."}
`;
}

export function formatLoopRoutineFanoutResult(result) {
  return `# Loop Routine Fanout Result

Routine run: ${result.routineRunId}
Routine: ${result.routineId}
Created: ${result.createdCount}
Skipped: ${result.skippedCount}
Enqueued: ${result.enqueuedCount ?? 0}
Worker completed: ${result.workerCompletedCount ?? 0}
Worker failed: ${result.workerFailedCount ?? 0}
Executed: ${result.executedAt}

## Created Runs

${arrayOr(result.createdRuns, []).map((run) => `- ${run.findingId}: ${run.loopRunId} (${run.runDir})`).join("\n") || "- None."}

## Skipped Runs

${arrayOr(result.skippedRuns, []).map((run) => `- ${run.findingId}: ${run.loopRunId} (${run.reason})`).join("\n") || "- None."}

## Enqueued Runs

${arrayOr(result.enqueuedRuns, []).map((run) => `- ${run.loopRunId}: ${run.status} (${run.state ?? "unknown"})`).join("\n") || "- None."}

## Worker Runs

${arrayOr(result.workerRuns, []).map((run) => `- ${run.loopRunId}: ${run.status}${run.childRunId ? ` child=${run.childRunId}` : ""}${run.error ? ` error=${run.error}` : ""}`).join("\n") || "- None."}

## Boundaries

${list(result.boundaries ?? [])}
`;
}

function formatFindingSource(source) {
  if (!isObject(source)) return "unknown";
  const parts = [
    source.type,
    source.runId,
    source.repo,
    source.issue ? `issue=${source.issue}` : null,
    source.pr ? `pr=${source.pr}` : null,
    source.check ? `check=${source.check}` : null,
  ].filter(Boolean);
  return parts.join(" ");
}

function list(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None.";
}

function arrayOr(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
