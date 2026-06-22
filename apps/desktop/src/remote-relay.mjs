import readline from "node:readline";
import * as pty from "node-pty";

const sessions = new Map();
const relayVersion = "0.1.0";

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

send({ type: "relay.ready", relayVersion, platform: process.platform, pid: process.pid });

rl.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    send({ type: "relay.error", summary: "Invalid relay JSON message." });
    return;
  }
  handleMessage(message);
});

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

function handleMessage(message) {
  const sessionId = String(message.sessionId ?? "");
  if (message.type === "create") {
    createSession(sessionId, message);
    return;
  }
  const session = sessions.get(sessionId);
  if (!session) {
    send({ type: "terminal.runtime.warning", sessionId, summary: "Remote relay session is not active." });
    return;
  }
  if (message.type === "input") {
    session.pty.write(String(message.input ?? ""));
    send({ type: "terminal.input.submit", sessionId, actionId: message.actionId, summary: "Remote relay input submitted." });
    return;
  }
  if (message.type === "resize") {
    const cols = Math.max(20, Number(message.cols ?? 100));
    const rows = Math.max(5, Number(message.rows ?? 30));
    session.pty.resize(cols, rows);
    send({ type: "terminal.resize", sessionId, actionId: message.actionId, summary: `Remote relay resized to ${cols}x${rows}.`, cols, rows });
    return;
  }
  if (message.type === "close") {
    session.pty.kill();
    sessions.delete(sessionId);
    send({ type: "terminal.close", sessionId, actionId: message.actionId, summary: "Remote relay close requested." });
  }
}

function createSession(sessionId, message) {
  if (!sessionId) {
    send({ type: "relay.error", summary: "Remote relay create requires sessionId." });
    return;
  }
  const shellPlan = resolveRemoteShell(message.shell);
  const cols = Math.max(20, Number(message.cols ?? 100));
  const rows = Math.max(5, Number(message.rows ?? 30));
  const cwd = String(message.cwd ?? process.cwd());
  const child = pty.spawn(shellPlan.file, shellPlan.args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: process.env
  });
  sessions.set(sessionId, { pty: child });
  child.onData((output) => {
    send({
      type: "terminal.output.chunk",
      sessionId,
      stream: "stdout",
      output,
      byteCount: Buffer.byteLength(output),
      summary: summarizeOutput(output)
    });
  });
  child.onExit(({ exitCode }) => {
    sessions.delete(sessionId);
    send({ type: "terminal.exit", sessionId, exitCode, summary: `Remote relay exited with code ${exitCode}.` });
  });
  send({
    type: "terminal.session.attached",
    sessionId,
    actionId: message.actionId,
    relayVersion,
    summary: `Remote relay attached to ${shellPlan.label}.`
  });
}

function resolveRemoteShell(requested) {
  const normalized = String(requested ?? "").trim().toLowerCase();
  if (process.platform === "win32") {
    if (normalized === "cmd") return { file: "cmd.exe", args: [], label: "cmd.exe" };
    return { file: "powershell.exe", args: ["-NoLogo"], label: "powershell.exe" };
  }
  if (normalized === "sh") return { file: "/bin/sh", args: [], label: "sh" };
  if (normalized === "zsh") return { file: "/bin/zsh", args: [], label: "zsh" };
  return { file: "/bin/bash", args: [], label: "bash" };
}

function summarizeOutput(output) {
  const clean = String(output ?? "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\s+/g, " ").trim();
  return clean ? `Remote relay output: ${clean.slice(0, 180)}` : "Remote relay output received.";
}

function send(message) {
  process.stdout.write(`${JSON.stringify({ ...message, createdAt: new Date().toISOString() })}\n`);
}

function shutdown() {
  for (const session of sessions.values()) {
    session.pty.kill();
  }
  sessions.clear();
  process.exit(0);
}
