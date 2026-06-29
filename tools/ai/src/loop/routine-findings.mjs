import { arrayOr, safePathSegment } from "./routine-utils.mjs";

export function generateRoutineFindings({ routine, inputSnapshot, checksResult, skillSnapshot }) {
  if (routine.metadata.id !== "morning-triage") {
    return bindSkillsToFindings(genericRoutineFindings({ inputSnapshot, checksResult }), skillSnapshot);
  }
  return bindSkillsToFindings(morningTriageFindings({ inputSnapshot, checksResult }), skillSnapshot);
}

export function skillBindings(skillSnapshot) {
  return arrayOr(skillSnapshot?.skills, [])
    .filter((skill) => skill.status === "found")
    .map((skill) => ({
      id: skill.id,
      path: skill.path,
      title: skill.title,
      summary: skill.summary,
      sha256: skill.sha256,
      acceptance: arrayOr(skill.acceptance, []),
      checks: arrayOr(skill.checks, []),
    }));
}

function bindSkillsToFindings(findings, skillSnapshot) {
  const bindings = skillBindings(skillSnapshot);
  if (bindings.length === 0) return findings;
  return findings.map((finding) => ({
    ...finding,
    skillBindings: bindings,
    evidence: [
      ...arrayOr(finding.evidence, []),
      ...bindings.map((skill) => `Skill: ${skill.id} ${skill.title} (${skill.sha256.slice(0, 12)})`),
    ],
  }));
}

function genericRoutineFindings({ inputSnapshot, checksResult }) {
  return [
    ...inputFailureFindings(inputSnapshot),
    ...checkFailureFindings(checksResult),
  ];
}

function morningTriageFindings({ inputSnapshot, checksResult }) {
  const findings = [
    ...inputFailureFindings(inputSnapshot),
    ...checkFailureFindings(checksResult),
  ];
  const registryInputs = inputSnapshot.inputs.filter((input) => input.type === "loop.registry" && input.status === "ok");
  for (const input of registryInputs) {
    for (const run of input.items) {
      if (!["failed", "timed_out", "awaiting_human"].includes(run.state)) continue;
      findings.push(loopRunFinding(input, run));
    }
  }
  for (const input of inputSnapshot.inputs.filter((item) => item.type === "github.issues" && item.status === "ok")) {
    for (const issue of input.items) {
      findings.push(...githubIssueFindings(input, issue));
    }
  }
  for (const input of inputSnapshot.inputs.filter((item) => item.type === "github.prs" && item.status === "ok")) {
    for (const pr of input.items) {
      findings.push(...githubPullRequestFindings(input, pr));
    }
  }
  for (const input of inputSnapshot.inputs.filter((item) => item.type === "github.checks" && item.status === "ok")) {
    for (const check of input.items) {
      const finding = githubCheckFinding(input, check);
      if (finding) findings.push(finding);
    }
  }
  return findings;
}

function inputFailureFindings(inputSnapshot) {
  const findings = [];
  for (const input of inputSnapshot.inputs) {
    if (!["failed", "unsupported"].includes(input.status)) continue;
    findings.push(createRoutineFinding({
      id: `input-${safePathSegment(input.id)}-${input.status}`,
      title: `Routine input ${input.id} is ${input.status}`,
      severity: input.status === "failed" ? "high" : "low",
      source: {
        type: "routine.input",
        inputId: input.id,
        inputType: input.type,
      },
      evidence: [
        `Input: ${input.id}`,
        `Type: ${input.type}`,
        `Status: ${input.status}`,
        `Reason: ${input.reason ?? "not recorded"}`,
      ],
      proposedAction: input.status === "failed"
        ? "Fix the input collector or routine input configuration before relying on this routine."
        : "Implement this input collector in a future slice or remove it from this routine.",
      suggestedRun: null,
    }));
  }
  return findings;
}

