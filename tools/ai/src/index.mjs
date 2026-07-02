#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  LOOP_ENQUEUEABLE_STATES,
  LOOP_EVENT_TYPES,
  LOOP_HUMAN_GATE_STATES,
  LOOP_RESUMABLE_STATES,
  LOOP_RUN_STATES,
  appendLoopEvent,
  applyLoopHumanGate,
  createLoopHumanGate,
  createLoopRegistryEntry,
  findLoopRegistryEntry,
  loopRegistryLockPath,
  loopRunPath,
  readLoopRegistry,
  readOptionalJson,
  requireLoopRegistryEntry,
  safeIsDirectory,
  updateLoopEvidence,
  updateLoopRun,
  upsertLoopRegistryEntry,
} from "./loop/registry.mjs";
import { runStructuredAgent as runStructuredAgentWithProvider } from "./providers/structured.mjs";
import {
  PM_BRIEF_SCHEMA,
  REVIEW_SCHEMA,
} from "./legacy/config.mjs";
import { HELP } from "./legacy/help.mjs";
import {
  formatCodePlan,
  formatCodingAdapterContract,
  formatIssueBody,
  formatIssueTree,
  formatPmBrief,
  formatProductFlow,
  formatReview,
} from "./legacy/formatters.mjs";
import {
  configureFeedbackCommandsContext,
  feedbackConvert,
} from "./legacy/feedback-commands.mjs";
import {
  configureIssueTreeContext,
  humanApprovalRequiredReasons,
  issueTreeApplyFailures,
  issueTreeFromBrief,
  issueTreeWithHumanApproval,
  loadPmBriefForIssueTree,
  validateIssueTreeForApply,
} from "./legacy/issue-tree.mjs";
import { mockStructuredOutput as buildMockStructuredOutput } from "./legacy/mock-provider.mjs";
import {
  buildBranchName,
  inferArea,
  inferPlatform,
  inferRiskFlags,
  sanitizeBranch,
} from "./legacy/pm-helpers.mjs";
import {
  classifyScopeDrift,
  configureScopeTestingCommandsContext,
  inferChangeTypes,
  productFlowPlanGaps,
  scopeCheck,
  testingPlan,
  testingPlanFor,
  uniqueStrings,
} from "./legacy/scope-testing.mjs";
import {
  branchPlan,
  codePlanCommand,
  configurePmCommandsContext,
  createCodePlan,
  intakeBrief,
  issueTree,
  pmBrief,
} from "./legacy/pm-commands.mjs";
import {
  codingAdapterContract,
  configureReviewCommandsContext,
  reviewPullRequest,
  workManifest,
} from "./legacy/review-commands.mjs";
import {
  codingAdapterContractJson,
  configureWorkRunnerContext,
  resolveCodingAdapter,
  runWork,
} from "./legacy/work-runner.mjs";
import {
  evaluateHeldoutSet,
  formatHeldoutReport,
  judgeCase,
  loadHeldoutSet,
  mockResolver,
} from "./evals/heldout.mjs";
import {
  evaluateSubcapSet,
  formatSubcapReport,
  judgeReview,
  loadSubcapSet,
} from "./evals/subcap.mjs";
import { configureLoopWorktreeContext } from "./loop/worktree.mjs";
import { configureLoopPromotionContext } from "./loop/promotion.mjs";
import {
  configureLoopWorktreeCommandsContext,
  loopWorktreeCleanup,
  loopWorktreeDiff,
  loopWorktreeList,
  loopWorktreeReview,
  loopWorktreeShow,
  requireLoopWorktreeEntry,
} from "./commands/worktree.mjs";
import {
  configureLoopRegistryCommandsContext,
  loopCancel,
  loopClaim,
  loopEnqueue,
  loopGateApprove,
  loopGateReject,
  loopGateRequest,
  loopHeartbeat,
  loopList,
  loopRegistryCheck,
  loopRegistryRebuild,
  loopRelease,
  loopResume,
  loopShow,
  loopTimeoutCheck,
} from "./commands/registry.mjs";
import {
  configureLoopWorkerCommandsContext,
  loopWorkerOnce,
} from "./commands/worker.mjs";
import {
  configureLoopPromotionCommandsContext,
  loopWorktreePromote,
  loopWorktreePromotionApply,
  loopWorktreePromotionCommit,
  loopWorktreePromotionPrCreateExecute,
  loopWorktreePromotionPrCreatePrep,
  loopWorktreePromotionPrMergeExecute,
  loopWorktreePromotionPrMergePrep,
  loopWorktreePromotionPrPrep,
  loopWorktreePromotionPushExecute,
  loopWorktreePromotionPushPlan,
  loopWorktreePromotionPushPreflight,
  loopWorktreePromotionVerify,
} from "./commands/promotion.mjs";
import {
  configureLoopRoutineCommandsContext,
  loopRoutineFanoutExecute,
  loopRoutineFanoutPlan,
  loopRoutineFindings,
  loopRoutineCheck,
  loopRoutineIndexRebuild,
  loopRoutineLatest,
  loopRoutineList,
  loopRoutinePlan,
  loopRoutineRun,
  loopRoutineSchedulePlan,
  loopRoutineScheduleRun,
  loopRoutineShow,
} from "./commands/routine.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const __dirname = dirname(scriptPath);
const defaultRepoRoot = resolve(__dirname, "../../..");
const repoRoot = resolve(process.env.MYAGENTTOOL_REPO_ROOT ?? defaultRepoRoot);

