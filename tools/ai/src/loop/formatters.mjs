import { assessChanges, classifyKind, renderImpactMarkdown } from "../impact.mjs";

function list(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None.";
}

// Render the Change Impact & Risk Assessment from a promotion's changed-file
// list. Only paths are known here, so change type is reported as "edit"; the
// risk / business-flow judgment is path-based and therefore accurate.
function impactSectionFromFiles(changedFiles) {
  const changes = (changedFiles ?? []).map((path) => ({ path, change: "edit", kind: classifyKind(path) }));
  return renderImpactMarkdown(assessChanges(changes), {
    note: "Auto-generated from the promotion's changed files (ai:impact).",
  });
}

function orderedList(items) {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item}`).join("\n") : "1. TODO";
}
export function formatLoopWorktreeDiff(diff, includePatch) {
  return `# Loop Worktree Diff

Parent run: ${diff.parentRunId}
Child run: ${diff.childRunId ?? "not recorded"}
Base ref: ${diff.baseRef ?? "not recorded"}
Dirty: ${diff.dirty ? "yes" : "no"}
Changed files: ${diff.changedFiles.length}

## Files

${list(diff.changedFiles)}

## Stat

\`\`\`text
${diff.stat || "No diff."}
\`\`\`

${includePatch ? `## Patch\n\n\`\`\`diff\n${diff.patch || ""}\n\`\`\`\n` : ""}
`;
}

export function formatLoopWorktreeReview(review) {
  return `# Loop Worktree Review

Created: ${review.createdAt}
Parent run: ${review.parentRunId}
Parent state: ${review.parentState}
Issue: #${review.issue}
Child run: ${review.childRunId ?? "not recorded"}
Child state: ${review.childState ?? "not recorded"}
Base ref: ${review.baseRef ?? "not recorded"}
Cleanup status: ${review.cleanupStatus}
Path allowed: ${review.pathInBoundary ? "yes" : "no"}
Exists: ${review.exists ? "yes" : "no"}
Dirty: ${review.dirty ? "yes" : "no"}
Patch bytes: ${review.patchBytes}

## Summary

${review.summary}

## Changed Files

${list(review.changedFiles)}

## Diff Stat

\`\`\`text
${review.stat || "No diff."}
\`\`\`

## Dirty Status

\`\`\`text
${review.dirtyStatus || "clean"}
\`\`\`
`;
}

export function formatLoopWorktreePromotionPlan(plan) {
  return `# Loop Worktree Promotion Plan

Created: ${plan.createdAt}
Status: ${plan.status}
Parent run: ${plan.parentRunId}
Child run: ${plan.childRunId ?? "not recorded"}
Base ref: ${plan.baseRef ?? "not recorded"}
Approval: ${plan.approval}
Patch: ${plan.patchPath}
Review: ${plan.reviewPath}

## Summary

${plan.summary}

## Changed Files

${list(plan.changedFiles)}

## Forbidden Actions

${list(plan.forbiddenActions)}

## Next Steps

${orderedList(plan.nextSteps)}
`;
}

export function formatLoopWorktreePromotionApplyResult(result) {
  return `# Loop Worktree Promotion Apply

Created: ${result.createdAt}
Status: ${result.status}
Parent run: ${result.parentRunId}
Child run: ${result.childRunId ?? "not recorded"}
Source base ref: ${result.sourceBaseRef ?? "not recorded"}
Approval: ${result.approval}
Reason: ${result.reason ?? "none"}
Patch: ${result.patchPath}
Promotion plan: ${result.promotionPlanPath}
Integration worktree: ${result.integrationWorktreePath ?? "not created"}
Integration branch: ${result.integrationBranch ?? "not created"}
Parent workspace dirty: ${result.parentDirty ? "yes" : "no"}

## Summary

${result.summary}

## Changed Files

${list(result.changedFiles)}

## Forbidden Actions

${list(result.forbiddenActions)}

## Next Steps

${orderedList(result.nextSteps)}
`;
}

export function formatLoopWorktreePromotionVerifyResult(result) {
  return `# Loop Worktree Promotion Verify

Created: ${result.createdAt}
Status: ${result.status}
Parent run: ${result.parentRunId}
Child run: ${result.childRunId ?? "not recorded"}
Approval: ${result.approval}
Reason: ${result.reason ?? "none"}
Integration worktree: ${result.integrationWorktreePath ?? "not recorded"}
Integration branch: ${result.integrationBranch ?? "not recorded"}
Command id: ${result.commandId}
Command: ${result.command ?? "not allowed"}
Exit code: ${result.exitCode ?? "not run"}
Stdout bytes: ${result.stdoutBytes}
Stderr bytes: ${result.stderrBytes}

## Summary

${result.summary}

## Changed Files

${list(result.changedFiles)}
`;
}

