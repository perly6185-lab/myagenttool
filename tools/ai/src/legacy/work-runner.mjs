import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CODING_ADAPTERS,
  CODING_ADAPTER_CONTRACT_VERSION,
  STANDARD_VERIFICATION_COMMANDS,
} from "./config.mjs";
import {
  buildScopeCheckResult,
  formatScopeCheck,
  formatTestingPlan,
  inferChangeTypes,
  inferRiskLevel,
  testingPlanFor,
} from "./scope-testing.mjs";
import { assessChanges, classifyKind, parseNameStatus, renderImpactMarkdown } from "../impact.mjs";

const workRunnerContext = {};

export function configureWorkRunnerContext(context) {
  Object.assign(workRunnerContext, context);
}

function dep(name) {
  const value = workRunnerContext[name];
  if (!value) throw new Error(`Work runner dependency ${name} has not been configured.`);
  return value;
}

export async function runWork(args) {
  const option = dep("option");
  const fail = dep("fail");
  const repoRoot = dep("repoRoot");
  const issue = option(args, "--issue");
  if (!issue) fail("Missing --issue.");

  const apply = args.includes("--apply");
  const openPr = args.includes("--open-pr");
  const verify = apply && !args.includes("--skip-verify");
  const repo = option(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? dep("defaultRepo")();
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-issue-${issue}`;
  const runDir = resolve(repoRoot, ".myagenttool/runs", runId);
  const contextFile = resolve(runDir, "context.json");
  const adapter = resolveCodingAdapter(args);
  mkdirSync(runDir, { recursive: true });
  const createdAt = new Date().toISOString();
  let entry = dep("createLoopRegistryEntry")({
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
  dep("upsertLoopRegistryEntry")(entry);
  dep("appendLoopEvent")(entry, "loop_run_created", "created", "Loop run registered.", { apply, verify, openPr, repo, adapter: adapter.name, branch: "" });

  try {
    entry = dep("updateLoopRun")(entry, { state: "planning" }, "Planning issue work.");
    const plan = await dep("createCodePlan")(args);
    const branch = dep("sanitizeBranch")(plan.branch || dep("buildBranchName")(issue, `issue-${issue}`, "feat"));
    entry = dep("updateLoopRun")(entry, { branch });

    writeFileSync(resolve(runDir, "code-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    entry = dep("updateLoopEvidence")(entry, { codePlan: dep("loopRunPath")(runId, "code-plan.json") });
    dep("appendLoopEvent")(entry, "loop_plan_written", "planning", "Code plan written.", { path: entry.evidence.codePlan });

    writeFileSync(contextFile, `${JSON.stringify(workContext({ issue, repo, branch, plan, runId, adapter }), null, 2)}\n`, "utf8");
    writeFileSync(resolve(runDir, "coding-adapter-contract.json"), `${JSON.stringify(codingAdapterContractJson(adapter), null, 2)}\n`, "utf8");
    entry = dep("updateLoopEvidence")(entry, { adapterContract: dep("loopRunPath")(runId, "coding-adapter-contract.json") });
    dep("appendLoopEvent")(entry, "loop_adapter_contract_written", "planning", "Coding adapter contract written.", { path: entry.evidence.adapterContract });

    const testPlan = testingPlanFor({ changes: inferChangeTypes(plan.filesToTouch), risk: inferRiskLevel(plan) });
    writeFileSync(resolve(runDir, "testing-plan.json"), `${JSON.stringify(testPlan, null, 2)}\n`, "utf8");
    writeFileSync(resolve(runDir, "testing-plan.md"), formatTestingPlan(testPlan), "utf8");
    entry = dep("updateLoopEvidence")(entry, {
      testingPlan: dep("loopRunPath")(runId, "testing-plan.md"),
      testingPlanJson: dep("loopRunPath")(runId, "testing-plan.json"),
    });
    dep("appendLoopEvent")(entry, "loop_testing_plan_written", "planning", "Testing skills plan written.", { changes: testPlan.changes, risk: testPlan.risk });

    writeFileSync(resolve(runDir, "manifest.md"), formatRunManifest({ issue, repo, plan, apply, adapter, verify, openPr, testPlan }), "utf8");
    entry = dep("updateLoopEvidence")(entry, { manifest: dep("loopRunPath")(runId, "manifest.md") });
    dep("appendLoopEvent")(entry, "loop_manifest_written", "planning", "Run manifest written.", { path: entry.evidence.manifest });
    entry = dep("updateLoopRun")(entry, { state: "planned" }, "Loop run planned.");

    if (!apply) {
      console.log(`AI work dry-run created .myagenttool/runs/${runId}`);
      console.log("Re-run with --apply to create the branch, run the trusted coding adapter, verify, and optionally open a PR.");
      return;
    }

    entry = dep("updateLoopRun")(entry, { state: "applying" }, "Apply mode started.");
    dep("ensureCleanWorktree")();
    dep("runCommand")("git", ["switch", "-c", branch], { label: `create branch ${branch}` });

    entry = dep("updateLoopRun")(entry, { state: "running_adapter" }, `Running ${adapter.name} coding adapter.`);
    dep("appendLoopEvent")(entry, "loop_adapter_started", "running_adapter", "Coding adapter started.", { adapter: adapter.name });
    const adapterResult = runCodingAdapter({ args, adapter, issue, repo, branch, plan, runId, runDir, contextFile });
    writeFileSync(resolve(runDir, "coding-adapter-result.json"), `${JSON.stringify(adapterResult.summary, null, 2)}\n`, "utf8");
    entry = dep("updateLoopEvidence")(entry, { adapterResult: dep("loopRunPath")(runId, "coding-adapter-result.json") });
    dep("appendLoopEvent")(entry, "loop_adapter_completed", "running_adapter", "Coding adapter completed.", { status: adapterResult.summary.status, changedFiles: adapterResult.summary.changedFiles });

    entry = dep("updateLoopRun")(entry, { state: "checking_scope" }, "Checking scope drift.");
    const scopeResult = buildScopeCheckResult({ plan, planFile: `.myagenttool/runs/${runId}/code-plan.json`, base: "HEAD", allowDrift: option(args, "--allow-drift") ?? "" });
    writeFileSync(resolve(runDir, "scope-check.json"), `${JSON.stringify(scopeResult, null, 2)}\n`, "utf8");
    writeFileSync(resolve(runDir, "scope-check.md"), formatScopeCheck(scopeResult), "utf8");
    entry = dep("updateLoopEvidence")(entry, {
      scopeCheck: dep("loopRunPath")(runId, "scope-check.md"),
      scopeCheckJson: dep("loopRunPath")(runId, "scope-check.json"),
    });
    dep("appendLoopEvent")(entry, "loop_scope_checked", "checking_scope", "Scope drift checked.", { allowed: scopeResult.allowed, driftLevel: scopeResult.driftLevel });
    if (!scopeResult.allowed) {
      if (scopeResult.driftLevel === "high") {
        const gate = dep("createLoopHumanGate")({
          reason: "High scope drift requires human approval.",
          risk: "high",
          scope: `Scope drift level ${scopeResult.driftLevel}`,
          requestedAction: "Approve scope drift or reduce the diff.",
          requestedBy: "work-runner",
          expiresAt: null,
          evidence: entry.evidence.scopeCheck,
        });
        entry = dep("applyLoopHumanGate")(entry, gate, "Human approval required for scope drift.");
      }
      throw new Error(`Scope or Product Flow drift is not allowed. See .myagenttool/runs/${runId}/scope-check.md.`);
    }

    // Change Impact & Risk Assessment — auto-generated on every apply, written as
    // run evidence and (when a PR opens) folded into the PR body + the issue.
    const impactMarkdown = buildImpactAssessment({ commandOutput: dep("commandOutput"), scopeResult });
    writeFileSync(resolve(runDir, "impact.md"), impactMarkdown, "utf8");
    entry = dep("updateLoopEvidence")(entry, { impact: dep("loopRunPath")(runId, "impact.md") });
    dep("appendLoopEvent")(entry, "loop_impact_assessed", entry.state, "Change impact assessed.", { path: entry.evidence.impact });

    if (verify) {
      entry = dep("updateLoopRun")(entry, { state: "verifying" }, "Running repository verification.");
      const verification = runVerification();
      writeFileSync(resolve(runDir, "verification.md"), verification, "utf8");
      entry = dep("updateLoopEvidence")(entry, { verification: dep("loopRunPath")(runId, "verification.md") });
      dep("appendLoopEvent")(entry, "loop_verification_completed", "verifying", "Repository verification completed.", { path: entry.evidence.verification });
    }

    if (openPr) {
      if (!repo) throw new Error("Cannot open PR without --repo or GITHUB_REPOSITORY.");
      const body = formatPrBody({ issue, plan, runId, adapter, verified: verify, testPlan, scopeResult, impactMarkdown });
      writeFileSync(resolve(runDir, "pr-body.md"), body, "utf8");
      entry = dep("updateLoopEvidence")(entry, { prBody: dep("loopRunPath")(runId, "pr-body.md") });
      dep("appendLoopEvent")(entry, "loop_pr_requested", entry.state, "Opening pull request.", { path: entry.evidence.prBody });
      dep("runGh")(["pr", "create", "--repo", repo, "--title", plan.prSummary || `Work for #${issue}`, "--body", body]);
      // Mirror the impact assessment onto the linked issue (write-back convention).
      if (issue) {
        dep("runGh")(["issue", "comment", String(issue), "--repo", repo, "--body", impactMarkdown]);
      }
    }

    entry = dep("updateLoopRun")(entry, { state: "completed" }, "Loop run completed.");
    dep("appendLoopEvent")(entry, "loop_completed", "completed", "Loop run completed.", { manifest: entry.evidence.manifest });
    console.log(`AI work apply completed. Manifest: .myagenttool/runs/${runId}/manifest.md`);
  } catch (error) {
    const message = error?.message || String(error);
    entry = dep("updateLoopRun")(entry, { state: "failed", lastError: message }, "Loop run failed.");
    dep("appendLoopEvent")(entry, "loop_failed", "failed", message, {});
    throw error;
  }
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

