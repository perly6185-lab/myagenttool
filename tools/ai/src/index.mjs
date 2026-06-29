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

const HELP = `MyAgentTool AI delivery helpers

Usage:
  node tools/ai/src/index.mjs --check
  node tools/ai/src/index.mjs intake-brief --idea "..." [--out path]
  node tools/ai/src/index.mjs pm-brief|pm-agent --idea "..." --provider openai|command|mock [--out path] [--json]
  node tools/ai/src/index.mjs issue-tree --idea "..." --provider openai|command|mock [--brief-file path] [--repo OWNER/REPO] [--out path] [--apply] [--human-approved "reason"]
  node tools/ai/src/index.mjs branch-plan --issue NUMBER --title "..."
  node tools/ai/src/index.mjs code-plan|code-agent --issue NUMBER [--repo OWNER/REPO] --provider openai|command|mock [--out path] [--json]
  node tools/ai/src/index.mjs scope-check [--plan-file path] [--base REF] [--out path] [--json] [--allow-drift "reason"]
  node tools/ai/src/index.mjs testing-plan [--change docs|web|server|desktop|protocol|security|release|adapter] [--changes docs,security,release] [--risk low|medium|high|critical] [--out path] [--json]
  node tools/ai/src/index.mjs run-work|work-runner --issue NUMBER [--repo OWNER/REPO] --provider openai|command|mock [--apply] [--coding-adapter NAME] [--adapter-command-json JSON] [--verify] [--skip-verify] [--open-pr] [--allow-drift "reason"]
  node tools/ai/src/index.mjs loop-list [--json]
  node tools/ai/src/index.mjs loop-show --run RUN_ID [--json]
  node tools/ai/src/index.mjs loop-cancel --run RUN_ID [--reason "..."] [--force]
  node tools/ai/src/index.mjs loop-resume --run RUN_ID [--reason "..."]
  node tools/ai/src/index.mjs loop-retry --run RUN_ID [--apply] [--open-pr] [--skip-verify]
  node tools/ai/src/index.mjs loop-gate-request --run RUN_ID --reason "..." --scope "..." --requested-action "..." [--risk low|medium|high|critical] [--by NAME] [--expires-at ISO]
  node tools/ai/src/index.mjs loop-gate-approve --run RUN_ID --by NAME [--evidence "..."] [--expires-at ISO]
  node tools/ai/src/index.mjs loop-gate-reject --run RUN_ID --by NAME --reason "..."
  node tools/ai/src/index.mjs loop-enqueue --run RUN_ID [--priority normal|high|low|p0|p1|p2|p3] [--timeout-ms N] [--json]
  node tools/ai/src/index.mjs loop-claim --worker WORKER_ID [--run RUN_ID] [--lease-ms N] [--json]
  node tools/ai/src/index.mjs loop-heartbeat --run RUN_ID --worker WORKER_ID [--lease-ms N] [--json]
  node tools/ai/src/index.mjs loop-release --run RUN_ID --worker WORKER_ID [--to queued|planned] [--reason "..."] [--json]
  node tools/ai/src/index.mjs loop-timeout-check [--json]
  node tools/ai/src/index.mjs loop-worker-once --worker WORKER_ID [--run RUN_ID] [--lease-ms N] [--mode mock|child-run] [--child-provider mock] [--child-apply] [--approval "..."] [--isolate-worktree] [--base-ref REF] [--child-skip-verify] [--fail] [--json]
  node tools/ai/src/index.mjs loop-worktree-list [--json]
  node tools/ai/src/index.mjs loop-worktree-show --run RUN_ID [--json]
  node tools/ai/src/index.mjs loop-worktree-cleanup --run RUN_ID --approval "..." [--json]
  node tools/ai/src/index.mjs loop-worktree-diff --run RUN_ID [--patch] [--json]
  node tools/ai/src/index.mjs loop-worktree-review --run RUN_ID [--json]
  node tools/ai/src/index.mjs loop-worktree-promote --run RUN_ID --approval "..." [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-apply --run RUN_ID --approval "..." [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-verify --run RUN_ID --approval "..." [--command ID] [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-pr-prep --run RUN_ID --approval "..." [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-commit --run RUN_ID --approval "..." [--message "..."] [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-push-plan --run RUN_ID --approval "..." [--remote origin] [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-push-preflight --run RUN_ID --approval "..." [--dry-run] [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-push-execute --run RUN_ID --approval "..." --confirm-commit SHA [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-pr-create-prep --run RUN_ID --approval "..." [--base main] [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-pr-create-execute --run RUN_ID --approval "..." --confirm-head BRANCH [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-pr-merge-prep --run RUN_ID --approval "..." --confirm-pr NUMBER [--allow-no-checks] [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-pr-merge-execute --run RUN_ID --approval "..." --confirm-pr NUMBER --confirm-commit SHA --merge-method squash|merge|rebase [--json]
  node tools/ai/src/index.mjs loop-routine-check --file path [--json]
  node tools/ai/src/index.mjs loop-routine-plan --file path [--json]
  node tools/ai/src/index.mjs loop-routine-run --file path [--dry-run] [--json]
  node tools/ai/src/index.mjs loop-routine-list [--routine ID] [--status completed|failed|running|unknown] [--limit N] [--json]
  node tools/ai/src/index.mjs loop-routine-latest --routine ID [--json]
  node tools/ai/src/index.mjs loop-routine-show --routine-run RUN_ID [--json]
  node tools/ai/src/index.mjs loop-routine-findings --routine-run RUN_ID [--severity low|medium|high] [--with-suggested-run] [--json]
  node tools/ai/src/index.mjs loop-routine-schedule-plan [--no-examples] [--json]
  node tools/ai/src/index.mjs loop-routine-schedule-run [--no-examples] [--dry-run] [--limit N] [--json]
  node tools/ai/src/index.mjs loop-routine-fanout-plan --routine-run RUN_ID [--json]
  node tools/ai/src/index.mjs loop-routine-fanout-execute --routine-run RUN_ID --approval "..." [--enqueue] [--priority normal|high|low|p0|p1|p2|p3] [--timeout-ms N] [--run-worker --worker WORKER_ID --child-provider mock --isolate-worktree] [--child-apply] [--child-skip-verify] [--json]
  node tools/ai/src/index.mjs loop-registry-check [--json]
  node tools/ai/src/index.mjs loop-registry-rebuild [--json]
  node tools/ai/src/index.mjs review-pr|review-agent --pr NUMBER [--repo OWNER/REPO] --provider openai|command|mock [--out path] [--json] [--comment]
  node tools/ai/src/index.mjs work-manifest [--issue NUMBER] [--pr NUMBER] [--out path]
  node tools/ai/src/index.mjs coding-adapter-contract [--adapter NAME] [--out path]
  node tools/ai/src/index.mjs feedback-convert --feedback "..." --target bug|risk|roadmap|documentation [--issue-tree] [--json] [--out path]

Providers:
  openai   Uses OPENAI_API_KEY and the Responses API.
  command  Runs MYAGENTTOOL_AI_COMMAND or --provider-command with a JSON request on stdin.
  mock     Deterministic local provider for tests and demos.

Notes:
  Model-backed commands require a provider. Use --provider mock only for deterministic validation.
  run-work is dry-run by default. It creates branches, runs trusted coding adapters, verifies, or opens PRs only with --apply.
`;

const PM_BRIEF_SCHEMA = {
  name: "myagenttool_pm_brief",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["outcome", "primaryUser", "problem", "userStory", "nonGoals", "acceptanceCriteria", "riskFlags", "projectFields", "openQuestions"],
    properties: {
      outcome: { type: "string" },
      primaryUser: { type: "string" },
      problem: { type: "string" },
      userStory: { type: "string" },
      nonGoals: { type: "array", items: { type: "string" } },
      acceptanceCriteria: { type: "array", items: { type: "string" } },
      riskFlags: { type: "array", items: { type: "string" } },
      projectFields: {
        type: "object",
        additionalProperties: false,
        required: ["milestone", "area", "type", "status", "risk", "acceptance", "platform", "agentTarget", "priority", "sourceDoc"],
        properties: {
          milestone: { type: "string" },
          area: { type: "string" },
          type: { type: "string" },
          status: { type: "string" },
          risk: { type: "string" },
          acceptance: { type: "string" },
          platform: { type: "string" },
          agentTarget: { type: "string" },
          priority: { type: "string" },
          sourceDoc: { type: "string" },
        },
      },
      productFlow: {
        type: "object",
        additionalProperties: false,
        required: ["roleFlow", "scenario", "frequency", "ownerSurface", "usabilityTask", "whatNotToShow", "partialAcceptanceOrFollowUp"],
        properties: {
          roleFlow: { type: "string" },
          scenario: { type: "string" },
          frequency: { type: "string" },
          ownerSurface: { type: "string" },
          usabilityTask: { type: "string" },
          whatNotToShow: { type: "string" },
          partialAcceptanceOrFollowUp: { type: "string" },
        },
      },
      issueTitle: { type: "string" },
      suggestedLabels: { type: "array", items: { type: "string" } },
      openQuestions: { type: "array", items: { type: "string" } },
    },
  },
};

const CODE_PLAN_SCHEMA = {
  name: "myagenttool_code_plan",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "branch",
      "summary",
      "productFlow",
      "affectedSurfaces",
      "prototypeStates",
      "acceptanceSignals",
      "whatNotToShow",
      "visualQaTasks",
      "filesToTouch",
      "steps",
      "commands",
      "risks",
      "followUpIssues",
      "prSummary",
    ],
    properties: {
      branch: { type: "string" },
      summary: { type: "string" },
      productFlow: {
        type: "object",
        additionalProperties: false,
        required: ["roleFlow", "scenario", "frequency", "ownerSurface", "usabilityTask", "whatNotToShow", "partialAcceptanceOrFollowUp"],
        properties: {
          roleFlow: { type: "string" },
          scenario: { type: "string" },
          frequency: { type: "string" },
          ownerSurface: { type: "string" },
          usabilityTask: { type: "string" },
          whatNotToShow: { type: "string" },
          partialAcceptanceOrFollowUp: { type: "string" },
        },
      },
      affectedSurfaces: { type: "array", items: { type: "string" } },
      prototypeStates: { type: "array", items: { type: "string" } },
      acceptanceSignals: { type: "array", items: { type: "string" } },
      whatNotToShow: { type: "array", items: { type: "string" } },
      visualQaTasks: { type: "array", items: { type: "string" } },
      filesToTouch: { type: "array", items: { type: "string" } },
      steps: { type: "array", items: { type: "string" } },
      commands: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } },
      followUpIssues: { type: "array", items: { type: "string" } },
      prSummary: { type: "string" },
    },
  },
};

const REVIEW_SCHEMA = {
  name: "myagenttool_review",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "findings", "verificationGaps", "riskGates", "approve"],
    properties: {
      summary: { type: "string" },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["severity", "file", "line", "title", "rationale", "recommendation"],
          properties: {
            severity: { type: "string" },
            file: { type: "string" },
            line: { type: "integer" },
            title: { type: "string" },
            rationale: { type: "string" },
            recommendation: { type: "string" },
          },
        },
      },
      verificationGaps: { type: "array", items: { type: "string" } },
      riskGates: { type: "array", items: { type: "string" } },
      approve: { type: "boolean" },
    },
  },
};

