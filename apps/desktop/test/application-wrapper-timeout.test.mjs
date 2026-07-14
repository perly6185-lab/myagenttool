import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const wrapper = resolve(dirname(fileURLToPath(import.meta.url)), "../../../tools/agents/application-wrapper.mjs");

test("the wrapper kills a command that exceeds its timeout, fast (#907)", () => {
  const started = Date.now();
  // A portable 10s-hanging child; the wrapper must SIGKILL it at 300ms.
  const res = spawnSync(process.execPath, [
    wrapper,
    "--capability", "test",
    "--timeout-ms", "300",
    "--exec-command", process.execPath,
    "--exec-arg", "-e",
    "--exec-arg", "setTimeout(() => {}, 10000)",
  ], { encoding: "utf8", timeout: 8000 });

  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5000, `should time out well before the child's 10s (took ${elapsed}ms)`);
  assert.notEqual(res.status, 0, "a timed-out run fails");
  assert.match(`${res.stdout}${res.stderr}`, /timed out after 300ms/);
});
