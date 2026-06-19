import { spawn } from "node:child_process";

const processes = [
  {
    name: "server",
    command: process.execPath,
    args: ["apps/server/src/index.mjs"],
    env: { SERVER_PORT: "3001" }
  },
  {
    name: "desktop",
    command: process.execPath,
    args: ["apps/desktop/src/index.mjs"],
    env: { BRIDGE_SERVER_URL: "http://127.0.0.1:3001" }
  },
  {
    name: "web",
    command: process.execPath,
    args: ["apps/web/src/index.mjs"],
    env: { WEB_PORT: "3000" }
  }
];

const children = [];

console.log("[demo] starting M0 Local Invocation Loop");
console.log("[demo] Web Console: http://127.0.0.1:3000");
console.log("[demo] Server API:  http://127.0.0.1:3001");
console.log("[demo] Press Ctrl+C to stop.");

for (const proc of processes) {
  const child = spawn(proc.command, proc.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...proc.env },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child);
  child.stdout.on("data", (chunk) => writePrefixed(proc.name, chunk));
  child.stderr.on("data", (chunk) => writePrefixed(proc.name, chunk));
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[demo] ${proc.name} exited with code ${code}`);
      stop(code);
    }
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

function writePrefixed(name, chunk) {
  for (const line of chunk.toString("utf8").split(/\r?\n/)) {
    if (line.trim()) {
      console.log(`[${name}] ${line}`);
    }
  }
}

function stop(code) {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(code), 250);
}