const CODING_ADAPTER_CONTRACT_VERSION = "2026-06-19";

const CODING_ADAPTERS = {
  mock: {
    name: "mock",
    kind: "internal",
    label: "Mock coding adapter",
    description: "Deterministic local adapter for contract checks and workflow demos.",
    commandEnv: null,
  },
  codex: {
    name: "codex",
    kind: "cli",
    label: "Codex CLI adapter",
    description: "Adapter slot for Codex-style CLI coding agents.",
    commandEnv: "MYAGENTTOOL_CODEX_COMMAND_JSON",
  },
  claude: {
    name: "claude",
    kind: "cli",
    label: "Claude CLI adapter",
    description: "Adapter slot for Claude-style CLI coding agents.",
    commandEnv: "MYAGENTTOOL_CLAUDE_COMMAND_JSON",
  },
  "qwen-code": {
    name: "qwen-code",
    kind: "cli",
    label: "Qwen Code CLI adapter",
    description: "Adapter slot for Qwen Code-style CLI coding agents.",
    commandEnv: "MYAGENTTOOL_QWEN_CODE_COMMAND_JSON",
  },
  openclaw: {
    name: "openclaw",
    kind: "cli",
    label: "OpenClaw-like CLI adapter",
    description: "Adapter slot for OpenClaw-like local coding agents exposed as a command.",
    commandEnv: "MYAGENTTOOL_OPENCLAW_COMMAND_JSON",
  },
  qclaw: {
    name: "qclaw",
    kind: "cli",
    label: "QClaw-like CLI adapter",
    description: "Adapter slot for QClaw-like local coding agents exposed as a command.",
    commandEnv: "MYAGENTTOOL_QCLAW_COMMAND_JSON",
  },
  command: {
    name: "command",
    kind: "cli",
    label: "Generic trusted command adapter",
    description: "Adapter slot for an explicitly configured internal wrapper command.",
    commandEnv: "MYAGENTTOOL_CODING_ADAPTER_COMMAND_JSON",
  },
};

const STANDARD_VERIFICATION_COMMANDS = [
  ["pnpm", ["docs:check"]],
  ["pnpm", ["repo:check"]],
  ["pnpm", ["ai:check"]],
  ["pnpm", ["release:check"]],
  ["pnpm", ["deploy:check"]],
  ["pnpm", ["typecheck"]],
  ["pnpm", ["test"]],
];

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

  console.log("[tools-ai:check] AI delivery helpers check OK");
}

function intakeBrief(args) {
  const idea = option(args, "--idea");
  if (!idea) fail("Missing --idea.");

  const out = option(args, "--out");
  const now = new Date().toISOString();
  const riskFlags = inferRiskFlags(idea);
  const area = inferArea(idea);
  const platform = inferPlatform(idea);

  const brief = `# AI Intake Brief

Created: ${now}

## Raw Idea

${idea}

## Plain-language Outcome

TODO: Restate what the user wants to accomplish without internal terminology.

## Primary User

Non-professional user first. Professional controls should stay secondary unless
this idea is explicitly for operators or developers.

## Suggested Slice

- Milestone: M0 unless this clearly depends on later lifecycle/billing work.
- Area: ${area}
- Platform: ${platform}
- Agent Target: platform
- Risk: ${riskFlags.length > 0 ? "high" : "medium"}

## PM Breakdown

- Problem:
- User story:
- Non-goals:
- Acceptance criteria:
  - [ ] TODO
- UX implications:
- Security/data/cost implications:
- Open questions:

## Risk Flags

${riskFlags.length > 0 ? riskFlags.map((flag) => `- ${flag}`).join("\n") : "- No obvious high-risk keyword detected. Review manually."}

## Next Step

- [ ] Convert this brief into one or more GitHub issues.
- [ ] Link source docs from docs/vision, docs/engineering, or docs/design.
- [ ] Ask for approval before high-risk roadmap, billing, security, release, or local execution changes.
`;

  writeOrPrint(brief, out);
}

async function pmBrief(args) {
  const idea = option(args, "--idea");
  if (!idea) fail("Missing --idea.");

  const result = await runStructuredAgent({
    args,
    agentName: "pm-brief",
    schema: PM_BRIEF_SCHEMA,
    systemPrompt: [
      "You are the MyAgentTool PM agent.",
      "Turn plain-language ideas into milestone-aligned, non-professional-first engineering slices.",
      "Prefer M0 unless the idea clearly requires billing, lifecycle automation, distribution, or later roadmap work.",
      "Do not hide security, data, cost, release, or local execution risk.",
      "For UI, workflow, or user-facing work, include productFlow using docs/design/PRODUCT_FLOWS.md; otherwise mark it Not applicable.",
      "Return only JSON that matches the schema.",
    ].join("\n"),
    userPrompt: [
      `Idea:\n${idea}`,
      docsContext(["docs/vision/PRODUCT.md", "docs/engineering/FULL_FLOW_AI_DELIVERY.md", "docs/design/MYAGENTTOOL_DESIGN.md", "docs/design/PRODUCT_FLOWS.md"]),
    ].join("\n\n"),
  });

  writeStructuredResult(result, formatPmBrief(result), args);
}

