import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundledAgentEnv } from "./bundled-agent-runtime.mjs";
import { overlayFromChrome, readSkinSettings, registerSkinChrome } from "./skin-chrome.mjs";
import { registerContainedAssetOpen, registerContainedAssetReveal, registerContainedOfficeDocumentOpen, registerLocalOfficeDocumentPicker, registerWorkflowSourceFolderPicker } from "./local-office-document-picker.mjs";
import { registerWorkflowCaseIntake } from "./workflow-case-intake.mjs";
import { registerMailAccountConnector } from "./mail-account-connector.mjs";
import { registerMailAttachmentHandler } from "./mail-attachment-handler.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

if (process.argv.includes("--check")) {
  runCheck();
  process.exit(0);
}

const { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } = await import("electron");

// #1616 loopback trust boundary: a fresh per-launch credential shared only
// with the processes this shell spawns. The server rejects /api requests
// without it, so "another local process found the port" no longer grants
// owner-authority control of the plane. Never placed in argv (visible to ps)
// — the renderer gets it injected at the network layer, not exposed to page JS.
const loopbackToken = randomBytes(32).toString("hex");
const loopbackHeaders = { "X-Loopback-Token": loopbackToken };

const smokeMode = process.argv.includes("--smoke") || process.env.MYAGENTTOOL_ELECTRON_SMOKE === "1";
const host = "127.0.0.1";
const serviceDefaults = {
  serverPort: Number(process.env.SERVER_PORT ?? 5001),
  webPort: Number(process.env.WEB_PORT ?? 5000),
};

let mainWindow = null;
let stopping = false;
let failureReported = false;
let logFile = null;
const services = new Map();

app.setName("MyAgentTool");
if (smokeMode) {
  app.setPath("userData", join(tmpdir(), "myagenttool-electron-smoke", String(process.pid)));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(startApp).catch((error) => {
    reportStartupError(error);
  });

  app.on("before-quit", () => {
    stopping = true;
    stopServices();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}

async function startApp() {
  const paths = runtimePaths();
  logFile = join(app.getPath("logs"), "main.log");
  mkdirSync(dirname(logFile), { recursive: true });
  mkdirSync(join(app.getPath("userData"), "state"), { recursive: true });

  appendLog("electron", `starting MyAgentTool from ${paths.runtimeRoot}`);

  const serverPort = await findOpenPort(serviceDefaults.serverPort);
  const webPort = await findOpenPort(serviceDefaults.webPort === serverPort ? serviceDefaults.webPort + 1 : serviceDefaults.webPort);
  const serverUrl = `http://${host}:${serverPort}`;
  const webUrl = `http://${host}:${webPort}`;
  const mailMcpRuntime = nodeRuntime();
  const mailMcpEntry = join(paths.runtimeRoot, "tools", "mail-mcp", "src", "server.mjs");

  startNodeService("server", paths.serverEntry, {
    SERVER_HOST: host,
    SERVER_PORT: String(serverPort),
    MYAGENT_LOOPBACK_TOKEN: loopbackToken,
    MYAGENTTOOL_STATE_PATH: join(app.getPath("userData"), "state", "local-demo-state.json"),
    MYAGENTTOOL_PROJECT_PATH: process.env.MYAGENTTOOL_PROJECT_PATH ?? app.getPath("documents"),
  }, paths.runtimeRoot);

  await waitForHttp(`${serverUrl}/api/state`, "server");

  startNodeService("desktop", paths.desktopEntry, {
    BRIDGE_SERVER_URL: serverUrl,
    BRIDGE_LOOPBACK_TOKEN: loopbackToken,
    BRIDGE_TERMINAL_POLL_INTERVAL_MS: process.env.BRIDGE_TERMINAL_POLL_INTERVAL_MS ?? "40",
    MYAGENTTOOL_BRIDGE_TOKEN_PATH: join(app.getPath("userData"), "state", "bridge-token.json"),
    BRIDGE_CREDENTIAL_DIR: join(app.getPath("appData"), "myagenttool", "credential-readiness"),
    MYAGENTTOOL_MAIL_MCP_ENTRY: mailMcpEntry,
    MYAGENTTOOL_MAIL_MCP_NODE: mailMcpRuntime.command,
    MYAGENTTOOL_MAIL_MCP_ELECTRON_RUN_AS_NODE: mailMcpRuntime.env.ELECTRON_RUN_AS_NODE ?? "0",
    ...bundledAgentEnv({ appRoot: paths.runtimeRoot, resourcesRoot: paths.resourcesRoot, execPath: process.execPath }),
  }, paths.runtimeRoot);

  startNodeService("web", paths.webEntry, {
    WEB_HOST: host,
    WEB_PORT: String(webPort),
    MYAGENTTOOL_WEB_DIST: paths.webDist,
  }, paths.runtimeRoot);

  await waitForHttp(`${webUrl}/`, "web");

  if (smokeMode) {
    await waitForBridgeOnline(serverUrl);
    appendLog("electron", "smoke check OK");
    stopping = true;
    stopServices();
    app.exit(0);
    return;
  }

  // Renderer → server requests get the launch token stamped at the network
  // layer. The page JS never sees the token (nothing to exfiltrate via XSS),
  // and the web bundle needs no desktop-specific auth code. Scoped to the
  // server origin only.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`${serverUrl}/*`] },
    (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, ...loopbackHeaders } });
    },
  );

  createMainWindow(`${webUrl}/?api=${encodeURIComponent(serverUrl)}`, serverUrl);
}

