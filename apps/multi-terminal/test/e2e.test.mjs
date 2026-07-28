import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("deployed shell composes the versioned observer API and paginates cross-asset traces", async (t) => {
  const observerToken = "observer-token-at-least-24-characters";
  const terminalServer = createServer((req, res) => {
    assert.equal(req.headers.authorization, `Observer ${observerToken}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      contract: "terminal-observation/v1", namespace: "test", protocolVersion: "1",
      terminal: { id: "studio", status: "online" }, capabilities: [],
      tasks: [{
        id: "wi_1", title: "Excel to PowerPoint", executionState: "failed", updatedAt: "2026-07-25T01:00:00.000Z",
        terminalId: "studio", traceId: "trace_assets",
        inputAssets: [{ family: "spreadsheet" }], outputAssets: [{ family: "presentation" }, { family: "image" }],
      }],
      recovery: { trend: [] },
    }));
  });
  await listen(terminalServer);
  t.after(() => terminalServer.close());
  const terminalPort = terminalServer.address().port;
  const consolePort = await freePort();
  const dir = await mkdtemp(join(tmpdir(), "multi-terminal-e2e-"));
  const child = spawn(process.execPath, ["src/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env, MULTI_TERMINAL_PORT: String(consolePort),
      MULTI_TERMINAL_REGISTRY_PATH: join(dir, "registry.json"),
      MULTI_TERMINAL_RECOVERY_PATH: join(dir, "recovery.json"),
      MULTI_TERMINAL_AUDIT_PATH: join(dir, "audit.json"),
      STUDIO_OBSERVER_TOKEN: observerToken,
      MULTI_TERMINALS_JSON: JSON.stringify([{
        id: "studio", name: "Studio", apiUrl: `http://127.0.0.1:${terminalPort}`,
        consoleUrl: "https://studio.example", observerTokenEnv: "STUDIO_OBSERVER_TOKEN",
      }]),
    },
    stdio: "ignore",
  });
  t.after(() => child.kill());
  await waitFor(`http://127.0.0.1:${consolePort}/health`);
  const shell = await fetch(`http://127.0.0.1:${consolePort}/`);
  assert.match(await shell.text(), /终端运营台/);
  const overview = await fetch(`http://127.0.0.1:${consolePort}/api/overview`).then((response) => response.json());
  assert.equal(overview.terminals[0].tasks[0].terminalId, "studio");
  const traces = await fetch(`http://127.0.0.1:${consolePort}/api/traces?q=spreadsheet&limit=1`).then((response) => response.json());
  assert.equal(traces.traces[0].traceId, "trace_assets");
  assert.deepEqual(traces.traces[0].assetFamilies, ["spreadsheet", "presentation", "image"]);
});

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

async function waitFor(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("service did not start");
}
