#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  P414_KNOWN_LIMITATIONS,
  P414_ROLLBACK_POLICY,
  inspectP414CandidateSource,
  projectP414Conclusion,
  runRiskReminderAcceptanceReleaseGate,
} from "./p4-14-evidence.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const checkOnly = process.argv.includes("--check");
const pnpmEntry = process.env.npm_execpath;
const output = resolve(
  root,
  process.env.P4_14_EVIDENCE_OUT ?? `.myagenttool/release-candidate/p4-14-${process.platform}-${process.arch}.json`,
);

const checks = [
  {
    id: "risk-reminder-user-acceptance",
    kind: "riskAcceptance",
    evidence: "R5 aggregated ordinary-user comprehension gate",
  },
  {
    id: "candidate-source",
    kind: "candidateSource",
    evidence: "immutable source commit and clean worktree",
  },
  {
    id: "server-static-check",
    command: process.execPath,
    args: ["./src/index.mjs", "--check"],
    cwd: "apps/server",
    evidence: "server source and protocol static checks",
  },
  {
    id: "data-writeback-security",
    command: process.execPath,
    args: [
      "--test",
      "test/ledger-upserts.test.mjs",
      "test/p4-13-security.test.mjs",
      "test/integration/channel-ledger-mutation-journey.test.mjs",
    ],
    cwd: "apps/server",
    evidence: "P4.10–P4.13 writeback, compensation, recovery, tenancy, and privacy",
  },
  {
    id: "server-typecheck",
    command: pnpmEntry,
    args: ["--filter", "@myagenttool/server", "typecheck"],
    cwd: ".",
    evidence: "server type compatibility",
  },
  {
    id: "web-typecheck",
    command: pnpmEntry,
    args: ["--filter", "@myagenttool/web", "typecheck"],
    cwd: ".",
    evidence: "console type compatibility",
  },
  {
    id: "web-production-build",
    command: pnpmEntry,
    args: ["--filter", "@myagenttool/web", "build"],
    cwd: ".",
    evidence: "production Web bundle",
  },
  {
    id: "release-process-check",
    command: process.execPath,
    args: ["tools/release/src/index.mjs", "--check"],
    cwd: ".",
    evidence: "release process and evidence contract",
  },
  {
    id: "release-candidate-config",
    command: process.execPath,
    args: ["tools/release/src/candidate.mjs", "--check"],
    cwd: ".",
    evidence: "candidate checks and release evidence paths",
  },
  {
    id: "diff-hygiene",
    command: "git",
    args: ["diff", "--check"],
    cwd: ".",
    evidence: "whitespace and patch hygiene",
  },
];

if (checkOnly) {
  if (!pnpmEntry) fail("P4.14 requires execution through pnpm so package checks cannot be skipped.");
  for (const check of checks) {
    if ((!check.command && !check.kind) || (check.cwd && !existsSync(resolve(root, check.cwd)))) {
      fail(`P4.14 check is not runnable: ${check.id}`);
    }
  }
  console.log(`P4.14 release gate configuration OK (${checks.length} checks).`);
  process.exit(0);
}

if (!pnpmEntry) fail("P4.14 requires execution through pnpm.");
const startedAt = new Date().toISOString();
const results = [];
const candidateSource = inspectP414CandidateSource({ repoRoot: root });
for (const check of checks) {
  let checkResult;
  if (check.kind === "riskAcceptance") {
    checkResult = runRiskReminderAcceptanceReleaseGate({
      evidencePath: process.env.P4_14_RISK_ACCEPTANCE_FILE,
      expectedProductCommit: candidateSource.source.commit,
    });
  } else if (check.kind === "candidateSource") {
    checkResult = candidateSource;
  } else {
    const started = Date.now();
    const result = spawnSync(check.command, check.args, {
      cwd: resolve(root, check.cwd),
      encoding: "utf8",
      windowsHide: true,
      timeout: Number(process.env.P4_14_CHECK_TIMEOUT_MS ?? 10 * 60 * 1000),
    });
    const outputText = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const passed = result.status === 0 && !result.error;
    checkResult = {
      id: check.id,
      status: passed ? "passed" : "failed",
      evidence: check.evidence,
      command: [check.command, ...check.args].join(" "),
      durationMs: Date.now() - started,
      error: result.error?.message ?? null,
      output: outputText.slice(-3_000),
    };
  }
  results.push(checkResult);
  const passed = checkResult.status === "passed";
  console.log(`[p4.14] ${passed ? "PASS" : "FAIL"} ${check.id}`);
  if (!passed) break;
}

const passed = results.length === checks.length && results.every((item) => item.status === "passed");
const source = candidateSource.source;
const manifest = {
  schemaVersion: 2,
  gate: "P4.14",
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  commit: source?.commit ?? null,
  worktreeState: source?.worktreeState ?? "not_checked",
  startedAt,
  completedAt: new Date().toISOString(),
  status: passed ? "passed" : "failed",
  conclusion: projectP414Conclusion(passed),
  knownLimitations: P414_KNOWN_LIMITATIONS,
  rollback: P414_ROLLBACK_POLICY,
  results,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(`[p4.14] ${manifest.status}: ${output}`);
if (manifest.status !== "passed") process.exit(1);

function fail(message) {
  console.error(`[p4.14] ERROR: ${message}`);
  process.exit(1);
}
