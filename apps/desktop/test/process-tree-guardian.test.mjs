import assert from "node:assert/strict";
import { test } from "node:test";

import { startProcessTreeGuardian } from "../src/process-tree-guardian.mjs";

let pty;
try {
  pty = await import("node-pty");
} catch {
  pty = null;
}

test("process-tree guardian reaps a real node-pty when its Bridge parent disappears", {
  skip: !pty || (process.platform === "win32" && Boolean(process.env.CODEX_PERMISSION_PROFILE)),
  timeout: 10_000,
}, async () => {
  const command = process.platform === "win32" ? process.execPath : "/bin/sh";
  const args = process.platform === "win32"
    ? ["-e", "setInterval(() => {}, 1000)"]
    : ["-c", "while :; do sleep 1; done"];
  const child = pty.spawn(command, args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env,
  });
  const exited = new Promise((resolve) => child.onExit((event) => resolve(event)));
  const guardian = startProcessTreeGuardian(child, {
    parentPid: 2_147_483_647,
    pollIntervalMs: 50,
    detached: false,
    stdio: "inherit",
  });
  try {
    const outcome = await Promise.race([
      exited.then((event) => ({ exited: true, event })),
      new Promise((resolve) => setTimeout(() => resolve({ exited: false }), 5_000)),
    ]);
    assert.equal(outcome.exited, true, `guardian must terminate node-pty ${child.pid}`);
  } finally {
    try { child.kill(); } catch { /* best-effort test cleanup */ }
    try { guardian?.kill(); } catch { /* best-effort test cleanup */ }
  }
});

test("managed terminal creation wires every node-pty child to the guardian", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/index.mjs", import.meta.url), "utf8");
  const createPtySession = source.slice(
    source.indexOf("async function createPtySession"),
    source.indexOf("async function postTerminalEvent"),
  );
  assert.match(createPtySession, /const child = pty\.spawn[\s\S]*startProcessTreeGuardian\(child\)/);
});
