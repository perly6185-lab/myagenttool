#!/usr/bin/env node

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

if (!options.projectId || !options.worktreeId) {
  fail("--project-id and --worktree-id are required.");
}

const client = createClient({
  baseUrl: options.baseUrl,
  token: options.token,
});

const tool = await discoverTool(client, options.tool);
const created = await invokeReview(client, tool.name, {
  projectId: options.projectId,
  worktreeId: options.worktreeId,
  instruction: options.instruction,
  severityFloor: options.severityFloor,
});
const findings = await pollReviewFindings(client, {
  invocationId: created.invocationId,
  source: sourceForTool(tool.name),
  timeoutMs: options.timeoutMs,
  intervalMs: options.intervalMs,
});

console.log(JSON.stringify({
  tool: tool.name,
  invocationId: created.invocationId,
  status: findings.invocationStatus,
  findingCount: findings.reviewFindings.length,
  reviewFindings: findings.reviewFindings,
}, null, 2));

function createClient({ baseUrl, token }) {
  const normalizedBase = String(baseUrl ?? "").replace(/\/+$/, "");
  return {
    async request(method, path, body = undefined) {
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetch(`${normalizedBase}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (!response.ok) {
        const error = new Error(`${method} ${path} failed: ${response.status} ${text}`);
        error.status = response.status;
        error.body = data;
        throw error;
      }
      return data;
    },
  };
}

async function discoverTool(client, name) {
  const tools = await client.request("GET", "/api/tools");
  const tool = (tools.tools ?? []).find((item) => item.name === name);
  if (!tool) {
    fail(`Governed tool is not discoverable: ${name}`);
  }
  const serialized = JSON.stringify(tool);
  for (const forbidden of ["adapter", "command", "args", "argv", "cwd", "shell", "env"]) {
    if (serialized.includes(`"${forbidden}"`)) {
      fail(`Tool descriptor leaked forbidden execution field: ${forbidden}`);
    }
  }
  return tool;
}

async function invokeReview(client, toolName, input) {
  return client.request("POST", `/api/tools/${encodeURIComponent(toolName)}/invocations`, {
    projectId: input.projectId,
    worktreeId: input.worktreeId,
    instruction: input.instruction,
    severityFloor: input.severityFloor,
  });
}

async function pollReviewFindings(client, { invocationId, source, timeoutMs, intervalMs }) {
  const deadline = Date.now() + timeoutMs;
  let lastInvocationStatus = null;
  while (Date.now() < deadline) {
    const query = new URLSearchParams({ invocationId, source });
    const findings = await client.request("GET", `/api/review-findings?${query}`);
    if ((findings.reviewFindings ?? []).length > 0) {
      return { ...findings, invocationStatus: lastInvocationStatus ?? "succeeded" };
    }

    const state = await client.request("GET", "/api/state");
    const invocation = (state.invocations ?? []).find((item) => item.id === invocationId);
    lastInvocationStatus = invocation?.status ?? null;
    if (["failed", "cancelled", "timed_out", "expired", "rejected"].includes(lastInvocationStatus)) {
      fail(`Invocation ${invocationId} ended without review findings: ${lastInvocationStatus}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  fail(`Timed out waiting for review findings for ${invocationId}.`);
}

function sourceForTool(toolName) {
  if (toolName === "codex.review.diff") return "codex";
  if (toolName === "claude.review.diff") return "claude";
  fail(`Unsupported review tool: ${toolName}`);
}

function parseArgs(args) {
  const parsed = {
    baseUrl: process.env.MYAGENTTOOL_API_URL ?? "http://127.0.0.1:3001",
    token: process.env.MYAGENTTOOL_API_TOKEN ?? null,
    tool: "claude.review.diff",
    projectId: null,
    worktreeId: null,
    instruction: "Review this diff for correctness and missing tests.",
    severityFloor: "medium",
    timeoutMs: 30_000,
    intervalMs: 500,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--base-url") {
      parsed.baseUrl = requireValue(args, ++index, arg);
    } else if (arg === "--token") {
      parsed.token = requireValue(args, ++index, arg);
    } else if (arg === "--tool") {
      parsed.tool = requireValue(args, ++index, arg);
    } else if (arg === "--project-id") {
      parsed.projectId = requireValue(args, ++index, arg);
    } else if (arg === "--worktree-id") {
      parsed.worktreeId = requireValue(args, ++index, arg);
    } else if (arg === "--instruction") {
      parsed.instruction = requireValue(args, ++index, arg);
    } else if (arg === "--severity-floor") {
      parsed.severityFloor = requireValue(args, ++index, arg);
    } else if (arg === "--timeout-ms") {
      parsed.timeoutMs = positiveInteger(requireValue(args, ++index, arg), arg);
    } else if (arg === "--interval-ms") {
      parsed.intervalMs = positiveInteger(requireValue(args, ++index, arg), arg);
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      fail(`Unsupported argument: ${arg}`);
    }
  }
  if (!["codex.review.diff", "claude.review.diff"].includes(parsed.tool)) {
    fail("--tool must be codex.review.diff or claude.review.diff.");
  }
  if (!["low", "medium", "high"].includes(parsed.severityFloor)) {
    fail("--severity-floor must be low, medium, or high.");
  }
  return parsed;
}

function requireValue(args, index, name) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    fail(`Missing value for ${name}.`);
  }
  return value;
}

function positiveInteger(value, name) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    fail(`${name} must be a positive integer.`);
  }
  return numeric;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  node tools/dev/tool-registry-review-client.mjs \\
    --base-url http://127.0.0.1:3001 \\
    --tool claude.review.diff \\
    --project-id prj_local \\
    --worktree-id wtr_local

Options:
  --base-url <url>              Defaults to MYAGENTTOOL_API_URL or http://127.0.0.1:3001
  --token <token>               Optional bearer token, defaults to MYAGENTTOOL_API_TOKEN
  --tool <name>                 codex.review.diff or claude.review.diff
  --project-id <id>
  --worktree-id <id>
  --instruction <text>
  --severity-floor <level>      low, medium, high
  --timeout-ms <ms>
  --interval-ms <ms>
`);
}
