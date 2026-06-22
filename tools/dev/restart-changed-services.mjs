import { execFileSync } from "node:child_process";

const controlUrl = process.env.DEV_CONTROL_URL ?? "http://127.0.0.1:5999";
const args = process.argv.slice(2);
const includeUntracked = !args.includes("--tracked-only");
const checkOnly = args.includes("--check");

if (checkOnly) {
  console.log("[dev:restart-changed] changed-service restart tool OK");
  process.exit(0);
}

const changedFiles = changedGitFiles({ includeUntracked });
const services = servicesForFiles(changedFiles);

if (changedFiles.length === 0) {
  console.log("[dev:restart-changed] no changed files; no services restarted");
  process.exit(0);
}

console.log(`[dev:restart-changed] changed files: ${changedFiles.join(", ")}`);
if (services.length === 0) {
  console.log("[dev:restart-changed] no running service is affected; no services restarted");
  process.exit(0);
}

let response;
try {
  response = await fetch(`${controlUrl}/restart`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ services })
  });
} catch (error) {
  console.error(`[dev:restart-changed] dev control endpoint is unavailable at ${controlUrl}. Start or restart pnpm dev, then retry.`);
  console.error(`[dev:restart-changed] requested services: ${services.join(", ")}`);
  console.error(`[dev:restart-changed] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const data = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(`[dev:restart-changed] restart failed: ${JSON.stringify(data)}`);
  process.exit(1);
}

console.log(`[dev:restart-changed] restarted services: ${data.restarted.join(", ")}`);

function changedGitFiles({ includeUntracked }) {
  const tracked = execFileSync("git", ["diff", "--name-only", "HEAD"], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!includeUntracked) {
    return unique(tracked);
  }
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return unique([...tracked, ...untracked]);
}

function servicesForFiles(files) {
  const services = new Set();
  for (const file of files) {
    const normalized = file.replaceAll("\\", "/");
    if (normalized === "package.json" || normalized === "pnpm-lock.yaml" || normalized === "pnpm-workspace.yaml") {
      services.add("server");
      services.add("desktop");
      services.add("web");
      continue;
    }
    if (normalized.startsWith("packages/protocol/") || normalized.startsWith("packages/shared/")) {
      services.add("server");
      services.add("desktop");
      services.add("web");
      continue;
    }
    if (normalized.startsWith("packages/adapters/")) {
      services.add("server");
      services.add("desktop");
      continue;
    }
    if (normalized.startsWith("apps/server/")) {
      services.add("server");
      continue;
    }
    if (normalized.startsWith("apps/desktop/")) {
      services.add("desktop");
      continue;
    }
    if (normalized.startsWith("apps/web/")) {
      services.add("web");
      continue;
    }
    if (normalized === "tools/dev/run-local-demo.mjs") {
      services.add("server");
      services.add("desktop");
      services.add("web");
    }
  }
  return [...services];
}

function unique(items) {
  return [...new Set(items)];
}