configureLoopWorktreeContext({
  repoRoot,
  commandOutput,
  isSubpath,
  readLoopRegistry,
  readOptionalJson,
  safeIsDirectory,
  safePathSegment,
  updateLoopRun,
});

configureLoopPromotionContext({
  repoRoot,
  readOptionalJson,
  safeIsDirectory,
  safePathSegment,
});

configureLoopWorktreeCommandsContext({
  repoRoot,
  fail,
  option,
});

configureLoopRegistryCommandsContext({
  fail,
  option,
});

configureLoopWorkerCommandsContext({
  repoRoot,
  scriptPath,
  fail,
  option,
});

configureLoopPromotionCommandsContext({
  repoRoot,
  fail,
  lines,
  option,
  requireLoopWorktreeEntry,
  uniqueStrings,
});

configureLoopRoutineCommandsContext({
  repoRoot,
  fail,
  option,
});

configureScopeTestingCommandsContext({
  repoRoot,
  commandOutput,
  fail,
  option,
  writeOrPrint,
});

configureIssueTreeContext({
  docsContext,
  fail,
  option,
  readRepoFile,
  runStructuredAgent,
});

configureFeedbackCommandsContext({
  fail,
  option,
  writeOrPrint,
});

configurePmCommandsContext({
  buildBranchName,
  createCodePlan,
  defaultRepo,
  docsContext,
  fail,
  formatCodePlan,
  formatIssueBody,
  formatIssueTree,
  formatPmBrief,
  gh,
  inferArea,
  inferPlatform,
  inferRiskFlags,
  issueTreeFromBrief,
  issueTreeWithHumanApproval,
  loadPmBriefForIssueTree,
  option,
  readIssueContext,
  repoFileList,
  runStructuredAgent,
  truncate,
  validateIssueTreeForApply,
  writeOrPrint,
  writeStructuredResult,
});

configureReviewCommandsContext({
  codingAdapterContractJson,
  commandOutput,
  defaultRepo,
  docsContext,
  fail,
  formatCodingAdapterContract,
  formatReview,
  option,
  readPullRequestContext,
  repoRoot,
  resolveCodingAdapter,
  runGh,
  runStructuredAgent,
  truncate,
  writeOrPrint,
  writeStructuredResult,
});

configureWorkRunnerContext({
  appendLoopEvent,
  applyLoopHumanGate,
  buildBranchName,
  createCodePlan,
  createLoopHumanGate,
  createLoopRegistryEntry,
  defaultRepo,
  ensureCleanWorktree,
  fail,
  formatCodePlan,
  formatProductFlow,
  loopRunPath,
  option,
  repoRoot,
  runCommand,
  runGh,
  sanitizeBranch,
  updateLoopEvidence,
  updateLoopRun,
  upsertLoopRegistryEntry,
});

