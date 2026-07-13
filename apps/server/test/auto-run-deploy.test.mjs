/*
 * The deploy stage runner (D1): env command resolution, timeout clamp, outcome
 * contract, and the spawn semantics — exit code is the success signal, a zero-exit
 * stdout can veto, and a command that can't run is an infra miss (null), distinct
 * from a real failed deploy.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveDeployCommand, deployTimeoutMs, normalizeDeployResult, runDeployCommand, resolveRollbackCommand, rollbackTimeoutMs } from "../src/services/auto-run-deploy.mjs";

test("resolveDeployCommand parses a valid argv array, rejects junk", () => {
  assert.deepEqual(resolveDeployCommand({ MYAGENTTOOL_AUTORUN_DEPLOY_COMMAND_JSON: '["node","deploy.mjs"]' }), ["node", "deploy.mjs"]);
  assert.equal(resolveDeployCommand({}), null);
  assert.equal(resolveDeployCommand({ MYAGENTTOOL_AUTORUN_DEPLOY_COMMAND_JSON: "not json" }), null);
  assert.equal(resolveDeployCommand({ MYAGENTTOOL_AUTORUN_DEPLOY_COMMAND_JSON: "[]" }), null, "empty array rejected");
  assert.equal(resolveDeployCommand({ MYAGENTTOOL_AUTORUN_DEPLOY_COMMAND_JSON: '["ok",""]' }), null, "empty element rejected");
});

test("deployTimeoutMs clamps to a sane range, defaults to 5 min", () => {
  assert.equal(deployTimeoutMs({}), 300_000);
  assert.equal(deployTimeoutMs({ MYAGENTTOOL_AUTORUN_DEPLOY_TIMEOUT_MS: "60000" }), 60_000);
  assert.equal(deployTimeoutMs({ MYAGENTTOOL_AUTORUN_DEPLOY_TIMEOUT_MS: "999" }), 300_000, "below floor -> default");
  assert.equal(deployTimeoutMs({ MYAGENTTOOL_AUTORUN_DEPLOY_TIMEOUT_MS: "99999999" }), 300_000, "above ceiling -> default");
});

test("normalizeDeployResult shapes the stdout contract", () => {
  assert.equal(normalizeDeployResult(null), null);
  assert.equal(normalizeDeployResult([1]), null);
  assert.deepEqual(normalizeDeployResult({ deployed: true, summary: "ok" }), { deployed: true, summary: "ok" });
  assert.deepEqual(normalizeDeployResult({ deployed: "yes" }), { deployed: false, summary: "" }, "only boolean true is deployed");
});

test("runDeployCommand: exit 0 -> deployed; non-zero -> failed; a zero-exit veto is honored", async () => {
  const ok = await runDeployCommand({ command: ["node", "-e", "process.exit(0)"] });
  assert.deepEqual(ok, { deployed: true, summary: "" }, "a plain exit-0 deploy script counts as deployed");

  const fail = await runDeployCommand({ command: ["node", "-e", "process.exit(3)"] });
  assert.equal(fail.deployed, false);
  assert.match(fail.summary, /exited 3/);

  const veto = await runDeployCommand({ command: ["node", "-e", "console.log(JSON.stringify({deployed:false,summary:'rolled back'}))"] });
  assert.equal(veto.deployed, false, "an explicit {deployed:false} on a zero exit still vetoes");
  assert.equal(veto.summary, "rolled back");

  const detail = await runDeployCommand({ command: ["node", "-e", "console.log(JSON.stringify({deployed:true,summary:'shipped v2'}))"] });
  assert.deepEqual(detail, { deployed: true, summary: "shipped v2" });
});

test("runDeployCommand: a command that can't run resolves to null (infra miss, not a failed deploy)", async () => {
  assert.equal(await runDeployCommand({ command: ["definitely-not-a-real-binary-xyz-123"] }), null);
});

test("runDeployCommand: a hung command is killed at the timeout -> null", async () => {
  const hung = await runDeployCommand({ command: ["node", "-e", "setTimeout(()=>{}, 60000)"], timeoutMs: 300 });
  assert.equal(hung, null);
});

test("resolveRollbackCommand + rollbackTimeoutMs mirror the deploy command (H1)", () => {
  assert.deepEqual(resolveRollbackCommand({ MYAGENTTOOL_AUTORUN_ROLLBACK_COMMAND_JSON: '["node","rb.mjs"]' }), ["node", "rb.mjs"]);
  assert.equal(resolveRollbackCommand({}), null);
  assert.equal(resolveRollbackCommand({ MYAGENTTOOL_AUTORUN_ROLLBACK_COMMAND_JSON: "[]" }), null);
  assert.equal(rollbackTimeoutMs({}), 300_000);
  assert.equal(rollbackTimeoutMs({ MYAGENTTOOL_AUTORUN_ROLLBACK_TIMEOUT_MS: "60000" }), 60_000);
});

test("runDeployCommand: exit 0 with a {summary} but no `deployed` is a SUCCESS (not a false-fail)", async () => {
  const r = await runDeployCommand({ command: ["node", "-e", "console.log(JSON.stringify({summary:'shipped to prod'}))"] });
  assert.equal(r.deployed, true, "an absent `deployed` on exit 0 must not record a failed deploy (would trigger a destructive rollback)");
  assert.equal(r.summary, "shipped to prod");
});

import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("runDeployCommand: a timeout kills the whole process GROUP, not just the direct child (M1)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "deploy-grp-"));
  const marker = join(dir, "grandchild-ran");
  // The deploy command spawns a grandchild that writes `marker` after 1.5s, then
  // the parent hangs. runDeployCommand times out at 300ms and must kill the whole
  // group so the grandchild never writes the marker (detached + process.kill(-pid)).
  const grandchild = `setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'x'),1500)`;
  const script = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'});setTimeout(()=>{},60000)`;
  const out = await runDeployCommand({ command: [process.execPath, "-e", script], timeoutMs: 300 });
  assert.equal(out, null, "timed out → infra miss (null)");
  await new Promise((r) => setTimeout(r, 2200)); // past the grandchild's 1.5s delay
  assert.equal(existsSync(marker), false, "the grandchild was killed with the group and never wrote the marker");
});