function checkFailureFindings(checksResult) {
  return checksResult.checks
    .filter((check) => check.status === "failed")
    .map((check) => createRoutineFinding({
      id: `check-${safePathSegment(check.id)}-failed`,
      title: `Routine check failed: ${check.id}`,
      severity: check.required ? "high" : "medium",
      source: {
        type: "routine.check",
        checkId: check.id,
        checkType: check.type,
      },
      evidence: [
        `Check: ${check.id}`,
        `Command: ${check.command ?? "not resolved"}`,
        `Exit code: ${check.exitCode ?? "not recorded"}`,
        `Error: ${check.error ?? "none"}`,
      ],
      proposedAction: "Inspect checks-result.json, fix the failing check, then rerun the routine.",
      suggestedRun: null,
    }));
}

function loopRunFinding(input, run) {
  const severity = run.state === "awaiting_human" ? "medium" : "high";
  const titleByState = {
    failed: `Loop run failed: ${run.runId}`,
    timed_out: `Loop run timed out: ${run.runId}`,
    awaiting_human: `Loop run is awaiting human review: ${run.runId}`,
  };
  const actionByState = {
    failed: "Inspect the last error, then run loop-resume or loop-retry with an explicit operator decision.",
    timed_out: "Inspect the worker lease history, then re-enqueue or retry the run if the work is still relevant.",
    awaiting_human: "Review the active human gate and approve, reject, cancel, or retry the run.",
  };
  const modeByState = {
    failed: "retry",
    timed_out: "retry",
    awaiting_human: "human-gate-review",
  };
  return createRoutineFinding({
    id: `loop-run-${run.state}-${safePathSegment(run.runId)}`,
    title: titleByState[run.state],
    severity,
    source: {
      type: "loop.registry",
      inputId: input.id,
      runId: run.runId,
      state: run.state,
    },
    evidence: [
      `Run: ${run.runId}`,
      `State: ${run.state}`,
      `Issue: ${run.issue ?? "not recorded"}`,
      `Branch: ${run.branch || "not recorded"}`,
      `Updated: ${run.updatedAt ?? "not recorded"}`,
      `Last error: ${run.lastError ?? "none"}`,
    ],
    proposedAction: actionByState[run.state],
    suggestedRun: {
      mode: modeByState[run.state],
      runId: run.runId,
      issue: run.issue ?? null,
      priority: severity === "high" ? "high" : "normal",
      apply: false,
      verify: true,
      isolateWorktree: true,
    },
  });
}

function githubIssueFindings(input, issue) {
  const findings = [];
  if (!issue.assignees || issue.assignees.length === 0) {
    findings.push(createRoutineFinding({
      id: `github-issue-${issue.number}-missing-assignee`,
      title: `GitHub issue has no assignee: #${issue.number} ${issue.title}`,
      severity: "medium",
      source: {
        type: "github.issues",
        inputId: input.id,
        repo: input.repo ?? null,
        issue: issue.number,
      },
      evidence: githubIssueEvidence(issue),
      proposedAction: "Assign an owner or close the issue if it is no longer actionable.",
      suggestedRun: {
        mode: "issue-triage",
        issue: String(issue.number ?? ""),
        priority: "normal",
        apply: false,
        verify: true,
        isolateWorktree: true,
      },
    }));
  }
  if (!issue.labels || issue.labels.length === 0) {
    findings.push(createRoutineFinding({
      id: `github-issue-${issue.number}-missing-label`,
      title: `GitHub issue has no labels: #${issue.number} ${issue.title}`,
      severity: "low",
      source: {
        type: "github.issues",
        inputId: input.id,
        repo: input.repo ?? null,
        issue: issue.number,
      },
      evidence: githubIssueEvidence(issue),
      proposedAction: "Add area/type/priority labels so routine triage can route the issue.",
      suggestedRun: null,
    }));
  }
  return findings;
}

