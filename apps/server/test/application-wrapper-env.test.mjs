/*
 * The application-wrapper runner must force OFFICECLI_RESIDENT_FLUSH=each for
 * officecli invocations so a governed write is durable on disk before the runner
 * returns — otherwise officecli's resident defers the save and a promote right
 * after can capture stale content. Other wrappers (git/ccusage) must be untouched.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { copyFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveWrapperChildEnv } from "../../../tools/agents/application-wrapper-env.mjs";

const RUNNER = fileURLToPath(new URL("../../../tools/agents/application-wrapper.mjs", import.meta.url));

test("resolveWrapperChildEnv sets flush for officecli only", () => {
  const base = { PATH: "/usr/bin", FOO: "bar" };
  assert.equal(resolveWrapperChildEnv("officecli", base).OFFICECLI_RESIDENT_FLUSH, "each");
  assert.equal(resolveWrapperChildEnv("/opt/tools/officecli", base).OFFICECLI_RESIDENT_FLUSH, "each");
  assert.equal(resolveWrapperChildEnv("C:\\bin\\officecli.exe", base).OFFICECLI_RESIDENT_FLUSH, "each");
  // untouched for other wrappers
  assert.equal(resolveWrapperChildEnv("git", base).OFFICECLI_RESIDENT_FLUSH, undefined);
  assert.equal(resolveWrapperChildEnv("ccusage", base).OFFICECLI_RESIDENT_FLUSH, undefined);
  // a command merely containing the substring is not the binary
  assert.equal(resolveWrapperChildEnv("officecli-helper", base).OFFICECLI_RESIDENT_FLUSH, undefined);
  // base env is preserved, not mutated
  assert.equal(resolveWrapperChildEnv("officecli", base).FOO, "bar");
  assert.equal(base.OFFICECLI_RESIDENT_FLUSH, undefined);
});

function runRunner(execCommand, execArgs = []) {
  return new Promise((resolve) => {
    const args = [
      RUNNER,
      "--exec-command",
      execCommand,
      ...execArgs.flatMap((arg) => ["--exec-arg", arg]),
    ];
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.on("close", () => resolve(stdout));
  });
}

// End-to-end: the runner spawns a fake binary named `officecli` that echoes the
// flush env var; the value must be `each`. A differently-named binary must not
// receive it — proving the gate is on the command, forwarded through the spawn.
test("runner forwards flush=each to an officecli-named child only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wrapenv-"));
  const script = '#!/usr/bin/env node\nprocess.stdout.write("FLUSH=" + (process.env.OFFICECLI_RESIDENT_FLUSH ?? "unset"));\n';
  try {
    if (process.platform === "win32") {
      // Windows cannot execute a shebang-only extensionless file. Use copies of
      // the current Node executable so the command basename remains the behavior
      // under test, and pass the shared script as its first argument.
      const scriptPath = join(dir, "echo-env.mjs");
      const officecli = join(dir, "officecli.exe");
      const other = join(dir, "gitlike.exe");
      writeFileSync(scriptPath, script);
      copyFileSync(process.execPath, officecli);
      copyFileSync(process.execPath, other);
      assert.match(await runRunner(officecli, [scriptPath]), /FLUSH=each/);
      assert.match(await runRunner(other, [scriptPath]), /FLUSH=unset/);
      return;
    }

    const officecli = join(dir, "officecli");
    const other = join(dir, "gitlike");
    writeFileSync(officecli, script);
    writeFileSync(other, script);
    chmodSync(officecli, 0o755);
    chmodSync(other, 0o755);
    assert.match(await runRunner(officecli), /FLUSH=each/);
    assert.match(await runRunner(other), /FLUSH=unset/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