${dep("formatCodePlan")(plan)}

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
      cwd: dep("repoRoot"),
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

export function resolveCodingAdapter(args) {
  const option = dep("option");
  const fail = dep("fail");
  const requested = (option(args, "--coding-adapter") ?? option(args, "--adapter") ?? process.env.MYAGENTTOOL_CODING_ADAPTER ?? "mock").toLowerCase();
  const adapter = CODING_ADAPTERS[requested];
  if (!adapter) {
    fail(`Unsupported coding adapter: ${requested}. Supported adapters: ${Object.keys(CODING_ADAPTERS).join(", ")}`);
  }
  return adapter;
}

export function codingAdapterContractJson(adapter) {
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
    cwd: dep("repoRoot"),
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
  const option = dep("option");
  const fail = dep("fail");
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

// Assess the working-tree diff (post-adapter) with the shared ai:impact core.
// Matches scope-check's source (git diff vs HEAD + untracked); falls back to
// scope-check's file list if the adapter already committed.
export function buildImpactAssessment({ commandOutput, scopeResult }) {
  const changes = parseNameStatus(commandOutput("git", ["diff", "--name-status", "HEAD", "--"]));
  for (const line of commandOutput("git", ["ls-files", "--others", "--exclude-standard"]).split(/\r?\n/)) {
    const path = line.trim();
    if (path && !changes.some((c) => c.path === path)) {
      changes.push({ path, change: "add", kind: classifyKind(path) });
    }
  }
  if (changes.length === 0 && Array.isArray(scopeResult?.changedFiles)) {
    for (const path of scopeResult.changedFiles) {
      changes.push({ path, change: "edit", kind: classifyKind(path) });
    }
  }
  return renderImpactMarkdown(assessChanges(changes), { note: "Auto-generated by ai:impact in run-work." });
}

export function formatPrBody({ issue, plan, runId, adapter, verified, testPlan, scopeResult, impactMarkdown }) {
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

${dep("formatProductFlow")(plan.productFlow)}

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

${impactMarkdown ?? "## Change Impact & Risk Assessment\n\n- (not generated)"}
AI work manifest: .myagenttool/runs/${runId}/manifest.md
Coding adapter: ${adapter?.name ?? "unknown"}
Coding adapter result: .myagenttool/runs/${runId}/coding-adapter-result.json
Coding adapter contract: .myagenttool/runs/${runId}/coding-adapter-contract.json
Scope drift evidence: ${scopeResult ? `.myagenttool/runs/${runId}/scope-check.md` : "not generated"}
Testing skills evidence: .myagenttool/runs/${runId}/testing-plan.md
Verification evidence: ${verified ? `.myagenttool/runs/${runId}/verification.md` : "not generated"}
`;
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArrayOr(value, fallback) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : fallback;
}

function list(items) {
  if (!items || items.length === 0) return "- None.";
  return items.map((item) => `- ${item}`).join("\n");
}