export function formatLoopWorktreePromotionPrBody(result) {
  return `# Promotion PR: Issue #${result.issue ?? "unknown"}

Parent run: ${result.parentRunId}
Child run: ${result.childRunId ?? "not recorded"}
Integration branch: ${result.integrationBranch ?? "not recorded"}
Integration worktree: ${result.integrationWorktreePath ?? "not recorded"}

## Summary

${result.summary}

## Changed Files

${list(result.changedFiles)}

## Diff Stat

\`\`\`text
${result.diffStat || "No diff."}
\`\`\`

## Verification

- Command: ${result.verifyCommand ?? "not recorded"}
- Command id: ${result.verifyCommandId ?? "not recorded"}
- Exit code: ${result.verifyExitCode ?? "not recorded"}
- Status: ${result.verifyStatus ?? "not recorded"}

${impactSectionFromFiles(result.changedFiles)}
## Evidence

- Apply result: ${result.evidenceRefs.promotionApply}
- Verify result: ${result.evidenceRefs.promotionVerify}
- Patch: ${result.evidenceRefs.promotionPatch}
- Review: ${result.evidenceRefs.promotionReview}

## Delivery Boundary

This preparation package did not push, merge, or open a pull request.
`;
}

export function formatLoopWorktreePromotionPrChecklist(result) {
  return `# Promotion PR Checklist

Parent run: ${result.parentRunId}
Integration branch: ${result.integrationBranch ?? "not recorded"}

- [ ] Review changed files: ${result.changedFileCount}
- [ ] Confirm verification succeeded with command \`${result.verifyCommandId ?? "unknown"}\`
- [ ] Inspect stdout and stderr evidence from promotion verification
- [ ] Confirm integration worktree status is expected
- [ ] Confirm no unrelated files are included
- [ ] Push the integration branch only after human approval
- [ ] Open a PR only after human approval
`;
}

export function formatLoopWorktreePromotionCommitResult(result) {
  return `# Loop Worktree Promotion Commit

Created: ${result.createdAt}
Status: ${result.status}
Parent run: ${result.parentRunId}
Child run: ${result.childRunId ?? "not recorded"}
Integration branch: ${result.integrationBranch ?? "not recorded"}
Integration worktree: ${result.integrationWorktreePath ?? "not recorded"}
Commit: ${result.commitSha ?? "not created"}
Reason: ${result.reason ?? "none"}

## Summary

${result.summary}

## Commit Message

\`\`\`text
${result.message ?? "not recorded"}
\`\`\`

## Changed Files

${list(result.changedFiles)}

## Pre-Commit Status

\`\`\`text
${result.preCommitStatus || "clean"}
\`\`\`

## Post-Commit Status

\`\`\`text
${result.postCommitStatus || "clean"}
\`\`\`

## Delivery Boundary

This command did not push, merge, or open a pull request.
`;
}

export function formatLoopWorktreePromotionPushChecklist(result) {
  return `# Promotion Push Checklist

Parent run: ${result.parentRunId}
Integration branch: ${result.integrationBranch ?? "not recorded"}
Commit: ${result.commitSha ?? "not recorded"}
Remote: ${result.remote}
Refspec: ${result.refspec ?? "not recorded"}

- [ ] Review worktree-promotion-push-plan.json
- [ ] Confirm commit SHA matches the integration worktree HEAD
- [ ] Confirm the integration worktree is clean
- [ ] Confirm remote URL is correct: ${result.remoteUrl || "not configured"}
- [ ] Review risk notes: ${result.risks.length}
- [ ] Run the push command only after explicit human approval
- [ ] Open a PR only after the branch is pushed and reviewed
`;
}

export function formatLoopWorktreePromotionPushPlan(result) {
  return `# Loop Worktree Promotion Push Plan

Created: ${result.createdAt}
Status: ${result.status}
Parent run: ${result.parentRunId}
Child run: ${result.childRunId ?? "not recorded"}
Integration branch: ${result.integrationBranch ?? "not recorded"}
Integration worktree: ${result.integrationWorktreePath ?? "not recorded"}
Commit: ${result.commitSha ?? "not recorded"}
HEAD matches commit: ${result.headMatchesCommit ? "yes" : "no"}
Remote: ${result.remote}
Remote URL: ${result.remoteUrl || "not configured"}
Refspec: ${result.refspec ?? "not recorded"}
Reason: ${result.reason ?? "none"}

## Summary

${result.summary}

## Push Command

\`\`\`text
${result.pushCommand ?? "not available"}
\`\`\`

## Risks

${list(result.risks)}

## Changed Files

${list(result.changedFiles)}

## Dirty Status

\`\`\`text
${result.dirtyStatus || "clean"}
\`\`\`

## Delivery Boundary

This command did not push, merge, or open a pull request.
`;
}

