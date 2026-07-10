import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const doocsPath = resolve(process.argv[2] ?? process.env.DOOCS_MD_PATH ?? join(repoRoot, "doocs-md"));
const serverPort = process.env.DOOCS_MD_EDITOR_SMOKE_PORT
  ? Number(process.env.DOOCS_MD_EDITOR_SMOKE_PORT)
  : await freePort();
const serverUrl = `http://127.0.0.1:${serverPort}`;
const tempRoot = join(tmpdir(), `myagenttool-doocs-md-editor-smoke-${Date.now()}`);
const projectPath = join(tempRoot, "project");
const statePath = join(tempRoot, "state.json");
const tokenPath = join(tempRoot, "bridge-token.json");
const applicationId = "app_doocs_md_editor_smoke";
const children = [];
let passed = 0;
let stopping = false;
let registered = false;

const ok = (message) => {
  passed += 1;
  console.log(`  ok - ${message}`);
};

try {
  assert(existsSync(doocsPath), `doocs/md checkout not found: ${doocsPath}`);
  assert(existsSync(join(doocsPath, "package.json")), "doocs/md package.json should exist");
  mkdirSync(projectPath, { recursive: true });

  start("server", process.execPath, ["apps/server/src/index.mjs"], {
    SERVER_PORT: String(serverPort),
    MYAGENTTOOL_PROJECT_PATH: projectPath,
    MYAGENTTOOL_STATE_PATH: statePath,
    MYAGENTTOOL_STATE_DISABLED: "1",
  });
  await waitForServer();
  ok("server started");

  start("desktop", process.execPath, ["apps/desktop/src/index.mjs"], {
    BRIDGE_SERVER_URL: serverUrl,
    BRIDGE_POLL_INTERVAL_MS: "100",
    BRIDGE_TERMINAL_POLL_INTERVAL_MS: "100",
    MYAGENTTOOL_BRIDGE_TOKEN_PATH: tokenPath,
  });
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    return state.device?.status === "online" ? state : false;
  }, "desktop bridge registration", 15_000);
  ok("desktop bridge registered");

  const response = await request("POST", "/api/applications/register", {
    id: applicationId,
    name: "doocs/md editor smoke",
    source: { type: "local", path: doocsPath },
  });
  registered = true;
  assert(response.application.webEditor?.available, `doocs/md editor should be detected: ${JSON.stringify(response.application.webEditor)}`);
  ok("doocs/md Application exposes a web editor descriptor");

  await request("POST", `/api/applications/${encodeURIComponent(applicationId)}/web-editor/start`, {});
  ok("editor start queued through Application API");

  const readyApplication = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const app = state.applications.find((item) => item.id === applicationId);
    if (app?.webEditor?.status === "failed") {
      throw new Error(`editor failed: ${JSON.stringify(app.webEditor)}`);
    }
    return app?.webEditor?.status === "ready" && app.webEditor.url ? app : false;
  }, "doocs/md editor ready", 120_000);
  const editorUrl = readyApplication.webEditor.url;
  const parsedEditorUrl = new URL(editorUrl);
  assert(parsedEditorUrl.searchParams.get("myagenttoolApplicationId") === applicationId, "editor URL should carry handoff application id");
  assert(parsedEditorUrl.searchParams.get("myagenttoolApi") === serverUrl, "editor URL should carry handoff API base");
  const reachable = await fetch(editorUrl);
  assert(reachable.status < 500, `editor URL should be reachable: ${editorUrl} (${reachable.status})`);
  ok(`editor reachable with handoff context at ${editorUrl}`);

  const imported = await request("POST", `/api/applications/${encodeURIComponent(applicationId)}/web-editor/results`, {
    markdown: "# Editor smoke handoff",
    html: "<article><h1>Editor smoke handoff</h1><p>Saved through Application web editor import.</p></article>",
    theme: "default",
    sourceUrl: editorUrl,
    title: "Editor smoke handoff",
  });
  assert(imported.result?.resultRef?.type === "application_render_result", "editor import should create a render result");
  assert(imported.latestResult?.resultRef?.id === imported.result.id, "editor import should update latest result");
  const resultDetail = await request("GET", `/api/applications/${encodeURIComponent(applicationId)}/results/${encodeURIComponent(imported.result.id)}`);
  assert(resultDetail.result?.html?.includes("Editor smoke handoff"), "editor import should be replayable from Result Center");
  assert(resultDetail.result?.metadata?.postTitle === "Editor smoke handoff", "editor import should preserve handoff post title metadata");
  assert(resultDetail.result?.metadata?.source === "application_web_editor", "editor import should preserve handoff source metadata");
  ok("editor result imported into Application Result Center");

  if (readyApplication.webEditor.pid) {
    await request("POST", `/api/applications/${encodeURIComponent(applicationId)}/web-editor/stop`, {});
    await waitFor(async () => {
      const state = await request("GET", "/api/state");
      const app = state.applications.find((item) => item.id === applicationId);
      if (app?.webEditor?.status === "failed") {
        throw new Error(`editor stop failed: ${JSON.stringify(app.webEditor)}`);
      }
      return app?.webEditor?.status === "not_running" ? app : false;
    }, "doocs/md editor stopped", 30_000);
    ok("editor stopped through Application API");
  } else {
    ok("editor reused an existing external process; stop skipped");
  }

  console.log(`\ndoocs-md-editor-smoke: ${passed} checks passed`);
} finally {
  if (registered) {
    try {
      await request("POST", `/api/applications/${encodeURIComponent(applicationId)}/web-editor/stop`, {});
    } catch {
      // Best effort: explicit stop above is asserted; this catches early-failure cleanup.
    }
  }
  stopping = true;
  for (const child of children.reverse()) {
    if (!child.killed) child.kill();
  }
  if (resolve(tempRoot).startsWith(resolve(tmpdir()))) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function start(label, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}:error] ${chunk}`));
  child.on("exit", (code, signal) => {
    if (!stopping && code !== 0) {
      console.error(`[${label}] exited ${signal ?? code}`);
    }
  });
  children.push(child);
  return child;
}

async function waitForServer() {
  await waitFor(async () => {
    try {
      const response = await fetch(`${serverUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }, "server health", 15_000);
}

async function request(method, path, body = undefined) {
  const response = await fetch(`${serverUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
  }
  return data;
}

async function waitFor(check, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (port) resolvePort(port);
        else reject(new Error("Unable to allocate a free port."));
      });
    });
  });
}
