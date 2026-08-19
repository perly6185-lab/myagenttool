import { spawn } from "node:child_process";
import http from "node:http";
import { join } from "node:path";

const host = process.env.DEMO_HOST ?? "127.0.0.1";
const webPort = Number(process.env.WEB_PORT ?? 5000);
const serverPort = Number(process.env.SERVER_PORT ?? 5001);
const controlHost = process.env.DEV_CONTROL_HOST ?? host;
const controlPort = Number(process.env.DEV_CONTROL_PORT ?? 5999);
const serverUrl = `http://${host}:${serverPort}`;
const webUrl = `http://${host}:${webPort}`;
const controlUrl = `http://${controlHost}:${controlPort}`;
const credentialReadinessDir = process.env.BRIDGE_CREDENTIAL_DIR
  ?? (process.env.APPDATA ? join(process.env.APPDATA, "myagenttool", "credential-readiness") : null);

const processes = [
  {
    name: "server",
    command: process.execPath,
    args: ["apps/server/src/index.mjs"],
    env: {
      SERVER_PORT: String(serverPort),
      // Local Auto-runs must produce platform-owned verification evidence.
      // An explicit operator command still wins; otherwise the server derives
      // targeted tests/typechecks from the committed worktree diff.
      MYAGENTTOOL_AUTORUN_VERIFY_AUTO: process.env.MYAGENTTOOL_AUTORUN_VERIFY_AUTO ?? "1",
      MYAGENTTOOL_AUTORUN_VERIFY_TIMEOUT_MS: process.env.MYAGENTTOOL_AUTORUN_VERIFY_TIMEOUT_MS ?? "900000",
    }
  },
  {
    name: "desktop",
    command: process.execPath,
    args: ["apps/desktop/src/index.mjs"],
    env: {
      BRIDGE_SERVER_URL: serverUrl,
      BRIDGE_TERMINAL_POLL_INTERVAL_MS: "40",
      ...(credentialReadinessDir ? { BRIDGE_CREDENTIAL_DIR: credentialReadinessDir } : {}),
    }
  },
  {
    name: "web",
    command: process.execPath,
    args: ["apps/web/src/index.mjs"],
    env: { WEB_PORT: String(webPort) }
  }
];

const children = new Map();
let stopping = false;
let desktopRelinkAttempted = false;
let desktopNeedsRelink = false;

console.log("[demo] starting M0 Local Invocation Loop");
console.log(`[demo] Web Console: ${webUrl}`);
console.log(`[demo] Server API:  ${serverUrl}`);
console.log(`[demo] Dev control: ${controlUrl}`);
console.log("[demo] Press Ctrl+C to stop.");

for (const proc of processes) {
  startProcess(proc);
}

const controlServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${controlHost}:${controlPort}`);
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { status: "ok", services: serviceStatus() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/restart") {
    const body = await readJson(req);
    const requested = normalizeServices(body.services);
    if (requested.length === 0) {
      sendJson(res, 400, { error: "services_required", services: processes.map((proc) => proc.name) });
      return;
    }
    for (const service of requested) {
      await restartProcess(service);
    }
    sendJson(res, 200, { restarted: requested, services: serviceStatus() });
    return;
  }

  sendJson(res, 404, { error: "not_found" });
});

controlServer.listen(controlPort, controlHost, () => {
  console.log(`[demo] dev control listening on http://${controlHost}:${controlPort}`);
});

function startProcess(proc) {
  const child = spawn(proc.command, proc.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...proc.env },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.set(proc.name, { proc, child });
  child.stdout.on("data", (chunk) => writePrefixed(proc.name, chunk));
  child.stderr.on("data", (chunk) => {
    if (proc.name === "desktop" && chunk.toString("utf8").includes("re-pair the device")) {
      desktopNeedsRelink = true;
    }
    writePrefixed(proc.name, chunk);
  });
  child.on("exit", (code) => {
    const current = children.get(proc.name);
    if (current?.child === child) {
      children.delete(proc.name);
    }
    if (stopping) {
      return;
    }
    if (proc.name === "desktop" && code && desktopNeedsRelink && !desktopRelinkAttempted) {
      desktopRelinkAttempted = true;
      desktopNeedsRelink = false;
      recoverDesktopPairing().catch((error) => {
        console.error(`[demo] automatic device re-pair failed: ${error.message}`);
        stop(code);
      });
      return;
    }
    if (code && code !== 0) {
      console.error(`[demo] ${proc.name} exited with code ${code}`);
      stop(code);
    }
  });
}

async function recoverDesktopPairing() {
  console.log("[demo] the local bridge credential expired; re-pairing this development device once.");
  const response = await fetch(`${serverUrl}/api/device/relink`, { method: "POST" });
  if (!response.ok) {
    throw new Error(`server returned HTTP ${response.status}`);
  }
  await restartProcess("desktop");
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

async function restartProcess(name) {
  const existing = children.get(name);
  const proc = existing?.proc ?? processes.find((item) => item.name === name);
  if (!proc) {
    throw new Error(`Unknown service: ${name}`);
  }
  if (existing?.child && !existing.child.killed) {
    console.log(`[demo] restarting ${name}`);
    await stopChild(existing.child);
  } else {
    console.log(`[demo] starting ${name}`);
  }
  startProcess(proc);
}

function stopChild(child) {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1200);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function writePrefixed(name, chunk) {
  for (const line of chunk.toString("utf8").split(/\r?\n/)) {
    if (line.trim()) {
      console.log(`[${name}] ${line}`);
    }
  }
}

function stop(code) {
  stopping = true;
  controlServer.close();
  for (const { child } of children.values()) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(code), 250);
}

function normalizeServices(value) {
  const allowed = new Set(processes.map((proc) => proc.name));
  const services = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(services.map((service) => String(service).trim()).filter((service) => allowed.has(service)))];
}

function serviceStatus() {
  return Object.fromEntries(processes.map((proc) => {
    const child = children.get(proc.name)?.child;
    return [proc.name, { running: Boolean(child && !child.killed), pid: child?.pid ?? null }];
  }));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