export function formatLoopWorktreePromotionPushPreflightResult(result) {
  return `# Loop Worktree Promotion Push Preflight

Created: ${result.createdAt}
Status: ${result.status}
Parent run: ${result.parentRunId}
Child run: ${result.childRunId ?? "not recorded"}
Integration branch: ${result.integrationBranch ?? "not recorded"}
Integration worktree: ${result.integrationWorktreePath ?? "not recorded"}
Commit: ${result.commitSha ?? "not recorded"}
HEAD matches plan: ${result.headMatchesPlan ? "yes" : "no"}
Current branch: ${result.currentBranch ?? "not recorded"}
Branch matches plan: ${result.branchMatchesPlan ? "yes" : "no"}
Remote: ${result.remote ?? "not recorded"}
Remote URL: ${result.remoteUrl || "not configured"}
Refspec: ${result.refspec ?? "not recorded"}
Dry-run: ${result.dryRun ? "yes" : "no"}
Reason: ${result.reason ?? "none"}

## Summary

${result.summary}

## Push Command

\`\`\`text
${result.pushCommand ?? "not available"}
\`\`\`

## Checks

${formatLoopWorktreePromotionPushPreflightChecks(result.checks)}

## Failed Checks

${list(result.failedChecks)}

## Changed Files

${list(result.changedFiles)}

## Dirty Status

\`\`\`text
${result.dirtyStatus || "clean"}
\`\`\`

## Delivery Boundary

This command did not perform a real push, merge, or pull request creation.
`;
}

export function formatLoopWorktreePromotionPushPreflightChecks(checks) {
  if (checks.length === 0) return "- None.";
  return checks.map((check) => `- ${check.id}: exit=${check.exitCode} command=\`${check.command}\``).join("\n");
}

export function formatLoopWorktreePromotionPushExecuteResult(result) {
  return `# Loop Worktree Promotion Push Execute

Created: ${result.createdAt}
Status: ${result.status}
Parent run: ${result.parentRunId}
Child run: ${result.childRunId ?? "not recorded"}
Integration branch: ${result.integrationBranch ?? "not recorded"}
Integration worktree: ${result.integrationWorktreePath ?? "not recorded"}
Commit: ${result.commitSha ?? "not recorded"}
Confirmed commit: ${result.confirmCommit || "not recorded"}
HEAD matches preflight: ${result.headMatchesPreflight ? "yes" : "no"}
Current branch: ${result.currentBranch ?? "not recorded"}
Branch matches preflight: ${result.branchMatchesPreflight ? "yes" : "no"}
Remote: ${result.remote ?? "not recorded"}
Remote URL: ${result.remoteUrl || "not configured"}
Refspec: ${result.refspec ?? "not recorded"}
Preflight dry-run: ${result.preflightDryRun ? "yes" : "no"}
Remote head: ${result.remoteHead ?? "not recorded"}
Remote head matches commit: ${result.remoteHeadMatchesCommit ? "yes" : "no"}
Reason: ${result.reason ?? "none"}

## Summary

${result.summary}

## Push Command

\`\`\`text
${result.pushCommand ?? "not available"}
\`\`\`

## Push Result

Command: ${result.push.command ?? "not run"}
Exit code: ${result.push.exitCode ?? "not run"}
Signal: ${result.push.signal ?? "none"}
Error: ${result.push.error ?? "none"}

### Stdout

\`\`\`text
${result.push.stdout || "empty"}
\`\`\`

### Stderr

\`\`\`text
${result.push.stderr || "empty"}
\`\`\`

## Changed Files

${list(result.changedFiles)}

## Dirty Status

\`\`\`text
${result.dirtyStatus || "clean"}
\`\`\`

## Delivery Boundary

This command only pushed the preflighted branch/refspec. It did not merge or create a pull request.
`;
}