function runtimePaths() {
  if (app.isPackaged) {
    const appRoot = app.getAppPath();
    return {
      runtimeRoot: appRoot,
      resourcesRoot: process.resourcesPath,
      serverEntry: join(appRoot, "apps", "server", "src", "index.mjs"),
      desktopEntry: join(appRoot, "apps", "desktop", "src", "index.mjs"),
      webEntry: join(appRoot, "apps", "electron", "src", "static-web-server.mjs"),
      webDist: join(appRoot, "apps", "web", "dist"),
    };
  }

  return {
    runtimeRoot: repoRoot,
    resourcesRoot: join(repoRoot, "apps", "electron", "vendor"),
    serverEntry: join(repoRoot, "apps", "server", "src", "index.mjs"),
    desktopEntry: join(repoRoot, "apps", "desktop", "src", "index.mjs"),
    webEntry: join(repoRoot, "apps", "electron", "src", "static-web-server.mjs"),
    webDist: join(repoRoot, "apps", "web", "dist"),
  };
}

// Native window chrome (backing color + OS theme source) persisted by the
// renderer so a cold start paints the correct frame before the web app loads.
// Logic lives in skin-chrome.mjs; see docs/design/SKIN_SYSTEM.md.
function skinStateDir() {
  return join(app.getPath("userData"), "state");
}

let skinIpcRegistered = false;
function registerSkinIpc() {
  if (skinIpcRegistered) return;
  skinIpcRegistered = true;
  registerSkinChrome({
    ipcMain,
    nativeTheme,
    stateDir: skinStateDir(),
    getWindow: () => mainWindow,
    onError: (error) => appendLog("electron", `failed to persist skin settings: ${error.message}`),
  });
}

