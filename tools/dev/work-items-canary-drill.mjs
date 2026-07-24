import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const root = mkdtempSync(join(tmpdir(), "myagenttool-work-items-canary-"));
const steps = [];

try {
  run("release_preflight", ["tools/dev/work-items-preflight.mjs"], {
    MYAGENT_REQUIRE_AUTH: "1",
    MYAGENTTOOL_GITHUB_WEBHOOK_SECRET: "canary-secret-0123456789abcdef0123456789",
    MYAGENTTOOL_STATE_PATH: join(root, "state", "canary.json"),
    MYAGENTTOOL_STORE: "sqlite",
  });
  run("capacity_gate", ["tools/dev/work-items-capacity-benchmark.mjs"]);
  run("authenticated_single_team_http", [
    "--test", "apps/server/test/integration/work-items-http.test.mjs",
  ]);
  run("backup_restore_and_tenancy", [
    "--test",
    "apps/server/test/work-items.test.mjs",
    "apps/server/test/planning-projects.test.mjs",
    "apps/server/test/tenancy-persistence.test.mjs",
  ]);
} finally {
  rmSync(root, { recursive: true, force: true });
}

const passed = steps.every((step) => step.status === "passed");
console.log(JSON.stringify({
  schemaVersion: 1,
  kind: "local_single_team_canary_rehearsal",
  passed,
  externalDeploymentPerformed: false,
  steps,
}, null, 2));
if (!passed) process.exitCode = 1;

function run(name, args, extraEnv = {}) {
  const started = performance.now();
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    timeout: 120_000,
  });
  const durationMs = Math.round((performance.now() - started) * 100) / 100;
  const status = result.status === 0 ? "passed" : "failed";
  steps.push({
    name, status, durationMs,
    exitCode: result.status,
    summary: summarize(result.stdout, result.stderr),
  });
}

function summarize(stdout, stderr) {
  const text = `${stdout ?? ""}\n${stderr ?? ""}`.trim();
  return text.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ").slice(0, 1_000);
}