export function formatLoopWorktreePromotionPrCreatePrep(result) {
  return `# Loop Worktree Promotion PR Create Prep

Created: ${result.createdAt}
Status: ${result.status}
Parent run: ${result.parentRunId}
Child run: ${result.childRunId ?? "not recorded"}
Base branch: ${result.baseBranch}
Head branch: ${result.headBranch ?? "not recorded"}
Integration worktree: ${result.integrationWorktreePath ?? "not recorded"}
Commit: ${result.commitSha ?? "not recorded"}
Remote: ${result.remote ?? "not recorded"}
Remote URL: ${result.remoteUrl || "not configured"}
Remote head: ${result.remoteHead ?? "not recorded"}
Remote head matches commit: ${result.remoteHeadMatchesCommit ? "yes" : "no"}
Title: ${result.title}
Reason: ${result.reason ?? "none"}

## Summary

${result.summary}

## Create Command

\`\`\`text
${result.createCommand ?? "not available"}
\`\`\`

## Evidence

- Body: ${result.bodyFile}
- Checklist: ${result.checklistFile}
- Push execute: ${result.evidenceRefs.promotionPushExecute}

## Changed Files

${list(result.changedFiles)}

## Delivery Boundary

This command did not call GitHub and did not create a pull request.
`;
}

export function formatLoopWorktreePromotionPrCreateExecute(result) {
  return `# Loop Worktree Promotion PR Create Execute

Created: ${result.createdAt}
Status: ${result.status}
Parent run: ${result.parentRunId}
Child run: ${result.childRunId ?? "not recorded"}
Base branch: ${result.baseBranch ?? "not recorded"}
Head branch: ${result.headBranch ?? "not recorded"}
Confirmed head: ${result.confirmHead || "not recorded"}
Integration worktree: ${result.integrationWorktreePath ?? "not recorded"}
Commit: ${result.commitSha ?? "not recorded"}
Remote: ${result.remote ?? "not recorded"}
Remote URL: ${result.remoteUrl || "not configured"}
Remote head: ${result.remoteHead ?? "not recorded"}
Remote head matches commit: ${result.remoteHeadMatchesCommit ? "yes" : "no"}
Title: ${result.title ?? "not recorded"}
Reason: ${result.reason ?? "none"}

## Summary

${result.summary}

## Pull Request

- Number: ${result.prNumber ?? "not recorded"}
- URL: ${result.prUrl ?? "not recorded"}
- State: ${result.prState ?? "not recorded"}

## Create Command

\`\`\`text
${result.gh.command ?? "not run"}
\`\`\`

## GH Result

Executable: ${result.gh.executable ?? "not recorded"}
Exit code: ${result.gh.exitCode ?? "not run"}
Signal: ${result.gh.signal ?? "none"}
Error: ${result.gh.error ?? "none"}
Stdout bytes: ${result.gh.stdoutBytes}
Stderr bytes: ${result.gh.stderrBytes}

### Stdout

\`\`\`text
${result.gh.stdout || "empty"}
\`\`\`

### Stderr

\`\`\`text
${result.gh.stderr || "empty"}
\`\`\`

## Changed Files

${list(result.changedFiles)}

## Delivery Boundary

This command may create a pull request. It did not merge.
`;
}

export function formatLoopWorktreePromotionPrMergePrep(result) {
  return `# Loop Worktree Promotion PR Merge Prep

Created: ${result.createdAt}
Status: ${result.status}
Parent run: ${result.parentRunId}
Child run: ${result.childRunId ?? "not recorded"}
PR: ${result.prNumber ?? "not recorded"}
PR URL: ${result.prUrl ?? "not recorded"}
Base branch: ${result.baseBranch ?? "not recorded"}
Head branch: ${result.headBranch ?? "not recorded"}
Confirmed PR: ${result.confirmPr || "not recorded"}
Integration worktree: ${result.integrationWorktreePath ?? "not recorded"}
Commit: ${result.commitSha ?? "not recorded"}
Remote: ${result.remote ?? "not recorded"}
Remote URL: ${result.remoteUrl || "not configured"}
Remote head: ${result.remoteHead ?? "not recorded"}
Remote head matches commit: ${result.remoteHeadMatchesCommit ? "yes" : "no"}
PR state: ${result.prState ?? "not recorded"}
PR draft: ${result.prIsDraft === null ? "not recorded" : result.prIsDraft ? "yes" : "no"}
PR mergeable: ${result.prMergeable ?? "not recorded"}
Reason: ${result.reason ?? "none"}

## Summary

${result.summary}

## Blockers

${list(result.blockers)}

## PR Checks

${formatLoopWorktreePromotionPrChecks(result.checkRuns)}

## Failed Checks

${formatLoopWorktreePromotionPrChecks(result.failedChecks)}

## PR View Command

\`\`\`text
${result.prView.command ?? "not run"}
\`\`\`

Exit code: ${result.prView.exitCode ?? "not run"}
Error: ${result.prView.error ?? "none"}

### PR View Stdout

\`\`\`text
${result.prView.stdout || "empty"}
\`\`\`

### PR View Stderr

\`\`\`text
${result.prView.stderr || "empty"}
\`\`\`

## PR Checks Command

\`\`\`text
${result.checks.command ?? "not run"}
\`\`\`

Exit code: ${result.checks.exitCode ?? "not run"}
Error: ${result.checks.error ?? "none"}

### PR Checks Stdout

\`\`\`text
${result.checks.stdout || "empty"}
\`\`\`

### PR Checks Stderr

\`\`\`text
${result.checks.stderr || "empty"}
\`\`\`

## Changed Files

${list(result.changedFiles)}

## Delivery Boundary

This command performed read-only PR merge preparation checks. It did not merge.
`;
}

