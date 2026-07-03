/*
 * #359 Slice C end-to-end (argv contract): the args the bridge injects
 * (application-wrapper-args) must be exactly what the runner
 * (tools/agents/application-wrapper.mjs) parses and executes. This runs the real
 * runner with the real injected argv — proving Slice C → Slice A compose — using
 * a harmless `node -e` as the resolved command (no live server/bridge needed).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { applicationWrapperArgs } from "../src/application-wrapper-args.mjs";

const RUNNER = fileURLToPath(new URL("../../../tools/agents/application-wrapper.mjs", import.meta.url));

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.on("close", (code) => resolve({ code, stdout }));
  });
}

test("bridge-injected argv runs through the real runner and yields a structured result", async () => {
  // What the bridge would build for a resolved capability command.
  const injected = applicationWrapperArgs([RUNNER], {
    options: { metadata: { applicationWrapper: {
      execCommand: process.execPath,
      execArgs: ["-e", "console.log(JSON.stringify({rows:2}))"],
      capability: "app.app_ccusage.wrapper.daily",
    } } },
  });
  const { code, stdout } = await run(injected);
  assert.equal(code, 0);
  const result = JSON.parse(stdout.split(/\r?\n/).find((l) => l.startsWith("RESULT ")).slice("RESULT ".length));
  assert.equal(result.output.source, "application");
  assert.equal(result.output.capability, "app.app_ccusage.wrapper.daily");
  assert.deepEqual(result.output.report, { rows: 2 });
});