function main() {
  const args = process.argv.slice(2);
  const command = args.includes("--check") ? "check" : args.find((arg) => !arg.startsWith("--"));

  if (!command || args.includes("--help") || args.includes("-h")) {
    console.log(HELP.trim());
    return;
  }

  if (command === "check") {
    check();
    return;
  }

  if (command === "intake-brief") {
    intakeBrief(args);
    return;
  }

  if (command === "pm-brief" || command === "pm-agent") {
    pmBrief(args).catch(failFromError);
    return;
  }

  if (command === "issue-tree") {
    issueTree(args).catch(failFromError);
    return;
  }

  if (command === "branch-plan") {
    branchPlan(args);
    return;
  }

  if (command === "code-plan" || command === "code-agent") {
    codePlanCommand(args).catch(failFromError);
    return;
  }

  if (command === "scope-check") {
    scopeCheck(args);
    return;
  }

  if (command === "testing-plan") {
    testingPlan(args);
    return;
  }

  if (command === "run-work" || command === "work-runner") {
    runWork(args).catch(failFromError);
    return;
  }

  if (command === "loop-list") {
    loopList(args);
    return;
  }

  if (command === "loop-show") {
    loopShow(args);
    return;
  }

  if (command === "loop-cancel") {
    loopCancel(args);
    return;
  }

  if (command === "loop-resume") {
    loopResume(args);
    return;
  }

  if (command === "loop-retry") {
    loopRetry(args).catch(failFromError);
    return;
  }

  if (command === "loop-gate-request") {
    loopGateRequest(args);
    return;
  }

  if (command === "loop-gate-approve") {
    loopGateApprove(args);
    return;
  }

  if (command === "loop-gate-reject") {
    loopGateReject(args);
    return;
  }

  if (command === "loop-enqueue") {
    loopEnqueue(args);
    return;
  }

  if (command === "loop-claim") {
    loopClaim(args);
    return;
  }

  if (command === "loop-heartbeat") {
    loopHeartbeat(args);
    return;
  }

  if (command === "loop-release") {
    loopRelease(args);
    return;
  }

  if (command === "loop-timeout-check") {
    loopTimeoutCheck(args);
    return;
  }

  if (command === "loop-worker-once") {
    loopWorkerOnce(args);
    return;
  }

  if (command === "loop-worktree-list") {
    loopWorktreeList(args);
    return;
  }

  if (command === "loop-worktree-show") {
    loopWorktreeShow(args);
    return;
  }

  if (command === "loop-worktree-cleanup") {
    loopWorktreeCleanup(args);
    return;
  }

  if (command === "loop-worktree-diff") {
    loopWorktreeDiff(args);
    return;
  }

  if (command === "loop-worktree-review") {
    loopWorktreeReview(args);
    return;
  }

  if (command === "loop-worktree-promote") {
    loopWorktreePromote(args);
    return;
  }

  if (command === "loop-worktree-promotion-apply") {
    loopWorktreePromotionApply(args);
    return;
  }

  if (command === "loop-worktree-promotion-verify") {
    loopWorktreePromotionVerify(args);
    return;
  }

  if (command === "loop-worktree-promotion-pr-prep") {
    loopWorktreePromotionPrPrep(args);
    return;
  }

  if (command === "loop-worktree-promotion-commit") {
    loopWorktreePromotionCommit(args);
    return;
  }

  if (command === "loop-worktree-promotion-push-plan") {
    loopWorktreePromotionPushPlan(args);
    return;
  }

  if (command === "loop-worktree-promotion-push-preflight") {
    loopWorktreePromotionPushPreflight(args);
    return;
  }

  if (command === "loop-worktree-promotion-push-execute") {
    loopWorktreePromotionPushExecute(args);
    return;
  }

  if (command === "loop-worktree-promotion-pr-create-prep") {
    loopWorktreePromotionPrCreatePrep(args);
    return;
  }

  if (command === "loop-worktree-promotion-pr-create-execute") {
    loopWorktreePromotionPrCreateExecute(args);
    return;
  }

  if (command === "loop-worktree-promotion-pr-merge-prep") {
    loopWorktreePromotionPrMergePrep(args);
    return;
  }

  if (command === "loop-worktree-promotion-pr-merge-execute") {
    loopWorktreePromotionPrMergeExecute(args);
    return;
  }

  if (command === "loop-registry-check") {
    loopRegistryCheck(args);
    return;
  }

  if (command === "loop-registry-rebuild") {
    loopRegistryRebuild(args);
    return;
  }

  if (command === "loop-routine-check") {
    loopRoutineCheck(args);
    return;
  }

  if (command === "loop-routine-plan") {
    loopRoutinePlan(args);
    return;
  }

  if (command === "loop-routine-run") {
    loopRoutineRun(args);
    return;
  }

  if (command === "loop-routine-list") {
    loopRoutineList(args);
    return;
  }

  if (command === "loop-routine-latest") {
    loopRoutineLatest(args);
    return;
  }

  if (command === "loop-routine-show") {
    loopRoutineShow(args);
    return;
  }

  if (command === "loop-routine-findings") {
    loopRoutineFindings(args);
    return;
  }

  if (command === "loop-routine-index-rebuild") {
    loopRoutineIndexRebuild(args);
    return;
  }

  if (command === "loop-routine-schedule-plan") {
    loopRoutineSchedulePlan(args);
    return;
  }

  if (command === "loop-routine-schedule-run") {
    loopRoutineScheduleRun(args);
    return;
  }

  if (command === "loop-routine-fanout-plan") {
    loopRoutineFanoutPlan(args);
    return;
  }

  if (command === "loop-routine-fanout-execute") {
    loopRoutineFanoutExecute(args);
    return;
  }

  if (command === "review-pr" || command === "review-agent") {
    reviewPullRequest(args).catch(failFromError);
    return;
  }

  if (command === "work-manifest") {
    workManifest(args);
    return;
  }

  if (command === "coding-adapter-contract") {
    codingAdapterContract(args);
    return;
  }

  if (command === "feedback-convert") {
    feedbackConvert(args);
    return;
  }

  if (command === "eval-heldout") {
    evalHeldout(args).catch(failFromError);
    return;
  }

  if (command === "eval-subcap") {
    evalSubcap(args).catch(failFromError);
    return;
  }

  fail(`Unknown command: ${command}\n\n${HELP}`);
}