export function formatLoopWorktreePromotionPrMergeExecute(result) {
  return `# Loop Worktree Promotion PR Merge Execute

Created: ${result.createdAt}
Status: ${result.status}
Parent run: ${result.parentRunId}
Child run: ${result.childRunId ?? "not recorded"}
PR: ${result.prNumber ?? "not recorded"}
PR URL: ${result.prUrl ?? "not recorded"}
Base branch: ${result.baseBranch ?? "not recorded"}
Head branch: ${result.headBranch ?? "not recorded"}
Confirmed PR: ${result.confirmPr || "not recorded"}
Confirmed commit: ${result.confirmCommit || "not recorded"}
Merge method: ${result.mergeMethod || "not recorded"}
Integration worktree: ${result.integrationWorktreePath ?? "not recorded"}
Commit: ${result.commitSha ?? "not recorded"}
Remote: ${result.remote ?? "not recorded"}
Remote URL: ${result.remoteUrl || "not configured"}
Remote head: ${result.remoteHead ?? "not recorded"}
Remote head matches commit: ${result.remoteHeadMatchesCommit ? "yes" : "no"}
PR state before merge: ${result.prState ?? "not recorded"}
PR draft before merge: ${result.prIsDraft === null ? "not recorded" : result.prIsDraft ? "yes" : "no"}
PR mergeable before merge: ${result.prMergeable ?? "not recorded"}
Reason: ${result.reason ?? "none"}

## Summary

${result.summary}

## Blockers

${list(result.blockers)}

## PR Checks

${formatLoopWorktreePromotionPrChecks(result.checkRuns)}

## Failed Checks

${formatLoopWorktreePromotionPrChecks(result.failedChecks)}

## Merge Command

\`\`\`text
${result.merge.command ?? "not run"}
\`\`\`

Exit code: ${result.merge.exitCode ?? "not run"}
Error: ${result.merge.error ?? "none"}

### Merge Stdout

\`\`\`text
${result.merge.stdout || "empty"}
\`\`\`

### Merge Stderr

\`\`\`text
${result.merge.stderr || "empty"}
\`\`\`

## Final PR View Command

\`\`\`text
${result.prView.command ?? "not run"}
\`\`\`

Exit code: ${result.prView.exitCode ?? "not run"}

## Final PR Checks Command

\`\`\`text
${result.checks.command ?? "not run"}
\`\`\`

Exit code: ${result.checks.exitCode ?? "not run"}

## Changed Files

${list(result.changedFiles)}

## Delivery Boundary

This command may merge the confirmed pull request. It did not delete branches.
`;
}

export function formatLoopWorktreePromotionPrChecks(checks) {
  if (!checks || checks.length === 0) return "- None.";
  return checks.map((check) => `- ${check.name ?? "unnamed"}: ${check.state ?? check.bucket ?? "unknown"}`).join("\n");
}


export function formatLoopWorktreeRecord(record) {
  return `# Loop Worktree ${record.parentRunId}

Parent run: ${record.parentRunId}
Parent state: ${record.parentState}
Issue: #${record.issue}
Child run: ${record.childRunId ?? "not recorded"}
Child state: ${record.childState ?? "not recorded"}
Base ref: ${record.baseRef ?? "not recorded"}
Path: ${record.worktreePath}
Path allowed: ${record.pathInBoundary ? "yes" : "no"}
Exists: ${record.exists ? "yes" : "no"}
Dirty: ${record.dirty ? "yes" : "no"}
Cleanup policy: ${record.cleanupPolicy}
Cleanup status: ${record.cleanupStatus}
Status error: ${record.statusError ?? "none"}

## Dirty Status

${record.dirtyStatus || "clean"}

## Cleanup

${record.cleanup ? JSON.stringify(record.cleanup, null, 2) : "No cleanup recorded."}
`;
}


