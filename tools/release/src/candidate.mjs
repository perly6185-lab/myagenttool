#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const checkOnly = process.argv.includes("--check");
const outputArg = process.argv.find((arg) => arg.startsWith("--out="));
const outputPath = resolve(repoRoot, outputArg?.slice(6) || `.myagenttool/release-candidate/${process.platform}.json`);
const checkTimeoutMs = Number(process.env.RELEASE_CANDIDATE_CHECK_TIMEOUT_MS ?? 5 * 60 * 1000);

const checks = [
  { id: "descriptor-lineage", command: "node", args: ["--test", "test/ccusage-application.test.mjs", "test/application-git-capability.test.mjs", "test/claude-application.test.mjs"], cwd: "apps/server", evidence: ["immutable descriptor replay/replacement", "Git, ccusage, and Claude generic contract", "Application result evidence lineage"] },
  { id: "device-readiness", command: "node", args: ["--test", "test/application-binary-readiness.test.mjs", "test/local-execution-policy.test.mjs"], cwd: "apps/desktop", evidence: ["allowlist-only binary probe", "missing binary precise refusal"] },
  { id: "recovery-and-approval", command: "node", args: ["--test", "test/approval-grants.test.mjs", "test/application-auto-recovery.test.mjs", "test/pending-decisions.test.mjs"], cwd: "apps/server", evidence: ["strict grants", "parked approval", "bounded recovery"] },
  { id: "economics", command: "node", args: ["--test", "test/model-pricing.test.mjs", "test/usage-quota.test.mjs"], cwd: "apps/server", evidence: ["versioned pricing", "unknown price", "quota refusal"] },
  { id: "delivery-faults", command: "node", args: ["--test", "test/bridge-auth.test.mjs", "test/bridge-liveness.test.mjs"], cwd: "apps/server", evidence: ["reconnect", "credential refusal", "liveness loss"] },
  { id: "durable-restart", command: "node", args: ["--test", "test/persistence.test.mjs"], cwd: "apps/server", evidence: ["snapshot restore", "restart read models", "audit references"] },
  { id: "application-result-loop", command: "node", args: ["tools/dev/ccusage-agent-smoke.mjs"], cwd: ".", evidence: ["Application capability execution", "result import", "public-state redaction"], expectedOutput: ["ccusage-agent-smoke:", "checks passed"] },
  { id: "claude-application-loop", command: "node", args: ["tools/dev/claude-tool-smoke.mjs"], cwd: ".", evidence: ["Claude Application registration", "governed Tool facade execution", "worktree scope", "fixed plan permission mode", "finding import", "Application result evidence", "cost capture"], expectedOutput: ["claude-tool-smoke:", "Application invocation lineage and Evidence Center result are complete", "checks passed"] },
  { id: "m0-process-e2e", command: "node", args: ["tools/dev/m0-acceptance.mjs"], cwd: ".", evidence: ["Web to Server process loop", "Server to Bridge Git Application execution", "Application result import", "Evidence Center projection", "cancellation", "device unlink audit"], expectedOutput: ["M0 manual acceptance evidence OK", "application=", "evidence=", "cancelled=", "unlinked="] },
];

if (checkOnly) {
  for (const check of checks) {
    const cwd = resolve(repoRoot, check.cwd);
    if (!existsSync(cwd)) throw new Error(`Release-candidate cwd missing: ${check.cwd}`);
    for (const arg of check.args.filter((arg) => arg.startsWith("test/"))) {
      if (!existsSync(resolve(cwd, arg))) throw new Error(`Release-candidate test missing: ${check.cwd}/${arg}`);
    }
  }
  console.log(`Release-candidate configuration OK (${checks.length} checks).`);
  process.exit(0);
}

const startedAt = new Date().toISOString();
const results = checks.map((check) => {
  const started = Date.now();
  const result = spawnSync(check.command, check.args, {
    cwd: resolve(repoRoot, check.cwd),
    encoding: "utf8",
    windowsHide: true,
    timeout: checkTimeoutMs,
    killSignal: "SIGTERM",
  });
  const combinedOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const missingOutput = (check.expectedOutput ?? []).filter((marker) => !combinedOutput.includes(marker));
  return {
    id: check.id,
    status: result.status === 0 && missingOutput.length === 0 ? "passed" : "failed",
    durationMs: Date.now() - started,
    evidence: check.evidence,
    command: [check.command, ...check.args].join(" "),
    timedOut: result.error?.code === "ETIMEDOUT",
    error: result.error ? String(result.error.message ?? result.error) : null,
    outputAssertions: (check.expectedOutput ?? []).map((marker) => ({ marker, matched: !missingOutput.includes(marker) })),
    stdout: String(result.stdout ?? "").slice(-4000),
    stderr: String(result.stderr ?? "").slice(-4000),
  };
});
const manifest = { schemaVersion: 1, platform: process.platform, architecture: process.arch, node: process.version, startedAt, completedAt: new Date().toISOString(), status: results.every((item) => item.status === "passed") ? "passed" : "failed", results };
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Release-candidate ${manifest.status}: ${outputPath}`);
if (manifest.status !== "passed") process.exit(1);
