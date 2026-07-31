import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { parseArgs } from "../batch-chain-penetration.mjs";

test("batch-chain options default to the complete five-scenario matrix", () => {
  const options = parseArgs([]);
  assert.deepEqual(options.scenarioNames, [
    "baseline",
    "desktop_kill_running",
    "server_kill_running",
    "server_kill_verifying",
    "double_restart_idempotency",
  ]);
  assert.equal(options.keepArtifacts, false);
});

test("batch-chain options accept a deduplicated subset and report path", () => {
  const options = parseArgs([
    "--scenario", "baseline,server_kill_running,baseline",
    "--report", "tmp/batch-chain.json",
    "--keep-artifacts",
  ]);
  assert.deepEqual(options.scenarioNames, ["baseline", "server_kill_running"]);
  assert.equal(options.keepArtifacts, true);
  assert.equal(
    options.reportPath,
    fileURLToPath(new URL("../../../tmp/batch-chain.json", import.meta.url)),
  );
});

test("batch-chain options reject missing and unknown scenarios", () => {
  assert.throws(() => parseArgs(["--scenario"]), /requires a name/);
  assert.throws(() => parseArgs(["--scenario", "unknown"]), /Unknown scenario/);
  assert.throws(() => parseArgs(["--report"]), /requires a path/);
});