async function issueTree(args) {
  const apply = args.includes("--apply");
  const repo = option(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? defaultRepo();
  const brief = await loadPmBriefForIssueTree(args);
  const humanApproval = option(args, "--human-approved") ?? process.env.MYAGENTTOOL_HUMAN_APPROVED ?? "";
  const tree = issueTreeWithHumanApproval(issueTreeFromBrief(brief), humanApproval);
  const out = option(args, "--out");

  if (!apply) {
    const content = args.includes("--json") ? `${JSON.stringify(tree, null, 2)}\n` : formatIssueTree(tree, { applied: false });
    writeOrPrint(content, out);
    return;
  }

  if (!repo) fail("Cannot apply issue tree without --repo or GITHUB_REPOSITORY.");
  validateIssueTreeForApply(tree, humanApproval);

  const created = [];
  for (const issueSpec of tree.issues) {
    const body = formatIssueBody(issueSpec, created[0]?.number);
    const argsForGh = ["issue", "create", "--repo", repo, "--title", issueSpec.title, "--body", body];
    for (const label of issueSpec.labels) argsForGh.push("--label", label);
    if (issueSpec.milestone) argsForGh.push("--milestone", issueSpec.milestone);
    const output = gh(argsForGh).stdout.trim();
    const number = Number(output.match(/\/issues\/(\d+)/)?.[1] ?? 0);
    created.push({ title: issueSpec.title, url: output, number });
  }

  const appliedTree = { ...tree, applied: true, created };
  const content = args.includes("--json") ? `${JSON.stringify(appliedTree, null, 2)}\n` : formatIssueTree(appliedTree, { applied: true });
  writeOrPrint(content, out);
}

function branchPlan(args) {
  const issue = option(args, "--issue");
  const title = option(args, "--title");
  const kind = option(args, "--kind") ?? "feat";
  if (!issue) fail("Missing --issue.");
  if (!title) fail("Missing --title.");

  const branch = buildBranchName(issue, title, kind);
  const plan = `# Branch Plan

## Branch

${branch}

## Commands

\`\`\`text
git fetch origin
git switch main
git pull --ff-only
git switch -c ${branch}
\`\`\`

## PR Linkage

- Source issue: #${issue}
- PR body should include: Closes #${issue}

## Scope Reminder

- Keep changes tied to #${issue}.
- Create follow-up issues for discovered work outside this branch.
- Run repository checks before opening PR.
`;

  writeOrPrint(plan, option(args, "--out"));
}

async function codePlanCommand(args) {
  const plan = await createCodePlan(args);
  writeStructuredResult(plan, formatCodePlan(plan), args);
}

function scopeCheck(args) {
  const planFile = option(args, "--plan-file");
  const plan = planFile ? JSON.parse(readFileSync(resolve(repoRoot, planFile), "utf8")) : undefined;
  const base = option(args, "--base") ?? "HEAD";
  const allowDrift = option(args, "--allow-drift") ?? "";
  const result = buildScopeCheckResult({ plan, planFile: planFile ?? "", base, allowDrift });
  const content = args.includes("--json") ? `${JSON.stringify(result, null, 2)}\n` : formatScopeCheck(result);
  writeOrPrint(content, option(args, "--out"));
  if (!result.allowed) {
    fail("Scope or Product Flow drift is not allowed. Provide concrete Product Flow coverage or reduce the diff.");
  }
}

function testingPlan(args) {
  const change = option(args, "--change") ?? "docs";
  const changes = parseChangeList(option(args, "--changes"));
  const risk = option(args, "--risk") ?? "medium";
  const plan = testingPlanFor({ change, changes, risk });
  const content = args.includes("--json") ? `${JSON.stringify(plan, null, 2)}\n` : formatTestingPlan(plan);
  writeOrPrint(content, option(args, "--out"));
}

async function runWork(args) {
  const issue = option(args, "--issue");
  if (!issue) fail("Missing --issue.");

  const apply = args.includes("--apply");
  const openPr = args.includes("--open-pr");
  const verify = apply && !args.includes("--skip-verify");
  const repo = option(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? defaultRepo();
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-issue-${issue}`;
  const runDir = resolve(repoRoot, ".myagenttool/runs", runId);
  const contextFile = resolve(runDir, "context.json");
  const adapter = resolveCodingAdapter(args);
  mkdirSync(runDir, { recursive: true });
  const createdAt = new Date().toISOString();
  let entry = createLoopRegistryEntry({
    runId,
    issue,
    repo,
    branch: "",
    adapter,
    apply,
    verify,
    openPr,
    runDir,
    createdAt,
  });
  upsertLoopRegistryEntry(entry);
  appendLoopEvent(entry, "loop_run_created", "created", "Loop run registered.", { apply, verify, openPr, repo, adapter: adapter.name, branch: "" });

  try {
    entry = updateLoopRun(entry, { state: "planning" }, "Planning issue work.");
    const plan = await createCodePlan(args);
    const branch = sanitizeBranch(plan.branch || buildBranchName(issue, `issue-${issue}`, "feat"));
    entry = updateLoopRun(entry, { branch });

    writeFileSync(resolve(runDir, "code-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    entry = updateLoopEvidence(entry, { codePlan: loopRunPath(runId, "code-plan.json") });
    appendLoopEvent(entry, "loop_plan_written", "planning", "Code plan written.", { path: entry.evidence.codePlan });

    writeFileSync(contextFile, `${JSON.stringify(workContext({ issue, repo, branch, plan, runId, adapter }), null, 2)}\n`, "utf8");
    writeFileSync(resolve(runDir, "coding-adapter-contract.json"), `${JSON.stringify(codingAdapterContractJson(adapter), null, 2)}\n`, "utf8");
    entry = updateLoopEvidence(entry, { adapterContract: loopRunPath(runId, "coding-adapter-contract.json") });
    appendLoopEvent(entry, "loop_adapter_contract_written", "planning", "Coding adapter contract written.", { path: entry.evidence.adapterContract });

    const testPlan = testingPlanFor({ changes: inferChangeTypes(plan.filesToTouch), risk: inferRiskLevel(plan) });
    writeFileSync(resolve(runDir, "testing-plan.json"), `${JSON.stringify(testPlan, null, 2)}\n`, "utf8");
    writeFileSync(resolve(runDir, "testing-plan.md"), formatTestingPlan(testPlan), "utf8");
    entry = updateLoopEvidence(entry, {
      testingPlan: loopRunPath(runId, "testing-plan.md"),
      testingPlanJson: loopRunPath(runId, "testing-plan.json"),
    });
    appendLoopEvent(entry, "loop_testing_plan_written", "planning", "Testing skills plan written.", { changes: testPlan.changes, risk: testPlan.risk });

    writeFileSync(resolve(runDir, "manifest.md"), formatRunManifest({ issue, repo, plan, apply, adapter, verify, openPr, testPlan }), "utf8");
    entry = updateLoopEvidence(entry, { manifest: loopRunPath(runId, "manifest.md") });
    appendLoopEvent(entry, "loop_manifest_written", "planning", "Run manifest written.", { path: entry.evidence.manifest });
    entry = updateLoopRun(entry, { state: "planned" }, "Loop run planned.");

    if (!apply) {
      console.log(`AI work dry-run created .myagenttool/runs/${runId}`);
      console.log("Re-run with --apply to create the branch, run the trusted coding adapter, verify, and optionally open a PR.");
      return;
    }

    entry = updateLoopRun(entry, { state: "applying" }, "Apply mode started.");
    ensureCleanWorktree();
    runCommand("git", ["switch", "-c", branch], { label: `create branch ${branch}` });

    entry = updateLoopRun(entry, { state: "running_adapter" }, `Running ${adapter.name} coding adapter.`);
    appendLoopEvent(entry, "loop_adapter_started", "running_adapter", "Coding adapter started.", { adapter: adapter.name });
    const adapterResult = runCodingAdapter({ args, adapter, issue, repo, branch, plan, runId, runDir, contextFile });
    writeFileSync(resolve(runDir, "coding-adapter-result.json"), `${JSON.stringify(adapterResult.summary, null, 2)}\n`, "utf8");
    entry = updateLoopEvidence(entry, { adapterResult: loopRunPath(runId, "coding-adapter-result.json") });
    appendLoopEvent(entry, "loop_adapter_completed", "running_adapter", "Coding adapter completed.", { status: adapterResult.summary.status, changedFiles: adapterResult.summary.changedFiles });

    entry = updateLoopRun(entry, { state: "checking_scope" }, "Checking scope drift.");
    const scopeResult = buildScopeCheckResult({ plan, planFile: `.myagenttool/runs/${runId}/code-plan.json`, base: "HEAD", allowDrift: option(args, "--allow-drift") ?? "" });
    writeFileSync(resolve(runDir, "scope-check.json"), `${JSON.stringify(scopeResult, null, 2)}\n`, "utf8");
    writeFileSync(resolve(runDir, "scope-check.md"), formatScopeCheck(scopeResult), "utf8");
    entry = updateLoopEvidence(entry, {
      scopeCheck: loopRunPath(runId, "scope-check.md"),
      scopeCheckJson: loopRunPath(runId, "scope-check.json"),
    });
    appendLoopEvent(entry, "loop_scope_checked", "checking_scope", "Scope drift checked.", { allowed: scopeResult.allowed, driftLevel: scopeResult.driftLevel });
    if (!scopeResult.allowed) {
      if (scopeResult.driftLevel === "high") {
        const gate = createLoopHumanGate({
          reason: "High scope drift requires human approval.",
          risk: "high",
          scope: `Scope drift level ${scopeResult.driftLevel}`,
          requestedAction: "Approve scope drift or reduce the diff.",
          requestedBy: "work-runner",
          expiresAt: null,
          evidence: entry.evidence.scopeCheck,
        });
        entry = applyLoopHumanGate(entry, gate, "Human approval required for scope drift.");
      }
      throw new Error(`Scope or Product Flow drift is not allowed. See .myagenttool/runs/${runId}/scope-check.md.`);
    }

    if (verify) {
      entry = updateLoopRun(entry, { state: "verifying" }, "Running repository verification.");
      const verification = runVerification();
      writeFileSync(resolve(runDir, "verification.md"), verification, "utf8");
      entry = updateLoopEvidence(entry, { verification: loopRunPath(runId, "verification.md") });
      appendLoopEvent(entry, "loop_verification_completed", "verifying", "Repository verification completed.", { path: entry.evidence.verification });
    }

    if (openPr) {
      if (!repo) throw new Error("Cannot open PR without --repo or GITHUB_REPOSITORY.");
      const body = formatPrBody({ issue, plan, runId, adapter, verified: verify, testPlan, scopeResult });
      writeFileSync(resolve(runDir, "pr-body.md"), body, "utf8");
      entry = updateLoopEvidence(entry, { prBody: loopRunPath(runId, "pr-body.md") });
      appendLoopEvent(entry, "loop_pr_requested", entry.state, "Opening pull request.", { path: entry.evidence.prBody });
      runGh(["pr", "create", "--repo", repo, "--title", plan.prSummary || `Work for #${issue}`, "--body", body]);
    }

    entry = updateLoopRun(entry, { state: "completed" }, "Loop run completed.");
    appendLoopEvent(entry, "loop_completed", "completed", "Loop run completed.", { manifest: entry.evidence.manifest });
    console.log(`AI work apply completed. Manifest: .myagenttool/runs/${runId}/manifest.md`);
  } catch (error) {
    const message = error?.message || String(error);
    entry = updateLoopRun(entry, { state: "failed", lastError: message }, "Loop run failed.");
    appendLoopEvent(entry, "loop_failed", "failed", message, {});
    throw error;
  }
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

async function reviewPullRequest(args) {
  const pr = option(args, "--pr") ?? process.env.PR_NUMBER;
  if (!pr) fail("Missing --pr.");

  const repo = option(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? defaultRepo();
  const diffFile = option(args, "--diff-file");
  const prContext = diffFile
    ? { title: `PR #${pr}`, body: "", diff: readFileSync(resolve(repoRoot, diffFile), "utf8") }
    : readPullRequestContext(repo, pr);

  const result = await runStructuredAgent({
    args,
    agentName: "review-pr",
    schema: REVIEW_SCHEMA,
    systemPrompt: [
      "You are the MyAgentTool automated PR reviewer.",
      "Use a findings-first code review style.",
      "Prioritize correctness, security, local execution safety, billing/cost impact, data governance, and missing tests.",
      "Do not approve if verification evidence is missing for behavior-changing work.",
      "Always include riskGates for security, data, billing/cost, local execution, release/deploy, web visual QA, and desktop cross-platform execution/cancellation when they apply.",
      "For product-facing UI/workflow changes, review Product Flow coverage, IA separation, owner surface boundaries, prototype states, what-not-to-show, and role-specific usability tasks.",
      "When evidence is missing, add a verificationGaps item instead of assuming the check passed.",
      "Return only JSON that matches the schema.",
    ].join("\n"),
    userPrompt: [
      `PR title:\n${prContext.title}`,
      `PR body:\n${prContext.body}`,
      `Diff:\n${truncate(prContext.diff, 60000)}`,
      docsContext([
        "docs/design/PRODUCT_FLOWS.md",
        "DESIGN.md",
        "docs/engineering/VISUAL_QA.md",
        "docs/engineering/PR_REVIEW_POLICY.md",
        "docs/engineering/FULL_FLOW_AI_DELIVERY.md",
      ]),
    ].join("\n\n"),
  });

  const markdown = formatReview(result);
  writeStructuredResult(result, markdown, args);

  if (args.includes("--comment")) {
    if (!repo) fail("Cannot comment without --repo or GITHUB_REPOSITORY.");
    runGh(["pr", "comment", pr, "--repo", repo, "--body", markdown]);
  }
}

function workManifest(args) {
  const issue = option(args, "--issue") ?? "";
  const pr = option(args, "--pr") ?? "";
  const out = option(args, "--out");
  const branch = commandOutput("git", ["branch", "--show-current"]);
  const status = commandOutput("git", ["status", "--short"]);
  const head = commandOutput("git", ["rev-parse", "--short", "HEAD"]);
  const changedFiles = status
    .split(/\r?\n/)
    .map((line) => line.replace(/^.{1,2}\s+/, "").trim())
    .filter(Boolean);

  const manifest = `# AI Work Manifest

Created: ${new Date().toISOString()}

## Scope

- Issue: ${issue ? `#${issue}` : "TODO"}
- PR: ${pr ? `#${pr}` : "TODO"}
- Branch: ${branch || "TODO"}
- Head: ${head || "TODO"}

## Changed Files

${changedFiles.length > 0 ? changedFiles.map((file) => `- ${file}`).join("\n") : "- No uncommitted files at manifest generation time."}

## Commands To Run

- [ ] pnpm docs:check
- [ ] pnpm repo:check
- [ ] pnpm github:check
- [ ] pnpm ai:check
- [ ] pnpm release:check
- [ ] pnpm deploy:check
- [ ] pnpm typecheck
- [ ] pnpm test
- [ ] pnpm github:check:pr

## Evidence

- Automated checks:
- Manual verification:
- Screenshots or logs:

## Risk Review

- Security:
- Data:
- Cost/billing:
- Local execution:
- Release/rollback:

## Follow-up Issues

- None yet.
`;

  writeOrPrint(manifest, out);
}

function codingAdapterContract(args) {
  const adapter = resolveCodingAdapter(args);
  const out = option(args, "--out");
  const json = args.includes("--json");
  const contract = codingAdapterContractJson(adapter);
  const content = json ? `${JSON.stringify(contract, null, 2)}\n` : formatCodingAdapterContract(contract);
  writeOrPrint(content, out);
}

function feedbackConvert(args) {
  const feedback = option(args, "--feedback");
  const target = option(args, "--target") ?? "needs investigation";
  if (!feedback) fail("Missing --feedback.");

  const type = targetToType(target);
  const area = inferArea(feedback);
  const platform = inferPlatform(feedback);
  const riskFlags = inferRiskFlags(feedback);
  const risk = target === "risk" || riskFlags.length > 0 ? "high" : "medium";
  const titlePrefix = type === "bug" ? "[Bug]" : type === "risk" ? "[Risk]" : "[Task]";
  const brief = feedbackBrief({ feedback, target, type, area, platform, risk, riskFlags, titlePrefix });

  if (args.includes("--issue-tree") || args.includes("--json")) {
    const content = `${JSON.stringify(brief, null, 2)}\n`;
    writeOrPrint(content, option(args, "--out"));
    return;
  }

  const draft = `# Feedback Conversion Draft

## Suggested Issue Title

${titlePrefix}: TODO short title from feedback

## Suggested Labels

- type/${type}
- status/backlog
- area/${area}
- risk/${risk}
- acceptance/not-defined
- platform/${platform}
- agent/platform

## Issue Body

## Feedback

${feedback}

## Triage

- Target: ${target}
- User outcome: TODO
- Evidence: TODO

## Acceptance

- [ ] TODO

## Project Fields

Milestone: M0
Area: ${area}
Type: ${type}
Status: backlog
Risk: ${risk}
Acceptance: not defined
Platform: ${platform}
Agent Target: platform
Priority: p2
Source Doc: docs/engineering/FULL_FLOW_AI_DELIVERY.md

## Issue Tree Handoff

To create a governed issue dry-run from this feedback, run:

\`\`\`text
pnpm ai:feedback -- --feedback "..." --target ${target} --issue-tree --out .myagenttool/runs/feedback-brief.json
pnpm ai:issue-tree -- --brief-file .myagenttool/runs/feedback-brief.json --repo OWNER/REPO
\`\`\`
`;

  writeOrPrint(draft, option(args, "--out"));
}

function feedbackBrief({ feedback, target, type, area, platform, risk, riskFlags, titlePrefix }) {
  const acceptance = type === "bug"
    ? ["A reproduction or evidence note is recorded.", "The expected user outcome is restored or a follow-up risk is filed."]
    : type === "risk"
      ? ["Risk impact and likelihood are recorded.", "A mitigation or explicit owner decision is documented."]
      : ["The feedback is converted into a milestone-aligned follow-up with clear acceptance criteria."];
  return {
    outcome: "Convert release, demo, support, or user feedback into tracked follow-up work.",
    primaryUser: "Reviewer or operator triaging feedback after a release or demo.",
    problem: feedback,
    userStory: "As a reviewer, I want feedback to become traceable work so that release learning is not lost.",
    nonGoals: ["Do not silently change roadmap scope without review.", "Do not collect telemetry beyond approved pre-launch signals."],
    acceptanceCriteria: acceptance,
    riskFlags: riskFlags.length > 0 ? riskFlags : ["Review whether the feedback implies user-visible confusion, rollback needs, or support risk."],
    projectFields: {
      milestone: "M0",
      area,
      type,
      status: "backlog",
      risk,
      acceptance: "defined",
      platform,
      agentTarget: "platform",
      priority: type === "bug" || type === "risk" ? "p1" : "p2",
      sourceDoc: "docs/engineering/FULL_FLOW_AI_DELIVERY.md",
    },
    issueTitle: `${titlePrefix}: TODO short title from feedback`,
    suggestedLabels: labelsFromProjectFields({
      milestone: "M0",
      area,
      type,
      status: "backlog",
      risk,
      acceptance: "defined",
      platform,
      agentTarget: "platform",
      priority: type === "bug" || type === "risk" ? "p1" : "p2",
      sourceDoc: "docs/engineering/FULL_FLOW_AI_DELIVERY.md",
    }),
    openQuestions: ["What evidence confirms this feedback?", "Should this be fixed before the next release or tracked as a later follow-up?"],
  };
}

async function createCodePlan(args) {
  const issue = option(args, "--issue");
  if (!issue) fail("Missing --issue.");

  const repo = option(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? defaultRepo();
  const fallbackTitle = option(args, "--title") ?? `Issue ${issue}`;
  const issueContext = readIssueContext(repo, issue, fallbackTitle);
  const branch = buildBranchName(issue, issueContext.title, option(args, "--kind") ?? "feat");

  return runStructuredAgent({
    args,
    agentName: "code-plan",
    schema: CODE_PLAN_SCHEMA,
    systemPrompt: [
      "You are the MyAgentTool coding orchestration agent.",
      "Create a scoped implementation plan from one GitHub issue.",
      "Prefer small changes, existing repo patterns, and explicit verification commands.",
      "For UI, workflow, or user-facing work, bind the code plan to Product Flow: role, scenario, owner surface, prototype states, what not to show, and visual QA tasks.",
      "Do not use Not applicable or product-flow triage placeholders for product-facing UI/workflow changes.",
      "Do not invent files that conflict with the current workspace.",
      "Return only JSON that matches the schema.",
    ].join("\n"),
    userPrompt: [
      `Repository files:\n${repoFileList()}`,
      `Expected branch:\n${branch}`,
      `Issue title:\n${issueContext.title}`,
      `Issue body:\n${truncate(issueContext.body, 20000)}`,
      docsContext([
        "docs/design/PRODUCT_FLOWS.md",
        "DESIGN.md",
        "docs/engineering/VISUAL_QA.md",
        "docs/engineering/FULL_FLOW_AI_DELIVERY.md",
        "docs/engineering/DEFINITION_OF_DONE.md",
      ]),
    ].join("\n\n"),
  });
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

function mockStructuredOutput({ agentName, prompt, issue, title }) {
  const riskFlags = inferRiskFlags(prompt);
  const area = inferArea(prompt);
  const platform = inferPlatform(prompt);

  if (agentName === "pm-brief") {
    return {
      outcome: "A non-professional user can describe an idea and receive a safe, trackable engineering slice.",
      primaryUser: "Non-professional product user first, with professional controls available as secondary details.",
      problem: "The current workflow still requires engineering knowledge to turn intent into issue-ready work.",
      userStory: "As a user with an idea, I want the system to translate my intent into scoped work so that I can move toward a product outcome without knowing the internal process.",
      nonGoals: ["No production deployment without human approval.", "No hidden local command execution."],
      acceptanceCriteria: [
        "A plain-language idea produces a structured PM brief.",
        "The brief includes risk, platform, area, acceptance, and user outcome fields.",
        "High-risk changes remain gated by explicit human approval.",
      ],
      riskFlags: riskFlags.length > 0 ? riskFlags : ["Review scope, data, cost, and local execution impact manually."],
      projectFields: {
        milestone: "M0",
        area,
        type: "task",
        status: "ready",
        risk: riskFlags.length > 0 ? "high" : "medium",
        acceptance: "defined",
        platform,
        agentTarget: "platform",
        priority: "p1",
        sourceDoc: "docs/engineering/FULL_FLOW_AI_DELIVERY.md",
      },
      productFlow: {
        roleFlow: "ordinary developer",
        scenario: "Turn a plain-language idea into a governed AI development issue.",
        frequency: "medium",
        ownerSurface: "AI intake and issue creation workflow",
        usabilityTask: "Create a trackable issue with acceptance, risk, and Product Flow evidence.",
        whatNotToShow: "Raw provider internals or unreviewed automation details as product-facing proof.",
        partialAcceptanceOrFollowUp: "None for the governed issue creation slice.",
      },
      issueTitle: "[Task]: Model-backed PM brief generation",
      suggestedLabels: [
        "type/task",
        "status/ready",
        `area/${area}`,
        `risk/${riskFlags.length > 0 ? "high" : "medium"}`,
        "acceptance/defined",
        `platform/${platform}`,
        "agent/platform",
        "priority/p1",
      ],
      openQuestions: ["Which provider should be used in production: OpenAI, command adapter, or both?"],
    };
  }

  if (agentName === "code-plan") {
    const issueMatch = prompt.match(/Issue title:\n(.+)/);
    const planTitle = title || issueMatch?.[1]?.trim() || "AI delivery work";
    const expectedBranchMatch = prompt.match(/Expected branch:\n(?:[a-z]+\/)?issue-(\d+)-/);
    const issueNumber = issue ?? expectedBranchMatch?.[1] ?? "0";
    return {
      branch: buildBranchName(issueNumber, planTitle, "feat"),
      summary: "Add a safe AI work runner slice that turns issue context into an implementation plan, review draft, and verification evidence.",
      productFlow: {
        roleFlow: "ordinary developer",
        scenario: "Run an AI-assisted development task from a governed issue.",
        frequency: "medium",
        ownerSurface: "AI development workflow and generated PR evidence",
        usabilityTask: "Confirm generated work is tied to a role, task flow, verification evidence, and follow-up.",
        whatNotToShow: "Raw provider internals or unreviewed automation details as product-facing proof.",
        partialAcceptanceOrFollowUp: "None for this automation slice.",
      },
      affectedSurfaces: ["AI issue tree", "AI code plan", "PR evidence"],
      prototypeStates: ["empty", "running", "succeeded", "failed"],
      acceptanceSignals: [
        "Findable: Product Flow is visible in the code plan and PR body.",
        "Understandable: Reviewer can identify role, scenario, and owner surface.",
        "Actionable: Verification commands and follow-up issues are explicit.",
        "Traceable: Evidence files link code plan, testing plan, scope check, and PR.",
      ],
      whatNotToShow: ["Raw provider internals", "Unreviewed generated work as accepted evidence"],
      visualQaTasks: ["Not applicable for non-Web UI automation changes."],
      filesToTouch: [
        "tools/ai/src/index.mjs",
        "docs/engineering/MODEL_DRIVEN_DELIVERY.md",
        "docs/engineering/FULL_FLOW_AI_DELIVERY.md",
      ],
      steps: [
        "Add model provider abstraction with OpenAI, command, and mock providers.",
        "Add PM, code plan, work runner, and review commands.",
        "Keep mutating operations behind explicit --apply or --comment gates.",
      ],
      commands: ["pnpm ai:check", "pnpm typecheck", "pnpm test"],
      risks: ["Local command execution must remain opt-in.", "Provider output must be structured and reviewable."],
      followUpIssues: ["Add provider-specific eval fixtures before production use."],
      prSummary: "feat: add AI delivery runner MVP",
    };
  }

  if (agentName === "review-pr") {
    return {
      summary: "Mock review found no blocking correctness issue in the provided context.",
      findings: [],
      verificationGaps: [
        "Run the full repository checks and attach output before merge.",
        "Attach visual QA, desktop cancellation, security/data/billing, or release evidence when matching files change.",
      ],
      riskGates: [
        "Security, data, billing/cost, local execution, and release/deploy changes require explicit evidence before merge.",
        "Web UI changes require visual QA screenshot evidence; desktop/local execution changes require cross-platform execution and cancellation evidence.",
        "Human approval is still required for merge, release, billing, local execution, and data retention changes.",
      ],
      approve: false,
    };
  }

  throw new Error(`No mock output for agent ${agentName}.`);
}

async function loadPmBriefForIssueTree(args) {
  const briefFile = option(args, "--brief-file");
  if (briefFile) {
    const content = readFileSync(resolve(repoRoot, briefFile), "utf8");
    try {
      return normalizePmBrief(JSON.parse(content));
    } catch {
      return normalizePmBrief(parsePmBriefMarkdown(content));
    }
  }

  const idea = option(args, "--idea");
  if (!idea) fail("Missing --idea or --brief-file.");
  const brief = await runStructuredAgent({
    args,
    agentName: "pm-brief",
    schema: PM_BRIEF_SCHEMA,
    systemPrompt: [
      "You are the MyAgentTool PM agent.",
      "Turn plain-language ideas into milestone-aligned, non-professional-first engineering slices.",
      "Prefer M0 unless the idea clearly requires billing, lifecycle automation, distribution, or later roadmap work.",
      "Do not hide security, data, cost, release, or local execution risk.",
      "For UI, workflow, or user-facing work, include productFlow using docs/design/PRODUCT_FLOWS.md; otherwise mark it Not applicable.",
      "Return only JSON that matches the schema.",
    ].join("\n"),
    userPrompt: [
      `Idea:\n${idea}`,
      docsContext(["docs/vision/PRODUCT.md", "docs/engineering/FULL_FLOW_AI_DELIVERY.md", "docs/engineering/PM_DESIGN_SKILLS.md", "docs/design/PRODUCT_FLOWS.md"]),
    ].join("\n\n"),
  });
  return normalizePmBrief(brief);
}

function normalizePmBrief(brief) {
  const projectFields = brief.projectFields ?? {};
  return {
    outcome: brief.outcome ?? "TODO",
    primaryUser: brief.primaryUser ?? "Non-professional user first.",
    problem: brief.problem ?? "TODO",
    userStory: brief.userStory ?? "TODO",
    nonGoals: stringArrayOr(brief.nonGoals, ["No hidden local command execution.", "No production release without approval."]),
    acceptanceCriteria: stringArrayOr(brief.acceptanceCriteria, []),
    riskFlags: stringArrayOr(brief.riskFlags, ["Review security, data, cost, local execution, and release impact manually."]),
    issueTitle: brief.issueTitle ?? "[Task]: TODO",
    suggestedLabels: stringArrayOr(brief.suggestedLabels, []),
    openQuestions: stringArrayOr(brief.openQuestions, []),
    productFlow: normalizeProductFlow(brief.productFlow),
    projectFields: {
      milestone: projectFields.milestone ?? "M0",
      area: projectFields.area ?? "cross-cutting",
      type: projectFields.type ?? "task",
      status: "backlog",
      risk: projectFields.risk ?? "medium",
      acceptance: projectFields.acceptance ?? "defined",
      platform: projectFields.platform ?? "all",
      agentTarget: projectFields.agentTarget ?? "platform",
      priority: projectFields.priority ?? "p1",
      sourceDoc: projectFields.sourceDoc ?? "docs/engineering/FULL_FLOW_AI_DELIVERY.md",
    },
  };
}

function parsePmBriefMarkdown(content) {
  return {
    outcome: markdownSection(content, "Outcome") || markdownSection(content, "Plain-language Outcome"),
    primaryUser: markdownSection(content, "Primary User"),
    problem: markdownSection(content, "Problem"),
    userStory: markdownSection(content, "User Story"),
    nonGoals: markdownListSection(content, "Non-goals"),
    acceptanceCriteria: markdownChecklistSection(content, "Acceptance Criteria"),
    riskFlags: markdownListSection(content, "Risk Flags"),
    issueTitle: (content.match(/Title:\s*(.+)/i)?.[1] ?? "").trim(),
    suggestedLabels: markdownListAfter(content, "Labels:"),
    openQuestions: markdownListSection(content, "Open Questions"),
    productFlow: parseProductFlowFromText(content),
    projectFields: parseProjectFieldsFromText(content),
  };
}

function issueTreeFromBrief(brief) {
  const normalized = normalizePmBrief(brief);
  const labels = mergeGovernanceLabels(normalized.suggestedLabels, normalized.projectFields);
  const rootIssue = {
    role: "root",
    title: normalizeIssueTitle(normalized.issueTitle, normalized.projectFields.type),
    outcome: normalized.outcome,
    primaryUser: normalized.primaryUser,
    problem: normalized.problem,
    userStory: normalized.userStory,
    nonGoals: normalized.nonGoals,
    acceptanceCriteria: normalized.acceptanceCriteria,
    riskFlags: normalized.riskFlags,
    openQuestions: normalized.openQuestions,
    productFlow: normalized.productFlow,
    labels,
    milestone: normalized.projectFields.milestone,
    projectFields: normalized.projectFields,
    sourceDoc: normalized.projectFields.sourceDoc,
  };
  return {
    version: "2026-06-19",
    mode: "dry-run",
    source: "pm-brief",
    issues: [rootIssue],
    governance: {
      dryRunDefault: true,
      applyRequiresExplicitFlag: true,
      humanApprovalProvided: false,
      humanApprovalEvidence: "",
      humanApprovalRequiredFor: ["roadmap-changing work", "security", "billing", "local execution", "release"],
      followUp: ["Run pnpm github:check:issues.", "Run sync-project-fields dry-run before moving issues to ready."],
    },
  };
}

function issueTreeWithHumanApproval(tree, humanApproval) {
  const evidence = String(humanApproval ?? "").trim();
  if (!evidence) return tree;
  return {
    ...tree,
    governance: {
      ...tree.governance,
      humanApprovalProvided: true,
      humanApprovalEvidence: evidence,
    },
    issues: tree.issues.map((issueSpec) => ({
      ...issueSpec,
      humanApproval: evidence,
    })),
  };
}

function mergeGovernanceLabels(labels, fields) {
  const governancePrefixes = ["type/", "status/", "area/", "risk/", "acceptance/", "platform/", "agent/", "priority/"];
  const customLabels = labels.filter((label) => !governancePrefixes.some((prefix) => label.startsWith(prefix)));
  return [...labelsFromProjectFields(fields), ...customLabels];
}

function validateIssueTreeForApply(tree, humanApproval = "") {
  const failures = issueTreeApplyFailures(tree, humanApproval);
  if (failures.length > 0) {
    fail(`Issue tree is not safe to apply:\n${failures.map((failure) => `  - ${failure}`).join("\n")}`);
  }
}

function issueTreeApplyFailures(tree, humanApproval = "") {
  const failures = [];
  const approvalReasons = humanApprovalRequiredReasons(tree);
  const approvalEvidence = String(humanApproval || tree.governance?.humanApprovalEvidence || "").trim();
  for (const issueSpec of tree.issues) {
    if (!issueSpec.title || issueSpec.title.includes("TODO")) failures.push(`${issueSpec.title || "(untitled)"}: title is missing or TODO`);
    if (!issueSpec.milestone) failures.push(`${issueSpec.title}: milestone is missing`);
    if (!issueSpec.acceptanceCriteria.length) failures.push(`${issueSpec.title}: acceptance criteria are missing`);
    if (requiresConcreteProductFlowForIssue(issueSpec) && !hasConcreteProductFlow(issueSpec.productFlow)) {
      failures.push(`${issueSpec.title}: UI/workflow issue requires concrete Product Flow from docs/design/PRODUCT_FLOWS.md`);
    }
    for (const group of ["type/", "status/", "area/", "risk/", "acceptance/", "platform/", "agent/"]) {
      if (!issueSpec.labels.some((label) => label.startsWith(group))) {
        failures.push(`${issueSpec.title}: missing ${group} label`);
      }
    }
  }
  if (approvalReasons.length > 0 && !approvalEvidence) {
    failures.push(`human approval is required for ${approvalReasons.join(", ")}; pass --human-approved "approval reason" or set MYAGENTTOOL_HUMAN_APPROVED`);
  }
  return failures;
}

function humanApprovalRequiredReasons(tree) {
  const reasons = new Set();
  for (const issueSpec of tree.issues ?? []) {
    const labels = issueSpec.labels ?? [];
    const fields = issueSpec.projectFields ?? {};
    const text = [
      issueSpec.title,
      issueSpec.outcome,
      issueSpec.problem,
      issueSpec.userStory,
      ...(issueSpec.riskFlags ?? []),
      ...(issueSpec.nonGoals ?? []),
      fields.area,
      fields.type,
      fields.risk,
      fields.sourceDoc,
      ...labels,
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();

    if (labels.some((label) => ["risk/high", "risk/critical"].includes(label)) || ["high", "critical"].includes(normalizeLabelValue(fields.risk))) {
      reasons.add("high-risk work");
    }
    if (/security|auth|credential|secret|permission|privacy|data retention|data-retention/.test(text)) reasons.add("security or data/privacy impact");
    if (/billing|cost|quota|settlement|chargeback|payment/.test(text)) reasons.add("billing or cost impact");
    if (/local execution|local-execution|desktop|process execution|child process|subprocess|shell|command execution|cancellation/.test(text)) reasons.add("local execution impact");
    if (/release|deploy|deployment|rollback|production/.test(text)) reasons.add("release or deploy impact");
    if (/roadmap|initiative|milestone|lifecycle|distribution/.test(text)) reasons.add("roadmap-changing work");
  }
  return [...reasons];
}

function formatIssueTree(tree, { applied }) {
  const created = tree.created ?? [];
  return `# AI Issue Tree ${applied ? "Apply Result" : "Dry Run"}

Generated: ${new Date().toISOString()}
Version: ${tree.version}

## Issues

${tree.issues.map((issueSpec, index) => formatIssueTreeItem(issueSpec, created[index])).join("\n\n")}

## Governance

- Dry-run by default: yes
- Apply requires explicit flag: yes
- Human approval required for: ${tree.governance.humanApprovalRequiredFor.join(", ")}
- Human approval provided: ${tree.governance.humanApprovalProvided ? "yes" : "no"}
${tree.governance.humanApprovalEvidence ? `- Human approval evidence: ${tree.governance.humanApprovalEvidence}` : ""}

## Follow-up Checks

${list(tree.governance.followUp)}
`;
}

function formatIssueTreeItem(issueSpec, created) {
  return `### ${issueSpec.title}

${created ? `Created: ${created.url}\n` : ""}Labels: ${issueSpec.labels.join(", ")}
Milestone: ${issueSpec.milestone}
Source Doc: ${issueSpec.sourceDoc}

${formatIssueBody(issueSpec, undefined)}`;
}

function formatIssueBody(issueSpec, parentNumber) {
  return `${parentNumber ? `## Parent\n#${parentNumber}\n\n` : ""}## Outcome
${issueSpec.outcome}

## Primary User
${issueSpec.primaryUser}

## Problem
${issueSpec.problem}

## User Story
${issueSpec.userStory}

## Non-goals
${list(issueSpec.nonGoals)}

## Acceptance
${checklist(issueSpec.acceptanceCriteria)}

## Product Flow
${formatProductFlow(issueSpec.productFlow)}

## Risk Flags
${list(issueSpec.riskFlags)}

## Human Approval
${issueSpec.humanApproval ? issueSpec.humanApproval : "Not recorded. Required before apply for high-risk, security/data, billing/cost, local execution, roadmap, or release/deploy work."}

## Open Questions
${list(issueSpec.openQuestions)}

## Project Fields
${formatProjectFields(issueSpec.projectFields)}
`;
}

function normalizeIssueTitle(title, type) {
  if (!title || title === "TODO") {
    const prefix = type === "risk" ? "[Risk]" : type === "adr" ? "[ADR]" : type === "epic" ? "[Epic]" : "[Task]";
    return `${prefix}: TODO`;
  }
  return title;
}

function labelsFromProjectFields(fields) {
  return [
    `type/${normalizeLabelValue(fields.type)}`,
    `status/${normalizeLabelValue(fields.status)}`,
    `area/${normalizeLabelValue(fields.area)}`,
    `risk/${normalizeLabelValue(fields.risk)}`,
    `acceptance/${normalizeLabelValue(fields.acceptance)}`,
    `platform/${normalizeLabelValue(fields.platform)}`,
    `agent/${normalizeLabelValue(fields.agentTarget)}`,
    `priority/${normalizeLabelValue(fields.priority)}`,
  ];
}

function normalizeLabelValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function formatPmBrief(brief) {
  return `# Model-backed PM Brief

## Outcome

${brief.outcome}

## Primary User

${brief.primaryUser}

## Problem

${brief.problem}

## User Story

${brief.userStory}

## Non-goals

${list(brief.nonGoals)}

## Acceptance Criteria

${checklist(brief.acceptanceCriteria)}

## Risk Flags

${list(brief.riskFlags)}

## Suggested Issue

Title: ${brief.issueTitle ?? "TODO"}

Labels:
${list(brief.suggestedLabels ?? [])}

## Project Fields

${formatProjectFields(brief.projectFields)}

## Product Flow

${formatProductFlow(normalizeProductFlow(brief.productFlow))}

## Open Questions

${list(brief.openQuestions)}
`;
}

function formatCodePlan(plan) {
  return `# AI Code Plan

## Branch

${plan.branch}

## Summary

${plan.summary}

## Product Flow

${formatProductFlow(plan.productFlow)}

## Affected Surfaces

${list(plan.affectedSurfaces ?? [])}

## Prototype States

${list(plan.prototypeStates ?? [])}

## Acceptance Signals

${list(plan.acceptanceSignals ?? [])}

## What Not To Show

${list(plan.whatNotToShow ?? [])}

## Visual QA Tasks

${list(plan.visualQaTasks ?? [])}

## Files To Touch

${list(plan.filesToTouch)}

## Steps

${orderedList(plan.steps)}

## Verification Commands

${list(plan.commands)}

## Risks

${list(plan.risks)}

## Follow-up Issues

${list(plan.followUpIssues)}

## PR Summary

${plan.prSummary}
`;
}

function formatScopeCheck(result) {
  return `# AI Scope Check

Base: ${result.base}
Plan file: ${result.planFile || "not provided"}
Drift level: ${result.driftLevel}
Allowed: ${result.allowed ? "yes" : "no"}
Policy action: ${result.policyAction ?? "pass"}
Override: ${result.allowDrift || "none"}

## Changed Files

${list(result.changedFiles)}

## Declared Files

${list(result.declaredFiles)}

## Undeclared Files

${list(result.undeclaredFiles)}

## Product Flow Gaps

${list(result.productFlowGaps)}

## Summary

${result.summary}
`;
}

function formatTestingPlan(plan) {
  return `# AI Testing Skills Plan

Matched change types: ${plan.changes?.join(", ") ?? plan.change}
Risk: ${plan.risk}

## Required Evidence

${list(plan.requiredEvidence)}

## Recommended Commands

${list(plan.commands)}

## Manual Evidence

${list(plan.manualEvidence)}

## Skill Guidance

${list(plan.skillGuidance)}
`;
}

function formatReview(review) {
  const findings =
    review.findings.length === 0
      ? "- No blocking findings reported by the AI reviewer."
      : review.findings
          .map((finding) => `- ${finding.severity}: ${finding.file}:${finding.line} ${finding.title}\n  Rationale: ${finding.rationale}\n  Recommendation: ${finding.recommendation}`)
          .join("\n");

  return `# AI Review

## Findings

${findings}

## Summary

${review.summary}

## Verification Gaps

${list(review.verificationGaps)}

## Risk Gates

${list(review.riskGates)}

## Approval Signal

${review.approve ? "AI reviewer sees no blocking issue, but human approval is still required." : "AI reviewer does not approve automatic merge."}
`;
}

function formatCodingAdapterContract(contract) {
  return `# Trusted Coding Adapter Contract

Version: ${contract.version}

## Adapter

- Name: ${contract.adapter.name}
- Label: ${contract.adapter.label}
- Kind: ${contract.adapter.kind}
- Command environment: ${contract.adapter.commandEnv ?? "none"}

## Required Inputs

${list(contract.requiredInputs)}

## Required Evidence

${list(contract.requiredEvidence)}

## Safety Rules

${list(contract.safetyRules)}

## Environment

${Object.entries(contract.environment)
  .map(([name, value]) => `- ${name}: ${value}`)
  .join("\n")}
`;
}

function formatRunManifest({ issue, repo, plan, apply, adapter, verify, openPr, testPlan }) {
  return `# AI Work Run

Created: ${new Date().toISOString()}

## Scope

- Issue: #${issue}
- Repository: ${repo ?? "unknown"}
- Branch: ${plan.branch}
- Mode: ${apply ? "apply" : "dry-run"}

## Code Plan

${formatCodePlan(plan)}

## Execution

- Coding adapter: ${adapter.name}
- Adapter command source: ${adapter.commandEnv ?? "internal"}
- Verification requested: ${verify ? "yes" : "no"}
- Open PR requested: ${openPr ? "yes" : "no"}
- Model-proposed shell commands executed directly: no

## Testing Skills Plan

- Matched change types: ${testPlan?.changes?.join(", ") ?? testPlan?.change ?? "unknown"}
- Risk: ${testPlan?.risk ?? "unknown"}
- Evidence file: testing-plan.md

## Required Human Gates

- Review generated diff before commit or PR.
- Confirm local execution, data, billing, release, and security impact.
- Approve merge and release separately.
`;
}

function workContext({ issue, repo, branch, plan, runId, adapter }) {
  return {
    contractVersion: CODING_ADAPTER_CONTRACT_VERSION,
    issue: String(issue),
    repository: repo ?? "",
    branch,
    runId,
    adapter: {
      name: adapter.name,
      kind: adapter.kind,
      label: adapter.label,
    },
    plan,
    policy: {
      mayEditWorkspace: true,
      mayRunVerification: true,
      mayOpenPullRequest: false,
      mayExecuteModelProposedCommands: false,
      dirtyWorktreePolicy: "refuse unless an outer policy explicitly allows it",
      scope: "Only edit files needed for the source issue and plan.",
    },
    createdAt: new Date().toISOString(),
  };
}

function runVerification() {
  const sections = [`# Work Verification\n\nCreated: ${new Date().toISOString()}\n`];

  for (const [command, args] of STANDARD_VERIFICATION_COMMANDS) {
    const label = `${command} ${args.join(" ")}`;
    const result = spawnSync(command, args, {
      cwd: repoRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    sections.push(`## ${label}\n\nExit: ${result.status}\n\n\`\`\`text\n${result.stdout ?? ""}${result.stderr ?? ""}\n\`\`\`\n`);
    if (result.status !== 0) {
      throw new Error(`Verification command failed: ${label}`);
    }
  }

  return sections.join("\n");
}

function resolveCodingAdapter(args) {
  const requested = (option(args, "--coding-adapter") ?? option(args, "--adapter") ?? process.env.MYAGENTTOOL_CODING_ADAPTER ?? "mock").toLowerCase();
  const adapter = CODING_ADAPTERS[requested];
  if (!adapter) {
    fail(`Unsupported coding adapter: ${requested}. Supported adapters: ${Object.keys(CODING_ADAPTERS).join(", ")}`);
  }
  return adapter;
}

function codingAdapterContractJson(adapter) {
  return {
    version: CODING_ADAPTER_CONTRACT_VERSION,
    adapter: {
      name: adapter.name,
      kind: adapter.kind,
      label: adapter.label,
      description: adapter.description,
      commandEnv: adapter.commandEnv,
    },
    requiredInputs: [
      "MYAGENTTOOL_WORK_CONTEXT points to a JSON context file.",
      "MYAGENTTOOL_WORK_PLAN_FILE points to the structured code plan.",
      "MYAGENTTOOL_WORK_MANIFEST_FILE points to the run manifest.",
      "MYAGENTTOOL_WORK_EVIDENCE_DIR points to the adapter evidence directory.",
      "MYAGENTTOOL_WORK_BRANCH contains the issue branch name.",
      "MYAGENTTOOL_WORK_ISSUE contains the source issue number.",
    ],
    requiredEvidence: [
      "adapter-result.json with status, summary, changedFiles, commandsRun, and risks.",
      "stdout.txt and stderr.txt for command-backed adapters.",
      "No secrets or broad local file dumps in evidence.",
    ],
    safetyRules: [
      "Refuse to run when the worktree is dirty unless an outer policy explicitly allows it.",
      "Only edit files required for the issue, plan, and repository patterns.",
      "Do not execute shell commands proposed by model output.",
      "Use repository verification scripts instead of ad hoc destructive commands.",
      "Leave merge, production deployment, billing, credential, and release gates to humans.",
    ],
    environment: {
      MYAGENTTOOL_WORK_CONTEXT: "Absolute path to context.json.",
      MYAGENTTOOL_WORK_PLAN_FILE: "Absolute path to code-plan.json.",
      MYAGENTTOOL_WORK_MANIFEST_FILE: "Absolute path to manifest.md.",
      MYAGENTTOOL_WORK_EVIDENCE_DIR: "Absolute path to adapter evidence directory.",
      MYAGENTTOOL_WORK_BRANCH: "Branch created by the runner.",
      MYAGENTTOOL_WORK_ISSUE: "Source issue number.",
    },
  };
}

function runCodingAdapter({ args, adapter, issue, repo, branch, plan, runId, runDir, contextFile }) {
  const evidenceDir = resolve(runDir, "coding-adapter");
  mkdirSync(evidenceDir, { recursive: true });

  if (adapter.name === "mock") {
    const summary = {
      adapter: adapter.name,
      contractVersion: CODING_ADAPTER_CONTRACT_VERSION,
      status: "completed",
      summary: "Mock adapter validated the coding adapter contract and did not edit files.",
      changedFiles: [],
      commandsRun: [],
      risks: ["No real coding agent was invoked."],
      completedAt: new Date().toISOString(),
    };
    writeFileSync(resolve(evidenceDir, "adapter-result.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    writeFileSync(resolve(evidenceDir, "stdout.txt"), "Mock coding adapter completed.\n", "utf8");
    writeFileSync(resolve(evidenceDir, "stderr.txt"), "", "utf8");
    return { summary };
  }

  const commandConfig = resolveAdapterCommand(args, adapter);
  const result = spawnSync(commandConfig.command, commandConfig.args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      MYAGENTTOOL_WORK_ISSUE: String(issue),
      MYAGENTTOOL_WORK_BRANCH: branch,
      MYAGENTTOOL_WORK_REPOSITORY: repo ?? "",
      MYAGENTTOOL_WORK_RUN_ID: runId,
      MYAGENTTOOL_WORK_CONTEXT: contextFile,
      MYAGENTTOOL_WORK_PLAN_FILE: resolve(runDir, "code-plan.json"),
      MYAGENTTOOL_WORK_MANIFEST_FILE: resolve(runDir, "manifest.md"),
      MYAGENTTOOL_WORK_EVIDENCE_DIR: evidenceDir,
      MYAGENTTOOL_CODING_ADAPTER: adapter.name,
    },
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  writeFileSync(resolve(evidenceDir, "stdout.txt"), result.stdout ?? "", "utf8");
  writeFileSync(resolve(evidenceDir, "stderr.txt"), result.stderr ?? "", "utf8");

  const adapterResultFile = resolve(evidenceDir, "adapter-result.json");
  const adapterResult = readAdapterResult(adapterResultFile, {
    adapter: adapter.name,
    contractVersion: CODING_ADAPTER_CONTRACT_VERSION,
    status: "failed",
    summary: result.status === 0 ? "Adapter command completed without required adapter-result.json." : `Adapter command failed with exit ${result.status}.`,
    changedFiles: [],
    commandsRun: [commandConfig.redactedLabel],
    risks: result.status === 0 ? ["Adapter evidence contract was not satisfied."] : ["Inspect adapter stderr before continuing."],
    completedAt: new Date().toISOString(),
  });

  if (result.status !== 0) {
    throw new Error(`Coding adapter ${adapter.name} failed with exit ${result.status}. See .myagenttool/runs/${runId}/coding-adapter.`);
  }

  if (adapterResult.status !== "completed") {
    throw new Error(`Coding adapter ${adapter.name} did not produce completed evidence. See .myagenttool/runs/${runId}/coding-adapter.`);
  }

  return { summary: adapterResult };
}

function resolveAdapterCommand(args, adapter) {
  const raw = option(args, "--adapter-command-json") ?? process.env[adapter.commandEnv] ?? process.env.MYAGENTTOOL_CODING_ADAPTER_COMMAND_JSON;
  if (!raw) {
    fail(`Coding adapter ${adapter.name} requires --adapter-command-json, ${adapter.commandEnv}, or MYAGENTTOOL_CODING_ADAPTER_COMMAND_JSON.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`Coding adapter command must be JSON, for example ["codex","exec"]. Parse error: ${error.message}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== "string" || item.length === 0)) {
    fail('Coding adapter command JSON must be a non-empty string array, for example ["codex","exec"].');
  }

  const [command, ...commandArgs] = parsed;
  return {
    command,
    args: commandArgs,
    redactedLabel: parsed.join(" "),
  };
}

function readAdapterResult(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return normalizeAdapterResult(parsed, fallback);
  } catch {
    return {
      ...fallback,
      status: "failed",
      summary: "Adapter result file existed but was not valid JSON.",
      risks: [...fallback.risks, "Invalid adapter-result.json must be inspected."],
    };
  }
}

function normalizeAdapterResult(result, fallback) {
  return {
    adapter: stringOr(result.adapter, fallback.adapter),
    contractVersion: stringOr(result.contractVersion, fallback.contractVersion),
    status: stringOr(result.status, fallback.status),
    summary: stringOr(result.summary, fallback.summary),
    changedFiles: stringArrayOr(result.changedFiles, fallback.changedFiles),
    commandsRun: stringArrayOr(result.commandsRun, fallback.commandsRun),
    risks: stringArrayOr(result.risks, fallback.risks),
    completedAt: stringOr(result.completedAt, fallback.completedAt),
  };
}

function formatPrBody({ issue, plan, runId, adapter, verified, testPlan, scopeResult }) {
  return `## Summary

- ${plan.prSummary || plan.summary}

## Type

- [ ] docs
- [x] feature
- [ ] bug fix
- [ ] refactor
- [ ] security
- [ ] architecture decision

## Milestone / Area

- Milestone: M0
- Area: automation
- Source issue: Closes #${issue}

## Acceptance

- [x] Acceptance criteria are defined or linked.
- [x] User-facing behavior is described in plain language.
- [x] Security, data, cost, or lifecycle impact was considered.
- [x] Docs were updated when behavior or scope changed.

## Product Flow

${formatProductFlow(plan.productFlow)}

Affected surfaces:
${list(plan.affectedSurfaces ?? [])}

Prototype states:
${list(plan.prototypeStates ?? [])}

Acceptance signals:
${list(plan.acceptanceSignals ?? [])}

Visual QA tasks:
${list(plan.visualQaTasks ?? [])}

## Verification

- [${verified ? "x" : " "}] Automated checks: work-runner verification${verified ? "" : " not requested"}
- [${scopeResult?.allowed ? "x" : " "}] Scope drift check: ${scopeResult?.driftLevel ?? "not generated"}${scopeResult?.allowDrift ? ` (${scopeResult.allowDrift})` : ""}
- [x] Testing skills plan: ${testPlan?.changes?.join(", ") ?? testPlan?.change ?? "unknown"} / ${testPlan?.risk ?? "unknown"}
- [ ] Manual verification:

AI work manifest: .myagenttool/runs/${runId}/manifest.md
Coding adapter: ${adapter?.name ?? "unknown"}
Coding adapter result: .myagenttool/runs/${runId}/coding-adapter-result.json
Coding adapter contract: .myagenttool/runs/${runId}/coding-adapter-contract.json
Scope drift evidence: ${scopeResult ? `.myagenttool/runs/${runId}/scope-check.md` : "not generated"}
Testing skills evidence: .myagenttool/runs/${runId}/testing-plan.md
Verification evidence: ${verified ? `.myagenttool/runs/${runId}/verification.md` : "not generated"}
`;
}

function formatProjectFields(fields) {
  if (!fields) return "TODO";
  return [
    `Milestone: ${fields.milestone}`,
    `Area: ${fields.area}`,
    `Type: ${fields.type}`,
    `Status: ${fields.status}`,
    `Risk: ${fields.risk}`,
    `Acceptance: ${fields.acceptance}`,
    `Platform: ${fields.platform}`,
    `Agent Target: ${fields.agentTarget}`,
    `Priority: ${fields.priority}`,
    `Source Doc: ${fields.sourceDoc}`,
  ].join("\n");
}

function normalizeProductFlow(productFlow) {
  const flow = productFlow && typeof productFlow === "object" ? productFlow : {};
  return {
    roleFlow: stringOr(flow.roleFlow, "Not applicable or requires product-flow triage"),
    scenario: stringOr(flow.scenario, "Not applicable unless this changes UI, workflow, or user-facing behavior"),
    frequency: stringOr(flow.frequency, "Not applicable"),
    ownerSurface: stringOr(flow.ownerSurface, "Not applicable"),
    usabilityTask: stringOr(flow.usabilityTask, "Not applicable"),
    whatNotToShow: stringOr(flow.whatNotToShow, "Internal implementation details in product-facing surfaces"),
    partialAcceptanceOrFollowUp: stringOr(flow.partialAcceptanceOrFollowUp, "Product-facing changes must cite docs/design/PRODUCT_FLOWS.md before review"),
  };
}

function formatProductFlow(productFlow) {
  const flow = normalizeProductFlow(productFlow);
  return [
    `- Role flow: ${flow.roleFlow}`,
    `- Scenario: ${flow.scenario}`,
    `- Frequency: ${flow.frequency}`,
    `- Owner surface: ${flow.ownerSurface}`,
    `- Usability task: ${flow.usabilityTask}`,
    `- What not to show: ${flow.whatNotToShow}`,
    `- Partial acceptance or follow-up: ${flow.partialAcceptanceOrFollowUp}`,
  ].join("\n");
}

function requiresConcreteProductFlowForIssue(issueSpec) {
  const fields = issueSpec.projectFields ?? {};
  const text = [
    issueSpec.title,
    issueSpec.outcome,
    issueSpec.problem,
    issueSpec.userStory,
    fields.area,
    fields.platform,
    fields.sourceDoc,
    ...(issueSpec.labels ?? []),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return /\b(web|ui|ux|workflow|user-facing|console|homepage|visual|design)\b/.test(text)
    || String(fields.sourceDoc ?? "").startsWith("docs/design/")
    || ["web"].includes(normalizeLabelValue(fields.area))
    || ["web"].includes(normalizeLabelValue(fields.platform));
}

function hasConcreteProductFlow(productFlow) {
  const flow = normalizeProductFlow(productFlow);
  return [
    flow.roleFlow,
    flow.scenario,
    flow.frequency,
    flow.ownerSurface,
    flow.usabilityTask,
    flow.whatNotToShow,
    flow.partialAcceptanceOrFollowUp,
  ].every((value) => !isPlaceholderProductFlowValue(value));
}

function isPlaceholderProductFlowValue(value) {
  return /not applicable|requires product-flow triage|update if|must cite docs\/design\/product_flows|todo|n\/a/i.test(String(value ?? ""));
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

function inferRiskFlags(text) {
  const flags = [];
  const lower = text.toLowerCase();
  if (/billing|cost|charge|payment|settlement|revenue|费用|计费|收入/.test(lower)) flags.push("Cost, billing, or revenue impact");
  if (/security|permission|credential|token|secret|安全|权限|密钥/.test(lower)) flags.push("Security or permission impact");
  if (/local|desktop|execute|command|agent|电脑|本地|执行/.test(lower)) flags.push("Local execution or agent operation impact");
  if (/delete|retention|privacy|data|audit|删除|隐私|数据|审计/.test(lower)) flags.push("Data, privacy, retention, or audit impact");
  if (/release|deploy|publish|发布|部署/.test(lower)) flags.push("Release or deployment impact");
  return flags;
}

function inferArea(text) {
  const lower = text.toLowerCase();
  if (/ui|ux|web|console|页面|界面/.test(lower)) return "web";
  if (/server|api|queue|auth|gateway|服务/.test(lower)) return "server";
  if (/desktop|bridge|local|电脑|本地/.test(lower)) return "desktop";
  if (/billing|cost|revenue|费用|计费|收入/.test(lower)) return "billing";
  if (/security|permission|安全|权限/.test(lower)) return "security";
  if (/release|deploy|publish|发布|部署/.test(lower)) return "platform";
  return "cross-cutting";
}

function inferPlatform(text) {
  const lower = text.toLowerCase();
  if (/web|console|页面/.test(lower)) return "web";
  if (/server|api|cloud|服务|云/.test(lower)) return "server";
  if (/mac|windows|linux|desktop|bridge|电脑|本地/.test(lower)) return "all";
  return "all";
}

function targetToType(target) {
  const normalized = target.toLowerCase().trim();
  if (normalized === "bug") return "bug";
  if (normalized === "risk") return "risk";
  return "task";
}

function changedFilesSince(base) {
  const diffFiles = lines(commandOutput("git", ["diff", "--name-only", base, "--"]));
  const statusFiles = commandOutput("git", ["status", "--short"])
    .split(/\r?\n/)
    .map(statusPath)
    .filter(Boolean);
  return [...new Set([...diffFiles, ...statusFiles])];
}

function buildScopeCheckResult({ plan, planFile, base, allowDrift }) {
  const changedFiles = changedFilesSince(base);
  const hasPlan = Boolean(plan);
  const declaredFiles = new Set((plan?.filesToTouch ?? []).map(normalizePath));
  const undeclaredFiles = hasPlan ? changedFiles.filter((file) => !declaredFiles.has(normalizePath(file))) : [];
  const driftLevel = classifyScopeDrift({ changedFiles, undeclaredFiles, allowDrift });
  const productFlowGaps = hasPlan ? productFlowPlanGaps(plan) : [];
  const allowed = (driftLevel !== "high" || Boolean(allowDrift)) && productFlowGaps.length === 0;
  return {
    base,
    planFile,
    hasPlan,
    changedFiles,
    declaredFiles: [...declaredFiles],
    undeclaredFiles,
    productFlowGaps,
    driftLevel,
    allowed,
    policyAction: productFlowGaps.length > 0 ? "fail" : scopeDriftAction(driftLevel, allowDrift),
    allowDrift,
    summary: scopeDriftSummary({ changedFiles, undeclaredFiles, driftLevel, allowDrift, hasPlan, productFlowGaps }),
  };
}

function classifyScopeDrift({ changedFiles, undeclaredFiles, allowDrift }) {
  if (changedFiles.length === 0 || undeclaredFiles.length === 0) return "none";
  if (allowDrift) return "overridden";
  if (undeclaredFiles.length <= 2 && undeclaredFiles.every((file) => /^docs\/|^\.github\//.test(normalizePath(file)))) return "low";
  if (undeclaredFiles.length <= 4) return "medium";
  return "high";
}

function scopeDriftSummary({ changedFiles, undeclaredFiles, driftLevel, allowDrift, hasPlan = true, productFlowGaps = [] }) {
  if (productFlowGaps.length > 0) return `Product Flow plan gaps: ${productFlowGaps.join("; ")}`;
  if (changedFiles.length === 0) return "No changed files detected.";
  if (!hasPlan) return "No plan file was provided; changed files are listed without drift classification.";
  if (undeclaredFiles.length === 0) return "All changed files were declared in the code plan.";
  if (allowDrift) return `Scope drift was explicitly allowed: ${allowDrift}`;
  return `${undeclaredFiles.length} changed file(s) were not declared in the code plan.`;
}

function scopeDriftAction(driftLevel, allowDrift) {
  if (driftLevel === "high" && !allowDrift) return "fail";
  if (["low", "medium", "overridden"].includes(driftLevel)) return "warn";
  return "pass";
}

function productFlowPlanGaps(plan) {
  const plannedFiles = (plan?.filesToTouch ?? []).map(normalizePath);
  if (!plannedFiles.some(isProductFacingPlanFile)) return [];

  const gaps = [];
  if (!hasConcreteProductFlow(plan.productFlow)) {
    gaps.push("productFlow must use concrete role, scenario, owner surface, usability task, and what-not-to-show values");
  }
  if (!stringArrayOr(plan.affectedSurfaces, []).some((item) => !isPlaceholderProductFlowValue(item))) {
    gaps.push("affectedSurfaces must name the Product Flow owner surface");
  }
  if (!stringArrayOr(plan.prototypeStates, []).some((item) => !isPlaceholderProductFlowValue(item))) {
    gaps.push("prototypeStates must list the UI states being verified");
  }
  if (!stringArrayOr(plan.whatNotToShow, []).some((item) => !isPlaceholderProductFlowValue(item))) {
    gaps.push("whatNotToShow must list content that stays out of the owner surface");
  }
  if (!stringArrayOr(plan.visualQaTasks, []).some((item) => !isPlaceholderProductFlowValue(item))) {
    gaps.push("visualQaTasks must list Product Flow visual checks");
  }
  return gaps;
}

function isProductFacingPlanFile(file) {
  return file.startsWith("apps/web/")
    || file === "DESIGN.md"
    || file.startsWith("docs/design/")
    || file === "docs/engineering/VISUAL_QA.md";
}

function testingPlanFor({ change, changes, risk }) {
  const normalizedChanges = normalizeChangeTypes(changes ?? [change ?? "docs"]);
  const normalizedRisk = normalizeLabelValue(risk);
  const base = {
    change: normalizedChanges.join("+"),
    changes: normalizedChanges,
    risk: normalizedRisk,
    requiredEvidence: ["PR lists automated checks run.", "PR lists manual verification or states why it is not needed."],
    commands: ["pnpm docs:check", "pnpm repo:check", "pnpm typecheck", "pnpm test"],
    manualEvidence: [],
    skillGuidance: ["Use Testing skills as guidance; generated tests remain repository-owned and reviewable."],
  };

  if (normalizedChanges.length === 1 && normalizedChanges.includes("docs")) {
    base.commands = ["pnpm docs:check", "pnpm repo:check"];
    base.requiredEvidence.push("Documentation links and source docs are checked.");
  }
  if (normalizedChanges.includes("docs")) {
    base.requiredEvidence.push("Documentation links and source docs are checked.");
  }
  if (normalizedChanges.includes("web")) {
    base.requiredEvidence.push("Visual QA evidence for desktop and mobile viewports.");
    base.requiredEvidence.push("Product Flow evidence for role, owner surface, prototype states, and what-not-to-show checks.");
    base.manualEvidence.push("Screenshot or artifact paths for UI changes.");
    base.manualEvidence.push("Role-specific usability task result from docs/design/PRODUCT_FLOWS.md.");
    base.commands.push("pnpm smoke:local");
    base.commands.push("pnpm visual:qa", "pnpm visual:qa:browser");
  }
  if (normalizedChanges.includes("server")) {
    base.requiredEvidence.push("Integration evidence for API, queue, audit, or persistence behavior.");
  }
  if (normalizedChanges.includes("desktop")) {
    base.requiredEvidence.push("Cross-platform process execution and cancellation evidence.");
    base.manualEvidence.push("Windows/macOS/Linux evidence or explicit gap.");
  }
  if (normalizedChanges.includes("protocol")) {
    base.requiredEvidence.push("State-machine or schema compatibility evidence.");
  }
  if (normalizedChanges.includes("security")) {
    base.requiredEvidence.push("Security review evidence for auth, credentials, data, and local execution.");
    base.skillGuidance.push("Use secure-app-builder style review before merge.");
  }
  if (normalizedChanges.includes("release")) {
    base.requiredEvidence.push("Release, rollback, and deployment preflight evidence.");
    base.commands.push("pnpm release:check", "pnpm deploy:check");
  }
  if (normalizedChanges.includes("adapter")) {
    base.requiredEvidence.push("Adapter contract evidence for success, failure, and cancellation paths.");
  }
  if (["high", "critical"].includes(normalizedRisk)) {
    base.requiredEvidence.push("Residual risks and missing test gaps are recorded.");
    base.commands.push("pnpm github:check:issues");
  }
  return {
    ...base,
    requiredEvidence: uniqueStrings(base.requiredEvidence),
    commands: uniqueStrings(base.commands),
    manualEvidence: uniqueStrings(base.manualEvidence),
    skillGuidance: uniqueStrings(base.skillGuidance),
  };
}

function inferChangeType(files) {
  return inferChangeTypes(files)[0] ?? "docs";
}

function inferChangeTypes(files) {
  const normalizedFiles = (files ?? []).map((file) => normalizePath(file).toLowerCase());
  const changes = [];
  const add = (change) => {
    if (!changes.includes(change)) changes.push(change);
  };
  if (normalizedFiles.some((file) => file.startsWith("apps/web/"))) add("web");
  if (normalizedFiles.some((file) => file.startsWith("apps/desktop/") || file.includes("desktop") || file.includes("local-execution"))) add("desktop");
  if (normalizedFiles.some((file) => file.startsWith("apps/server/"))) add("server");
  if (normalizedFiles.some((file) => file.startsWith("packages/protocol/") || file.includes("state-machine") || file.includes("schema") || file.includes("protocol"))) add("protocol");
  if (normalizedFiles.some((file) => /security|auth|credential|secret|privacy|data-governance|data-retention|billing|cost|quota/.test(file))) add("security");
  if (normalizedFiles.some((file) => file.startsWith("tools/release/") || file.startsWith("tools/deploy/") || file.includes("release") || file.includes("deploy") || file.includes("rollback"))) add("release");
  if (normalizedFiles.some((file) => file.startsWith("packages/adapters/") || file.includes("adapter") || file.includes("coding-wrapper"))) add("adapter");
  if (normalizedFiles.length === 0 || normalizedFiles.some((file) => file.startsWith("docs/") || file.startsWith(".github/"))) add("docs");
  return normalizeChangeTypes(changes);
}

function normalizeChangeTypes(changes) {
  const order = ["docs", "web", "server", "desktop", "protocol", "security", "release", "adapter"];
  const normalized = uniqueStrings((changes ?? []).map((change) => normalizeLabelValue(change)).filter(Boolean));
  const known = order.filter((change) => normalized.includes(change));
  const unknown = normalized.filter((change) => !order.includes(change));
  return [...known, ...unknown].length > 0 ? [...known, ...unknown] : ["docs"];
}

function parseChangeList(value) {
  if (!value) return undefined;
  return value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
}

function uniqueStrings(items) {
  return [...new Set(items.filter(Boolean))];
}

function inferRiskLevel(plan) {
  const text = `${plan?.summary ?? ""}\n${(plan?.risks ?? []).join("\n")}\n${(plan?.steps ?? []).join("\n")}`.toLowerCase();
  if (/critical|production|billing|credential|secret|security|local execution|delete|destructive/.test(text)) return "high";
  if (/risk|permission|data|deploy|release|desktop|adapter|migration/.test(text)) return "medium";
  return "low";
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

function statusPath(line) {
  const path = line.replace(/^.{1,2}\s+/, "").trim();
  const rename = path.match(/^.+\s+->\s+(.+)$/);
  return rename?.[1] ?? path;
}

function markdownSection(content, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?:\\n##\\s+|$)`, "i"));
  return match?.[1]?.trim() ?? "";
}

function markdownListSection(content, heading) {
  return markdownSection(content, heading)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*-\s+/, "").trim())
    .filter(Boolean);
}

function markdownChecklistSection(content, heading) {
  return markdownSection(content, heading)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*-\s+\[[ x]\]\s+/i, "").replace(/^\s*-\s+/, "").trim())
    .filter(Boolean);
}

function markdownListAfter(content, marker) {
  const index = content.indexOf(marker);
  if (index === -1) return [];
  return content
    .slice(index + marker.length)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*-\s+/, "").trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("##"));
}

function parseProjectFieldsFromText(content) {
  const fields = {};
  const section = markdownSection(content, "Project Fields");
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z ]+):\s*(.+?)\s*$/);
    if (!match) continue;
    const rawKey = match[1].trim().toLowerCase();
    const key = rawKey === "agent target" ? "agentTarget" : rawKey === "source doc" ? "sourceDoc" : rawKey.replace(/\s+([a-z])/g, (_, letter) => letter.toUpperCase());
    fields[key] = match[2].trim();
  }
  return fields;
}

function parseProductFlowFromText(content) {
  const fields = {};
  const section = markdownSection(content, "Product Flow");
  const keyMap = {
    "role flow": "roleFlow",
    scenario: "scenario",
    frequency: "frequency",
    "owner surface": "ownerSurface",
    "usability task": "usabilityTask",
    "what not to show": "whatNotToShow",
    "partial acceptance or follow-up": "partialAcceptanceOrFollowUp",
  };
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^\s*-?\s*([A-Za-z ]+(?:or follow-up)?):\s*(.+?)\s*$/);
    if (!match) continue;
    const key = keyMap[match[1].trim().toLowerCase()];
    if (key) fields[key] = match[2].trim();
  }
  return fields;
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function stringArrayOr(value, fallback) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : fallback;
}

function buildBranchName(issue, title, kind) {
  const slug = slugify(title).slice(0, 48).replace(/-+$/g, "");
  return sanitizeBranch(`${kind}/issue-${issue}-${slug}`);
}

function sanitizeBranch(branch) {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+$/g, "")
    .slice(0, 96);
}

function slugify(text) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "work"
  );
}

function checklist(items) {
  return items.length > 0 ? items.map((item) => `- [ ] ${item}`).join("\n") : "- [ ] TODO";
}

function list(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None.";
}

function orderedList(items) {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item}`).join("\n") : "1. TODO";
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