function githubPullRequestFindings(input, pr) {
  const findings = [];
  if (pr.isDraft) {
    findings.push(createRoutineFinding({
      id: `github-pr-${pr.number}-draft`,
      title: `GitHub PR is still draft: #${pr.number} ${pr.title}`,
      severity: "low",
      source: {
        type: "github.prs",
        inputId: input.id,
        repo: input.repo ?? null,
        pr: pr.number,
      },
      evidence: githubPullRequestEvidence(pr),
      proposedAction: "Confirm whether the PR is intentionally draft or needs owner follow-up.",
      suggestedRun: null,
    }));
  }
  if (!pr.reviewDecision || pr.reviewDecision === "REVIEW_REQUIRED") {
    findings.push(createRoutineFinding({
      id: `github-pr-${pr.number}-review-required`,
      title: `GitHub PR needs review: #${pr.number} ${pr.title}`,
      severity: "medium",
      source: {
        type: "github.prs",
        inputId: input.id,
        repo: input.repo ?? null,
        pr: pr.number,
      },
      evidence: githubPullRequestEvidence(pr),
      proposedAction: "Request or complete review before promotion continues.",
      suggestedRun: {
        mode: "pr-review-follow-up",
        issue: null,
        priority: "normal",
        apply: false,
        verify: true,
        isolateWorktree: true,
      },
    }));
  }
  return findings;
}

function githubCheckFinding(input, check) {
  const conclusion = String(check.conclusion ?? "").toLowerCase();
  const status = String(check.status ?? check.state ?? "").toLowerCase();
  const failed = ["failure", "failed", "cancelled", "timed_out", "action_required"].includes(conclusion) || ["failure", "failed"].includes(status);
  const pending = ["queued", "pending", "in_progress", "requested", "waiting"].includes(status) || (!conclusion && status && status !== "completed" && status !== "success");
  if (!failed && !pending) return null;
  return createRoutineFinding({
    id: `github-check-${safePathSegment(check.name || check.id || "check")}-${failed ? "failed" : "pending"}`,
    title: `GitHub check ${failed ? "failed" : "is pending"}: ${check.name || check.id}`,
    severity: failed ? "high" : "medium",
    source: {
      type: "github.checks",
      inputId: input.id,
      repo: input.repo ?? null,
      check: check.id,
    },
    evidence: [
      `Check: ${check.name || check.id}`,
      `Status: ${check.status || check.state || "not recorded"}`,
      `Conclusion: ${check.conclusion ?? "not recorded"}`,
      `Branch: ${check.headBranch ?? "not recorded"}`,
      `SHA: ${check.headSha ?? "not recorded"}`,
      `URL: ${check.url ?? "not recorded"}`,
    ],
    proposedAction: failed
      ? "Inspect the failing GitHub check and create a focused follow-up run if code changes are needed."
      : "Wait for the check or inspect why it is stuck before continuing promotion.",
    suggestedRun: failed
      ? {
          mode: "fix-failing-check",
          issue: null,
          priority: "high",
          apply: false,
          verify: true,
          isolateWorktree: true,
        }
      : null,
  });
}

function githubIssueEvidence(issue) {
  return [
    `Issue: #${issue.number} ${issue.title}`,
    `State: ${issue.state || "not recorded"}`,
    `Labels: ${(issue.labels ?? []).join(", ") || "none"}`,
    `Assignees: ${(issue.assignees ?? []).join(", ") || "none"}`,
    `Milestone: ${issue.milestone ?? "none"}`,
    `Updated: ${issue.updatedAt ?? "not recorded"}`,
    `URL: ${issue.url ?? "not recorded"}`,
  ];
}

function githubPullRequestEvidence(pr) {
  return [
    `PR: #${pr.number} ${pr.title}`,
    `State: ${pr.state || "not recorded"}`,
    `Draft: ${pr.isDraft ? "yes" : "no"}`,
    `Review decision: ${pr.reviewDecision ?? "not recorded"}`,
    `Head: ${pr.headRefName || "not recorded"}`,
    `Base: ${pr.baseRefName || "not recorded"}`,
    `Updated: ${pr.updatedAt ?? "not recorded"}`,
    `URL: ${pr.url ?? "not recorded"}`,
  ];
}

function createRoutineFinding({ id, title, severity, source, evidence, proposedAction, suggestedRun }) {
  return {
    id,
    title,
    severity,
    source,
    evidence,
    proposedAction,
    suggestedRun,
    createdAt: new Date().toISOString(),
  };
}
