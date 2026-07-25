import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const observerToken = "observer-token-at-least-24-characters";
const adminToken = "admin-token-at-least-24-characters";
const terminal = createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({
    contract: "terminal-observation/v1", namespace: "pilot", protocolVersion: "1",
    terminal: { id: "studio", status: "online" }, capabilities: [],
    tasks: [{ id: "wi_1", title: "Pilot task", executionState: "running", terminalId: "studio", traceId: "trace_1", inputAssets: [], outputAssets: [] }],
    recovery: { trend: [{ at: "2026-07-25T00:00:00.000Z", hours: 2 }] },
  }));
});
await listen(terminal);
const appPort = await freePort();
const dir = await mkdtemp(join(tmpdir(), "multi-browser-"));
const child = spawn(process.execPath, ["src/index.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env, MULTI_TERMINAL_PORT: String(appPort),
    MULTI_TERMINAL_ADMIN_TOKEN: adminToken,
    MULTI_TERMINAL_REGISTRY_PATH: join(dir, "registry.json"),
    MULTI_TERMINAL_RECOVERY_PATH: join(dir, "recovery.json"),
    MULTI_TERMINAL_AUDIT_PATH: join(dir, "audit.json"),
    MULTI_TERMINAL_SLO_PATH: join(dir, "slo.json"),
    STUDIO_OBSERVER_TOKEN: observerToken,
    MULTI_TERMINALS_JSON: JSON.stringify([{ id: "studio", name: "Studio", apiUrl: `http://127.0.0.1:${terminal.address().port}`, consoleUrl: "https://studio.example", observerTokenEnv: "STUDIO_OBSERVER_TOKEN" }]),
  },
  stdio: "ignore",
});

try {
  await waitFor(`http://127.0.0.1:${appPort}/health`);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`http://127.0.0.1:${appPort}`);
    await page.getByRole("heading", { name: "我的终端" }).waitFor();
    assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= body.clientWidth), true);
    await page.getByRole("button", { name: "EN" }).click();
    await page.getByRole("heading", { name: "My terminals" }).waitFor();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement !== document.body), true);
    const shot = await page.screenshot();
    assert.ok(shot.length > 10_000);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= body.clientWidth), true);
  } finally {
    await browser.close();
  }
  console.log("multi-terminal browser visual/accessibility journey passed");
} finally {
  child.kill();
  terminal.close();
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
async function waitFor(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("service did not start");
}
