import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("two real terminal processes pair independently and rotate one observer token without migration", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "two-terminal-pilot-"));
  const firstPort = await freePort();
  const secondPort = await freePort();
  const consolePort = await freePort();
  const firstPath = join(root, "first");
  const secondPath = join(root, "second");
  await mkdir(firstPath); await mkdir(secondPath);
  let first = terminalProcess(firstPort, firstPath, "first-observer-token-0000001");
  const second = terminalProcess(secondPort, secondPath, "second-observer-token-000001");
  t.after(() => { first.kill(); second.kill(); });
  await Promise.all([waitFor(`http://127.0.0.1:${firstPort}/health`), waitFor(`http://127.0.0.1:${secondPort}/health`)]);

  let consoleProcess = compositionProcess(consolePort, root, firstPort, secondPort, "first-observer-token-0000001");
  t.after(() => consoleProcess.kill());
  await waitFor(`http://127.0.0.1:${consolePort}/health`);
  let overview = await overviewAt(consolePort);
  assert.deepEqual(overview.terminals.map((row) => row.status), ["online", "online"]);

  first.kill();
  await exited(first);
  const rotatedPath = join(root, "first-rotated");
  await mkdir(rotatedPath);
  first = terminalProcess(firstPort, rotatedPath, "first-observer-token-0000002");
  await waitFor(`http://127.0.0.1:${firstPort}/health`);
  overview = await overviewAt(consolePort);
  assert.equal(overview.terminals.find((row) => row.id === "first").status, "offline");
  assert.equal(overview.terminals.find((row) => row.id === "second").status, "online");
  assert.equal(overview.terminals.find((row) => row.id === "second").tasks.length, 0, "owner work is not migrated");

  consoleProcess.kill();
  await exited(consoleProcess);
  consoleProcess = compositionProcess(consolePort, root, firstPort, secondPort, "first-observer-token-0000002");
  await waitFor(`http://127.0.0.1:${consolePort}/health`);
  overview = await overviewAt(consolePort);
  assert.deepEqual(overview.terminals.map((row) => row.status), ["online", "online"]);
});

function terminalProcess(port, projectPath, observerToken) {
  return spawn(process.execPath, ["../server/src/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env, SERVER_PORT: String(port), MYAGENTTOOL_STATE_DISABLED: "1",
      MYAGENTTOOL_PROJECT_PATH: projectPath, MYAGENTTOOL_OBSERVER_TOKEN: observerToken,
    },
    stdio: "ignore",
  });
}

function compositionProcess(port, root, firstPort, secondPort, firstToken) {
  return spawn(process.execPath, ["src/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env, MULTI_TERMINAL_PORT: String(port),
      MULTI_TERMINAL_REGISTRY_PATH: join(root, "registry.json"),
      MULTI_TERMINAL_RECOVERY_PATH: join(root, "recovery.json"),
      MULTI_TERMINAL_AUDIT_PATH: join(root, "audit.json"),
      MULTI_TERMINAL_SLO_PATH: join(root, "slo.json"),
      FIRST_TOKEN: firstToken, SECOND_TOKEN: "second-observer-token-000001",
      MULTI_TERMINALS_JSON: JSON.stringify([
        { id: "first", name: "First", apiUrl: `http://127.0.0.1:${firstPort}`, consoleUrl: "https://first.example", observerTokenEnv: "FIRST_TOKEN" },
        { id: "second", name: "Second", apiUrl: `http://127.0.0.1:${secondPort}`, consoleUrl: "https://second.example", observerTokenEnv: "SECOND_TOKEN" },
      ]),
    },
    stdio: "ignore",
  });
}

async function overviewAt(port) {
  return fetch(`http://127.0.0.1:${port}/api/overview`).then((response) => response.json());
}
function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}
async function freePort() {
  const server = createServer();
  await listen(server);
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function exited(child) {
  if (child.exitCode != null || child.signalCode != null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}
async function waitFor(url) {
  // The real server imports the full runtime graph. A cold Windows CI worker can
  // need more than five seconds when two terminal processes start together.
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`service did not start: ${url}`);
}
