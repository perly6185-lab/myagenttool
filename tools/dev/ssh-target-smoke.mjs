import { spawn } from "node:child_process";

const serverPort = 3222;
const serverUrl = `http://127.0.0.1:${serverPort}`;
const children = [];

try {
  start("server", process.execPath, ["apps/server/src/index.mjs"], {
    SERVER_PORT: String(serverPort)
  });
  await waitFor(async () => (await request("GET", "/health")).status === "ok", "server health");

  const good = await request("POST", "/api/ssh-targets", {
    name: "Smoke SSH target",
    host: "dev.example.internal",
    port: 22,
    user: "dev",
    authMethod: "private_key_ref",
    credentialRef: "external-secret:ssh/smoke",
    knownHostPolicy: "pinned_fingerprint",
    knownHostFingerprint: "SHA256:smoke",
    workspaceRoot: "/srv/myagenttool",
    platformHint: "linux",
    agentForwarding: false,
    keySelection: "explicit_key_ref"
  });
  assert(good.target.credentialStorage === "external_reference_only", "SSH target should store only credential references.");
  assert(good.target.remoteRelayEnabled === false, "SSH target should not enable remote relay in Phase G.");
  assert(good.capability.ssh.available === true, "SSH target registry capability should be visible.");

  const report = await request("POST", `/api/ssh-targets/${encodeURIComponent(good.target.id)}/test`, {});
  assert(report.report.status === "ready_for_manual_test", "Explicit credential and pinned host should pass preflight.");
  assert(report.report.auth.plaintextStored === false, "Preflight report must not store plaintext credentials.");
  assert(report.report.remoteRelayEnabled === false, "Preflight report must keep remote relay disabled.");
  assert(report.report.checks.some((check) => check.id === "host_verification"), "Preflight should include host verification.");

  const blocked = await request("POST", "/api/ssh-targets", {
    host: "blocked.example.internal",
    port: 22,
    user: "dev",
    authMethod: "password_ref",
    knownHostPolicy: "manual_review",
    workspaceRoot: "/srv/myagenttool",
    agentForwarding: true
  });
  const blockedReport = await request("POST", `/api/ssh-targets/${encodeURIComponent(blocked.target.id)}/test`, {});
  assert(blockedReport.report.status === "blocked", "Missing external credential reference should block preflight.");
  assert(blockedReport.report.checks.some((check) => check.id === "agent_forwarding" && check.status === "needs_review"), "Agent forwarding risk should be recorded.");

  const state = await request("GET", "/api/state");
  assert(state.sshTargets.length >= 2, "Public state should include SSH targets.");
  assert(state.sshConnectionTests.length >= 2, "Public state should include SSH preflight reports.");
  assert(JSON.stringify(state).includes("external-secret:ssh/smoke"), "Credential reference should be visible for audit.");
  assert(!JSON.stringify(state).includes("BEGIN OPENSSH PRIVATE KEY"), "State must not include private key material.");
  console.log(`[ssh-target-smoke] SSH target preflight OK target=${good.target.id} report=${report.report.id}`);
} finally {
  stopChildren();
}

function start(name, command, args, env) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child);
  child.stdout.on("data", (chunk) => prefix(name, chunk));
  child.stderr.on("data", (chunk) => prefix(name, chunk));
}

async function waitFor(check, label) {
  let lastError = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError?.message ?? "no result"}`);
}

async function request(method, path, body) {
  const response = await fetch(`${serverUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${method} ${path} failed: ${JSON.stringify(data)}`);
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function prefix(name, chunk) {
  for (const line of chunk.toString("utf8").split(/\r?\n/)) {
    if (line.trim()) console.log(`[${name}] ${line}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopChildren() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}