function createMainWindow(url, serverUrl) {
  registerSkinIpc();
  const getState = async () => (await (await fetch(`${serverUrl}/api/state`, { headers: loopbackHeaders })).json());
  registerLocalOfficeDocumentPicker({ ipcMain, dialog, getWindow: () => mainWindow, getWorktrees: async () => (await getState()).worktrees ?? [] });
  registerWorkflowSourceFolderPicker({ ipcMain, dialog, getWindow: () => mainWindow });
  registerWorkflowCaseIntake({ ipcMain, dialog, getWindow: () => mainWindow, getState });
  registerContainedOfficeDocumentOpen({ ipcMain, getState, openPath: (path) => shell.openPath(path) });
  registerContainedAssetOpen({ ipcMain, getState, openPath: (path) => shell.openPath(path) });
  registerContainedAssetReveal({ ipcMain, getState, revealPath: (path) => shell.showItemInFolder(path) });
  const paths = runtimePaths();
  const runtime = nodeRuntime();
  registerMailAccountConnector({
    ipcMain,
    credentialRoot: join(app.getPath("appData"), "myagenttool"),
    runtimeRoot: paths.runtimeRoot,
    nodeCommand: runtime.command,
    requestServer: async (method, path, body) => {
      const response = await fetch(`${serverUrl}${path}`, {
        method,
        headers: { ...loopbackHeaders, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error(`${method} ${path} failed.`);
      return response.json();
    },
    verifyCredential: async (credential) => {
      const module = await import(pathToFileURL(join(paths.runtimeRoot, "tools", "mail-mcp", "src", "verify-163.mjs")).href);
      return module.verify163Credential(credential);
    },
  });
  registerMailAttachmentHandler({
    ipcMain,
    dialog,
    getWindow: () => mainWindow,
    readAttachment: async (input) => {
      const module = await import(pathToFileURL(join(paths.runtimeRoot, "tools", "mail-mcp", "src", "attachment-163.mjs")).href);
      return module.read163Attachment(input);
    },
  });
  const chrome = readSkinSettings(skinStateDir());
  nativeTheme.themeSource = chrome.themeSource;

  // Windows only: drop the native title bar and draw a skin-colored window-
  // controls overlay so the caption buttons match the active skin. macOS/Linux
  // keep their default frame. The overlay is recolored on skin change via IPC.
  const overlayChrome =
    process.platform === "win32"
      ? { titleBarStyle: "hidden", titleBarOverlay: overlayFromChrome(chrome) }
      : {};

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    title: "MyAgentTool",
    show: false,
    backgroundColor: chrome.bg,
    ...overlayChrome,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  mainWindow.loadURL(url);
}

function startNodeService(name, entry, envPatch, cwd) {
  if (!existsSync(entry)) {
    throw new Error(`${name} entry is missing: ${entry}`);
  }

  const runtime = nodeRuntime();
  const child = spawn(runtime.command, [entry], {
    cwd,
    env: {
      ...process.env,
      ...runtime.env,
      ...envPatch,
      MYAGENTTOOL_ELECTRON: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  services.set(name, child);
  child.stdout.on("data", (chunk) => writeServiceOutput(name, chunk));
  child.stderr.on("data", (chunk) => writeServiceOutput(name, chunk));
  child.on("exit", (code, signal) => {
    services.delete(name);
    appendLog("electron", `${name} exited with code ${code ?? "null"} signal ${signal ?? "null"}`);
    if (!stopping && code !== 0) {
      reportServiceFailure(name, code, signal);
    }
  });
  child.on("error", (error) => {
    appendLog("electron", `${name} spawn error: ${error.message}`);
    if (!stopping) reportServiceFailure(name, null, null, error);
  });

  appendLog("electron", `${name} started with pid ${child.pid}`);
}

function nodeRuntime() {
  const explicit = process.env.MYAGENTTOOL_ELECTRON_NODE;
  const devNode = [explicit, process.env.npm_node_execpath].find((candidate) => candidate && existsSync(candidate));
  if (!app.isPackaged && devNode) {
    return { command: devNode, env: {} };
  }
  return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

function writeServiceOutput(name, chunk) {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (line.trim()) appendLog(name, line);
  }
}

function appendLog(name, message) {
  const line = `[${new Date().toISOString()}] [${name}] ${message}\n`;
  if (logFile) {
    try {
      appendFileSync(logFile, line);
    } catch {
      // Logging must never bring down the desktop shell.
    }
  } else {
    process.stdout.write(line);
  }
}

function stopServices() {
  for (const child of services.values()) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

async function findOpenPort(preferredPort) {
  for (let port = preferredPort; port < preferredPort + 25; port += 1) {
    if (await canListen(port)) return port;
  }
  return listenOnAnyPort();
}

function canListen(port) {
  return new Promise((resolveCanListen) => {
    const server = net.createServer();
    server.once("error", () => resolveCanListen(false));
    server.listen({ host, port }, () => {
      server.close(() => resolveCanListen(true));
    });
  });
}

function listenOnAnyPort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host, port: 0 }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForHttp(url, label, timeoutMs = 20_000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const status = await getStatus(url);
      if (status >= 200 && status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }

  throw new Error(`${label} did not become ready at ${url}${lastError ? `: ${lastError.message}` : ""}`);
}

async function waitForBridgeOnline(serverUrl) {
  await waitForJson(`${serverUrl}/api/state`, (state) => {
    const devices = Array.isArray(state?.devices) ? state.devices : [state?.device].filter(Boolean);
    return devices.some((device) => device?.status === "online");
  }, "desktop bridge");
}

async function waitForJson(url, predicate, label, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const json = await getJson(url);
      if (predicate(json)) return json;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }

  throw new Error(`${label} did not report ready at ${url}${lastError ? `: ${lastError.message}` : ""}`);
}

function getStatus(url) {
  return new Promise((resolveStatus, reject) => {
    const req = http.get(url, { headers: loopbackHeaders }, (res) => {
      res.resume();
      resolveStatus(res.statusCode ?? 0);
    });
    req.setTimeout(2000, () => {
      req.destroy(new Error("request timed out"));
    });
    req.on("error", reject);
  });
}

function getJson(url) {
  return new Promise((resolveJson, reject) => {
    const req = http.get(url, { headers: loopbackHeaders }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
          return;
        }
        try {
          resolveJson(JSON.parse(text));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.setTimeout(2000, () => {
      req.destroy(new Error("request timed out"));
    });
    req.on("error", reject);
  });
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function reportStartupError(error) {
  appendLog("electron", `startup failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  if (smokeMode) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    stopping = true;
    stopServices();
    app.exit(1);
    return;
  }
  dialog.showErrorBox(
    "MyAgentTool failed to start",
    `${error instanceof Error ? error.message : String(error)}\n\nLog: ${logFile ?? "(log not initialized)"}`,
  );
  app.quit();
}

function reportServiceFailure(name, code, signal, error = null) {
  if (failureReported) return;
  failureReported = true;
  const detail = error?.message ?? `exit code ${code ?? "null"}, signal ${signal ?? "null"}`;
  if (smokeMode) {
    console.error(`${name} stopped unexpectedly (${detail}). Log: ${logFile ?? "(log not initialized)"}`);
    return;
  }
  dialog.showErrorBox(
    "MyAgentTool service stopped",
    `${name} stopped unexpectedly (${detail}).\n\nLog: ${logFile ?? "(log not initialized)"}`,
  );
}

function runCheck() {
  const requiredFiles = [
    "apps/electron/src/main.mjs",
    "apps/electron/src/static-web-server.mjs",
    "apps/electron/src/bundled-agent-runtime.mjs",
    "apps/electron/electron-builder.yml",
    "apps/server/src/index.mjs",
    "apps/desktop/src/index.mjs",
    "apps/web/package.json",
    "tools/agents/application-wrapper.mjs",
    "tools/ai/src/index.mjs",
    "packages/protocol/src/index.mjs",
    "packages/protocol/src/issue-prompt.mjs",
    "packages/adapters/src/mcp.mjs",
    "packages/adapters/src/a2a.mjs",
    "packages/adapters/src/container.mjs",
    "packages/shared/src/index.mjs",
  ];

  const missing = requiredFiles.filter((path) => !existsSync(join(repoRoot, path)));
  if (missing.length > 0) {
    console.error(`[electron:check] missing files: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log("[electron:check] desktop shell check OK");
}