function check() {
  const requiredDocs = [
    "docs/engineering/FULL_FLOW_AI_DELIVERY.md",
    "docs/engineering/AI_DEVELOPMENT_WORKFLOW.md",
    "docs/engineering/MODEL_DRIVEN_DELIVERY.md",
    "docs/engineering/LOOP_ENGINE.md",
    "docs/engineering/LOOP_ROUTINES.md",
    "docs/engineering/DEPLOYMENT_PIPELINE.md",
    "docs/design/MYAGENTTOOL_DESIGN.md",
    "docs/design/PRODUCT_FLOWS.md",
    "docs/engineering/VISUAL_QA.md",
    "docs/engineering/L4_HELDOUT_EVAL.md",
    "DESIGN.md",
  ];

  const missing = requiredDocs.filter((path) => !existsSync(resolve(repoRoot, path)));
  if (missing.length > 0) {
    fail(`AI delivery docs missing:\n${missing.map((path) => `  - ${path}`).join("\n")}`);
  }

  const sample = mockStructuredOutput({
    agentName: "pm-brief",
    schema: PM_BRIEF_SCHEMA,
    prompt: "Make AI delivery easier for non-professional users.",
  });
  if (!sample.outcome || sample.acceptanceCriteria.length === 0) {
    fail("Mock AI provider sanity check failed.");
  }

  const issueTree = issueTreeFromBrief(sample);
  if (issueTree.issues.length === 0 || !issueTree.issues[0].labels.some((label) => label.startsWith("acceptance/"))) {
    fail("Issue tree generation sanity check failed.");
  }
  if (humanApprovalRequiredReasons(issueTree).length === 0) {
    fail("Issue tree human approval detection sanity check failed.");
  }
  const unapprovedFailures = issueTreeApplyFailures(issueTree, "");
  if (!unapprovedFailures.some((failure) => failure.includes("human approval"))) {
    fail("Issue tree high-risk approval gate sanity check failed.");
  }
  const approvedIssueTree = issueTreeWithHumanApproval(issueTree, "Approved for local check.");
  validateIssueTreeForApply(approvedIssueTree, "Approved for local check.");
  if (!formatIssueBody(approvedIssueTree.issues[0], undefined).includes("Approved for local check.")) {
    fail("Issue tree approval evidence formatting sanity check failed.");
  }
  const lowRiskIssueTree = issueTreeFromBrief({
    ...sample,
    nonGoals: ["No unrelated refactors."],
    riskFlags: [],
    projectFields: { ...sample.projectFields, risk: "low", area: "docs", sourceDoc: "docs/engineering/AI_DEVELOPMENT_WORKFLOW.md" },
  });
  if (issueTreeApplyFailures(lowRiskIssueTree, "").some((failure) => failure.includes("human approval"))) {
    fail("Issue tree low-risk apply gate sanity check failed.");
  }

  const testingPlan = testingPlanFor({ change: "web", risk: "high" });
  if (
    !testingPlan.requiredEvidence.some((item) => item.includes("Visual QA")) ||
    !testingPlan.requiredEvidence.some((item) => item.includes("Product Flow")) ||
    !testingPlan.commands.includes("pnpm visual:qa:browser") ||
    !testingPlan.commands.includes("pnpm github:check:issues")
  ) {
    fail("Testing skills plan sanity check failed.");
  }
  const mixedTestingPlan = testingPlanFor({ changes: inferChangeTypes(["apps/server/src/index.mjs", "docs/vision/SECURITY.md", "tools/deploy/src/index.mjs"]), risk: "high" });
  if (
    !["server", "security", "release"].every((change) => mixedTestingPlan.changes.includes(change)) ||
    !mixedTestingPlan.requiredEvidence.some((item) => item.includes("Security review")) ||
    !mixedTestingPlan.requiredEvidence.some((item) => item.includes("Release, rollback")) ||
    !mixedTestingPlan.requiredEvidence.some((item) => item.includes("Integration evidence"))
  ) {
    fail("Mixed Testing skills routing sanity check failed.");
  }
  const releaseDocsPlan = testingPlanFor({ changes: inferChangeTypes(["tools/release/src/index.mjs", "docs/engineering/RELEASE_PROCESS.md"]), risk: "medium" });
  if (!["docs", "release"].every((change) => releaseDocsPlan.changes.includes(change))) {
    fail("Release plus docs Testing skills routing sanity check failed.");
  }
  const protocolAdapterPlan = testingPlanFor({ changes: inferChangeTypes(["packages/protocol/src/invocation.ts", "packages/adapters/src/index.ts"]), risk: "medium" });
  if (!["protocol", "adapter"].every((change) => protocolAdapterPlan.changes.includes(change))) {
    fail("Protocol plus adapter Testing skills routing sanity check failed.");
  }
  const docsOnlyPlan = testingPlanFor({ changes: inferChangeTypes(["docs/engineering/TEST_STRATEGY.md"]), risk: "low" });
  if (docsOnlyPlan.changes.length !== 1 || docsOnlyPlan.changes[0] !== "docs" || docsOnlyPlan.commands.includes("pnpm test")) {
    fail("Docs-only Testing skills routing sanity check failed.");
  }

  const docDrift = classifyScopeDrift({ changedFiles: ["docs/engineering/example.md"], undeclaredFiles: ["docs/engineering/example.md"], allowDrift: "" });
  const overriddenDrift = classifyScopeDrift({ changedFiles: ["apps/web/src/App.tsx"], undeclaredFiles: ["apps/web/src/App.tsx"], allowDrift: "linked follow-up approval" });
  if (docDrift !== "low" || overriddenDrift !== "overridden") {
    fail("Scope drift policy sanity check failed.");
  }
  const placeholderFlowPlan = {
    filesToTouch: ["apps/web/public/app.js"],
    productFlow: {
      roleFlow: "Not applicable or requires product-flow triage",
      scenario: "update if this changes UI",
      frequency: "Not applicable",
      ownerSurface: "Not applicable",
      usabilityTask: "Not applicable",
      whatNotToShow: "Internal details",
      partialAcceptanceOrFollowUp: "Product-facing changes must cite docs/design/PRODUCT_FLOWS.md before review",
    },
    affectedSurfaces: ["Not applicable"],
    prototypeStates: [],
    whatNotToShow: ["Not applicable"],
    visualQaTasks: ["Not applicable"],
  };
  if (productFlowPlanGaps(placeholderFlowPlan).length === 0) {
    fail("Product Flow drift sanity check failed.");
  }
  const concreteFlowPlan = mockStructuredOutput({ agentName: "code-plan", prompt: "Issue title:\nImprove Web Console task flow\nExpected branch:\nfeat/issue-1-flow" });
  if (productFlowPlanGaps({
    ...concreteFlowPlan,
    filesToTouch: ["apps/web/public/app.js"],
    affectedSurfaces: ["Home task workspace"],
    visualQaTasks: ["Capture desktop and mobile screenshots for the ordinary developer run-task flow."],
  }).length > 0) {
    fail("Concrete Product Flow plan sanity check failed.");
  }

  if (!existsSync(resolve(repoRoot, "tools/ai/src/coding-wrapper.mjs"))) {
    fail("Trusted coding wrapper missing.");
  }

  if (!LOOP_RUN_STATES.includes("awaiting_human") || !LOOP_EVENT_TYPES.includes("loop_state_changed")) {
    fail("Loop engine vocabulary sanity check failed.");
  }
  if (!LOOP_EVENT_TYPES.includes("loop_retry_requested") || !LOOP_RESUMABLE_STATES.includes("failed")) {
    fail("Loop control vocabulary sanity check failed.");
  }
  if (!LOOP_EVENT_TYPES.includes("loop_human_gate_approved") || !LOOP_HUMAN_GATE_STATES.includes("requested")) {
    fail("Loop human gate vocabulary sanity check failed.");
  }
  if (!LOOP_RUN_STATES.includes("queued") || !LOOP_EVENT_TYPES.includes("loop_claimed") || !LOOP_ENQUEUEABLE_STATES.includes("timed_out")) {
    fail("Loop scheduler vocabulary sanity check failed.");
  }
  if (!LOOP_EVENT_TYPES.includes("loop_worker_started") || !LOOP_EVENT_TYPES.includes("loop_worker_failed")) {
    fail("Loop worker vocabulary sanity check failed.");
  }
  if (!loopRegistryLockPath().endsWith("registry.lock")) {
    fail("Loop registry lock path sanity check failed.");
  }
  const sampleLoopEntry = createLoopRegistryEntry({
    runId: "check-run",
    issue: "0",
    repo: "OWNER/REPO",
    branch: "feat/check-run",
    adapter: { name: "mock" },
    apply: false,
    verify: false,
    openPr: false,
    runDir: resolve(repoRoot, ".myagenttool/runs/check-run"),
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  if (sampleLoopEntry.state !== "created" || !sampleLoopEntry.evidence || sampleLoopEntry.humanGate !== null || sampleLoopEntry.workerId !== null || sampleLoopEntry.queuePriority !== null || sampleLoopEntry.evidence.workerResult !== null || !sampleLoopEntry.eventLog.endsWith("events.jsonl")) {
    fail("Loop registry entry sanity check failed.");
  }

  const heldoutCases = loadHeldoutSet(resolve(repoRoot, "tools/ai/evals/heldout"));
  if (heldoutCases.length < 3) {
    fail("Held-out set sanity check failed: expected at least 3 cases.");
  }
  const heldoutResults = heldoutCases.map((caseObj) => judgeCase(caseObj, mockResolver(caseObj)));
  const heldoutResolved = heldoutResults.filter((result) => result.resolved).length;
  if (heldoutResolved === 0) {
    fail("Held-out set sanity check failed: mock pass rate is 0% (harness or set is broken).");
  }
  if (heldoutResolved === heldoutCases.length) {
    fail("Held-out set sanity check failed: mock pass rate is 100%, so the set no longer tests a real capability gap. Keep at least one intentionally-unsolved case.");
  }

  const subcapCases = loadSubcapSet(resolve(repoRoot, "tools/ai/evals/subcap"));
  const subcapGateCases = subcapCases.filter((caseObj) => caseObj.kind === "issue-gate");
  if (subcapGateCases.length < 3) {
    fail("Sub-capability set sanity check failed: expected at least 3 issue-gate cases.");
  }
  for (const caseObj of subcapGateCases) {
    const verdict = subcapGateVerdict(caseObj);
    if (verdict.blocked !== caseObj.oracle.expectBlocked) {
      fail(`Sub-capability gate sanity check failed: ${caseObj.id} expected ${caseObj.oracle.expectBlocked ? "blocked" : "allowed"} but gate ${verdict.blocked ? "blocked" : "allowed"}.`);
    }
  }

  // Anti-degeneracy guard for the review kind: the mock reviewer finds nothing,
  // so a review case the mock PASSES demands nothing of a real reviewer.
  const subcapReviewCases = subcapCases.filter((caseObj) => caseObj.kind === "review");
  if (subcapReviewCases.length < 2) {
    fail("Sub-capability set sanity check failed: expected at least 2 review cases.");
  }
  for (const caseObj of subcapReviewCases) {
    const mockReview = mockStructuredOutput({ agentName: "review-pr", schema: null, prompt: caseObj.pr.title });
    if (judgeReview(caseObj, mockReview).resolved) {
      fail(`Sub-capability review sanity check failed: ${caseObj.id} passes under the mock reviewer, so its oracle demands nothing.`);
    }
  }

  console.log("[tools-ai:check] AI delivery helpers check OK");
}

async function loopRetry(args) {
  const entry = requireLoopRegistryEntry(args);
  const apply = args.includes("--apply");
  const openPr = args.includes("--open-pr");
  const skipVerify = args.includes("--skip-verify");
  const provider = option(args, "--provider") ?? "mock";
  const retryArgs = ["run-work", "--issue", entry.issue, "--provider", provider, "--coding-adapter", entry.adapter];
  if (entry.repo) retryArgs.push("--repo", entry.repo);
  if (apply) retryArgs.push("--apply");
  if (openPr) retryArgs.push("--open-pr");
  if (skipVerify) retryArgs.push("--skip-verify");

  appendLoopEvent(entry, "loop_retry_requested", entry.state, "Loop retry requested.", { provider, apply, openPr, skipVerify });
  console.log(`Retrying loop run ${entry.runId} with provider ${provider}${apply ? " in apply mode" : " as dry-run"}.`);
  await runWork(retryArgs);
}

async function evalHeldout(args) {
  const setArg = option(args, "--set") ?? "tools/ai/evals/heldout";
  const setDir = resolve(repoRoot, setArg);
  const resolverName = (option(args, "--resolver") ?? "mock").toLowerCase();
  // Validate the threshold BEFORE the run — a real-agent eval is minutes of
  // paid model calls, and a malformed flag must not waste it.
  const minPassRate = parseMinPassRate(args);
  const cases = loadHeldoutSet(setDir);
  const resolver = buildHeldoutResolver(resolverName, args);

  const summary = await evaluateHeldoutSet({ cases, resolver });
  const report = formatHeldoutReport(summary, { setDir: setArg, resolverName });
  const runId = writeEvalEvidence("heldout", summary, report);

  writeOrPrint(args.includes("--json") ? `${JSON.stringify(summary, null, 2)}\n` : report, option(args, "--out"));
  // Status to stderr so --json/--out stdout stays clean for machine parsing.
  console.error(`Held-out pass rate ${(summary.passRate * 100).toFixed(1)}% (${summary.resolved}/${summary.total}). Evidence: .myagenttool/evals/${runId}/`);

  enforceMinPassRate(minPassRate, summary.passRate, "Held-out");
}

async function evalSubcap(args) {
  const setArg = option(args, "--set") ?? "tools/ai/evals/subcap";
  const setDir = resolve(repoRoot, setArg);
  // Same precedence as resolveProvider (flag, then env) so the env-var style
  // that drives every other command is not silently shadowed by a mock default.
  const provider = (option(args, "--provider") ?? process.env.MYAGENTTOOL_AI_PROVIDER ?? "mock").toLowerCase();
  // Validate the threshold BEFORE the run — a real-provider eval is minutes of
  // paid model calls, and a malformed flag must not waste it.
  const minPassRate = parseMinPassRate(args);
  const cases = loadSubcapSet(setDir);

  const providerArgs = option(args, "--provider") ? args : [...args, "--provider", provider];
  const summary = await evaluateSubcapSet({
    cases,
    pmRunner: (caseObj) => runStructuredAgent({
      args: providerArgs,
      agentName: "pm-brief",
      schema: PM_BRIEF_SCHEMA,
      systemPrompt: [
        "You are the PM agent for MyAgentTool, an agent control plane.",
        "Turn the user's idea into a PM brief JSON for a non-professional user path.",
        "Name every applicable risk in riskFlags (security/data, billing/cost, local execution, release/deploy, roadmap).",
        "Set projectFields.risk to high or critical when any of those gated categories applies; low only for genuinely safe changes.",
      ].join("\n"),
      userPrompt: caseObj.idea,
    }),
    gateRunner: subcapGateVerdict,
    briefGateReasons: (brief) => humanApprovalRequiredReasons(issueTreeFromBrief(brief)),
    reviewRunner: (caseObj) => runStructuredAgent({
      args: providerArgs,
      agentName: "review-pr",
      schema: REVIEW_SCHEMA,
      // Same reviewer framing as ai:review (findings-first, correctness and
      // security priority, no approval without evidence) with the case's PR as
      // the only context — a lean eval prompt, documented as such.
      systemPrompt: [
        "You are the MyAgentTool automated PR reviewer.",
        "Use a findings-first code review style.",
        "Prioritize correctness, security, local execution safety, billing/cost impact, data governance, and missing tests.",
        "Do not approve if verification evidence is missing for behavior-changing work.",
        "Return only JSON that matches the schema.",
      ].join("\n"),
      userPrompt: [
        `PR title:\n${caseObj.pr.title}`,
        `PR body:\n${caseObj.pr.body}`,
        `Diff:\n${caseObj.pr.diff}`,
      ].join("\n\n"),
    }),
  });

  const report = formatSubcapReport(summary, { setDir: setArg, provider });
  const runId = writeEvalEvidence("subcap", summary, report);
  writeOrPrint(args.includes("--json") ? `${JSON.stringify(summary, null, 2)}\n` : report, option(args, "--out"));
  console.error(`Sub-capability pass rate ${(summary.passRate * 100).toFixed(1)}% (${summary.resolved}/${summary.total}). Evidence: .myagenttool/evals/${runId}/`);

  const gate = summary.byKind["issue-gate"];
  if (gate && gate.resolved < gate.total) {
    fail(`issue-gate cases must pass 100% (product gate regression): ${gate.resolved}/${gate.total}.`);
  }
  enforceMinPassRate(minPassRate, summary.passRate, "Sub-capability");
}

// One shared verdict for the issue-gate cases, used by both eval-subcap and
// the check() sanity so the two can never drift. Blocked detection matches
// the tree-level failure by its literal prefix — per-issue failures are
// title-interpolated, so a title containing "human approval" cannot forge it.
function subcapGateVerdict(caseObj) {
  const tree = issueTreeFromBrief(caseObj.brief);
  const failures = issueTreeApplyFailures(tree, caseObj.approval);
  return {
    blocked: failures.some((failure) => failure.startsWith("human approval is required")),
    reasons: humanApprovalRequiredReasons(tree),
  };
}

function parseMinPassRate(args) {
  const minRaw = option(args, "--min-pass-rate");
  if (minRaw === undefined) return null;
  const min = Number(minRaw);
  if (!Number.isFinite(min) || min < 0 || min > 1) {
    fail(`--min-pass-rate must be a number between 0 and 1. Got: ${minRaw}`);
  }
  return min;
}

function enforceMinPassRate(min, passRate, label) {
  if (min === null) return;
  if (passRate < min) {
    fail(`${label} pass rate ${(passRate * 100).toFixed(1)}% is below the required ${(min * 100).toFixed(1)}%.`);
  }
}

function writeEvalEvidence(tag, summary, report) {
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${tag}`;
  const evalDir = resolve(repoRoot, ".myagenttool/evals", runId);
  mkdirSync(evalDir, { recursive: true });
  writeFileSync(resolve(evalDir, `${tag}-eval.json`), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeFileSync(resolve(evalDir, `${tag}-eval.md`), report, "utf8");
  return runId;
}

function buildHeldoutResolver(name, args) {
  if (name === "mock") return mockResolver;
  if (name === "command") {
    const raw = option(args, "--resolver-command-json") ?? process.env.MYAGENTTOOL_HELDOUT_RESOLVER_COMMAND_JSON;
    if (!raw) {
      fail("--resolver command requires --resolver-command-json or MYAGENTTOOL_HELDOUT_RESOLVER_COMMAND_JSON.");
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      fail(`Resolver command must be JSON, for example ["node","tools/ai/src/coding-wrapper.mjs"]. Parse error: ${error.message}`);
    }
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== "string" || item.length === 0)) {
      fail('Resolver command JSON must be a non-empty string array, for example ["node","resolver.mjs"].');
    }
    const [cmd, ...cmdArgs] = parsed;
    return (caseObj) => runCommandResolver(cmd, cmdArgs, caseObj);
  }
  fail(`Unsupported resolver: ${name}. Supported resolvers: mock, command.`);
}

function runCommandResolver(cmd, cmdArgs, caseObj) {
  // Bound each case so one hung resolver (interactive prompt, stalled provider)
  // fails that case instead of hanging the whole eval.
  const timeoutMs = Number(process.env.MYAGENTTOOL_HELDOUT_CASE_TIMEOUT_MS ?? 900000);
  const result = spawnSync(cmd, cmdArgs, {
    cwd: repoRoot,
    input: `${JSON.stringify(caseObj)}\n`,
    env: {
      ...process.env,
      MYAGENTTOOL_HELDOUT_CASE: JSON.stringify(caseObj),
      MYAGENTTOOL_HELDOUT_CASE_ID: caseObj.id,
    },
    encoding: "utf8",
    timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 900000,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error?.code === "ETIMEDOUT") {
    throw new Error(`Resolver command timed out after ${timeoutMs}ms (case ${caseObj.id}).`);
  }
  if (result.status !== 0) {
    throw new Error(`Resolver command exited ${result.status ?? "unknown"}: ${(result.stderr ?? "").trim().slice(0, 200)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Resolver command stdout was not JSON with a changedFiles array: ${error.message}`);
  }
  return {
    changedFiles: Array.isArray(parsed.changedFiles) ? parsed.changedFiles.map(String) : [],
    notes: typeof parsed.notes === "string" ? parsed.notes : "command resolver",
    verify: parsed.verify && typeof parsed.verify === "object" ? parsed.verify : null,
  };
}

async function runStructuredAgent({ args, agentName, schema, systemPrompt, userPrompt }) {
  return runStructuredAgentWithProvider({
    args,
    agentName,
    schema,
    systemPrompt,
    userPrompt,
    repoRoot,
    option,
    commandOutput,
    mockStructuredOutput,
  });
}

function mockStructuredOutput(input) {
  return buildMockStructuredOutput({
    ...input,
    buildBranchName,
    inferArea,
    inferPlatform,
    inferRiskFlags,
  });
}

function writeStructuredResult(json, markdown, args) {
  const content = args.includes("--json") ? `${JSON.stringify(json, null, 2)}\n` : markdown;
  writeOrPrint(content, option(args, "--out"));
}

function docsContext(paths) {
  const parts = [];
  for (const path of paths) {
    const target = resolve(repoRoot, path);
    if (!existsSync(target)) continue;
    parts.push(`## ${path}\n${truncate(readFileSync(target, "utf8"), 12000)}`);
  }
  return `Repository context:\n${parts.join("\n\n")}`;
}

function readIssueContext(repo, issue, fallbackTitle) {
  if (!repo) return { title: fallbackTitle, body: "" };
  try {
    const issueJson = ghJson(["issue", "view", issue, "--repo", repo, "--json", "title,body,labels,milestone"]);
    return {
      title: issueJson.title ?? fallbackTitle,
      body: issueJson.body ?? "",
    };
  } catch {
    return { title: fallbackTitle, body: "" };
  }
}

function readPullRequestContext(repo, pr) {
  if (!repo) fail("Missing --repo or GITHUB_REPOSITORY.");
  const info = ghJson(["pr", "view", pr, "--repo", repo, "--json", "title,body"]);
  const diff = gh(["pr", "diff", pr, "--repo", repo]).stdout;
  return {
    title: info.title ?? `PR #${pr}`,
    body: info.body ?? "",
    diff,
  };
}

function repoFileList() {
  try {
    return execFileSync("git", ["ls-files"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, 500)
      .join("\n");
  } catch {
    return "";
  }
}

function normalizePath(path) {
  return path.replace(/\\/g, "/");
}

function safePathSegment(text) {
  return String(text)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "loop-run";
}

function isSubpath(root, target) {
  const normalizedRoot = normalizePath(resolve(root)).toLowerCase().replace(/\/+$/, "");
  const normalizedTarget = normalizePath(resolve(target)).toLowerCase();
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}

function lines(output) {
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function writeOrPrint(content, out) {
  if (!out) {
    console.log(content.trimEnd());
    return;
  }

  const target = resolve(repoRoot, out);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
  console.log(`Wrote ${out}`);
}

function readRepoFile(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function ensureCleanWorktree() {
  const status = commandOutput("git", ["status", "--short"]);
  if (status.trim()) {
    throw new Error("Refusing to apply AI work on a dirty worktree. Commit, stash, or run without --apply.");
  }
}

function runCommand(command, args, { label }) {
  try {
    execFileSync(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
    });
  } catch (error) {
    throw new Error(`${label} failed with exit ${error.status ?? 1}`);
  }
}

function truncate(text, max) {
  if (!text || text.length <= max) return text ?? "";
  return `${text.slice(0, max)}\n\n[truncated ${text.length - max} chars]`;
}

function ghJson(args) {
  return JSON.parse(gh(args).stdout);
}

function gh(args) {
  const ghPath = resolveGhPath();
  const stdout = execFileSync(ghPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { stdout };
}

function runGh(args) {
  execFileSync(resolveGhPath(), args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

function defaultRepo() {
  try {
    return ghJson(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
  } catch {
    return undefined;
  }
}

function resolveGhPath() {
  if (process.env.GH_PATH) return process.env.GH_PATH;
  if (process.platform === "win32") {
    const defaultPath = "C:\\Program Files\\GitHub CLI\\gh.exe";
    if (existsSync(defaultPath)) return defaultPath;
  }
  return "gh";
}

function failFromError(error) {
  fail(error?.stack || error?.message || String(error));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();



