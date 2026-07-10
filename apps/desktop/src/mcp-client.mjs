/*
 * Live MCP client for the Desktop Bridge — stdio transport.
 *
 * Executes the declarative adapter config from @myagenttool/adapters/mcp: spawn
 * the server command, speak newline-delimited JSON-RPC over stdin/stdout
 * (initialize → notifications/initialized → tools/list → tools/call), forward
 * server notifications as bridge events, and map cancellation to the MCP
 * `notifications/cancelled` notification followed by process termination.
 *
 * Kept transport-pure (no /api/bridge calls) so it is testable against a
 * fixture MCP server; index.mjs owns the ack/events/complete glue.
 */

import { spawn } from "node:child_process";
import { describeMcpToolCall } from "@myagenttool/adapters/mcp";

const PROTOCOL_VERSION = "2025-03-26";
const CLIENT_INFO = { name: "myagenttool-desktop-bridge", version: "0.0.0" };
const HANDSHAKE_TIMEOUT_MS = 10_000;
const CANCEL_GRACE_MS = 500;

// A spawned MCP server is often a third-party npm package. Handing it the
// bridge's full `process.env` would leak every secret/token in the bridge
// process to untrusted code. Pass only a curated, non-secret base (enough for a
// node/npx-based server to run) plus any env the operator explicitly configured
// on the registration.
export const SAFE_MCP_ENV_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  // Unix identity vars (non-secret). USER is required for the claude CLI's
  // keychain-backed login lookup — without it a child spawn reports "Not logged
  // in" even though the machine's login state is intact (B1b Tier 1 soak finding).
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SHELL",
  "PATHEXT",
  "SYSTEMROOT",
  "windir",
  "COMSPEC",
  "NODE_EXTRA_CA_CERTS",
];

export function buildMcpChildEnv(adapter) {
  const env = {};
  for (const key of SAFE_MCP_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const explicit = adapter && typeof adapter.env === "object" && !Array.isArray(adapter.env) ? adapter.env : {};
  for (const [key, value] of Object.entries(explicit)) env[String(key)] = String(value);
  return env;
}

/** One newline-delimited JSON-RPC session over a child process's stdio. */
function createStdioSession(adapter, onEvent) {
  const child = spawn(adapter.command, adapter.args ?? [], {
    stdio: ["pipe", "pipe", "pipe"],
    env: buildMcpChildEnv(adapter),
    ...(adapter.cwd ? { cwd: adapter.cwd } : {}),
  });

  let nextId = 1;
  const pending = new Map(); // id → {resolve, reject}
  let stdoutBuffer = "";
  let spawnError = null;

  child.on("error", (error) => {
    spawnError = error;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  });

  // A dead server can never answer: fail in-flight requests immediately instead
  // of letting them sit until their timeout (also makes cancellation prompt —
  // kill() resolves the pending call within the grace period, not the timeout).
  child.on("close", () => {
    const error = new Error("MCP server exited before responding.");
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  });

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        onEvent({ type: "log", level: "warn", message: `MCP server emitted non-JSON output: ${line.slice(0, 160)}` });
        continue;
      }
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message ?? "MCP request failed."));
        else resolve(message.result);
      } else if (message.method === "notifications/message") {
        const params = message.params ?? {};
        const text = typeof params.data === "string" ? params.data : JSON.stringify(params.data ?? {});
        onEvent({ type: "log", level: params.level === "error" ? "warn" : "info", message: `MCP: ${text}` });
      } else if (message.method === "notifications/progress") {
        const params = message.params ?? {};
        onEvent({ type: "log", level: "info", message: `MCP progress: ${params.progress ?? "?"}${params.total ? `/${params.total}` : ""}` });
      }
      // Other server→client requests (sampling, roots) are out of scope for the
      // first slice and intentionally ignored.
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8").trim();
    if (text) onEvent({ type: "log", level: "warn", message: `MCP stderr: ${text.slice(0, 300)}` });
  });

  function send(message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function request(method, params, { timeoutMs }) {
    const id = nextId++;
    return {
      id,
      promise: new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MCP request ${method} timed out.`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        send({ jsonrpc: "2.0", id, method, params });
      }),
    };
  }

  function kill() {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    setTimeout(() => {
      try {
        if (child.exitCode === null) child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, CANCEL_GRACE_MS).unref?.();
  }

  return {
    child,
    send,
    request,
    kill,
    get spawnError() {
      return spawnError;
    },
  };
}

/**
 * Streamable-HTTP MCP session with the same interface as the stdio one. Each
 * request POSTs a JSON-RPC message; the response is either application/json
 * (single response) or text/event-stream (scan frames for our id, forwarding
 * notifications). The Mcp-Session-Id header from initialize is echoed on every
 * later call. kill() aborts all in-flight requests.
 */
function createHttpMcpSession(adapter, onEvent) {
  let nextId = 1;
  let sessionId = null;
  const controllers = new Set();

  function handleNotification(message) {
    if (message.method === "notifications/message") {
      const params = message.params ?? {};
      const text = typeof params.data === "string" ? params.data : JSON.stringify(params.data ?? {});
      onEvent({ type: "log", level: params.level === "error" ? "warn" : "info", message: `MCP: ${text}` });
    }
  }

  async function post(message, timeoutMs) {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(adapter.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(adapter.headers ?? {}),
          ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        },
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      sessionId = response.headers.get("mcp-session-id") ?? sessionId;
      if (!response.ok) {
        throw new Error(`MCP http endpoint answered ${response.status}.`);
      }
      if (message.id === undefined) return null; // notification — no body expected
      const contentType = response.headers.get("content-type") ?? "";
      if (/application\/json/i.test(contentType)) {
        const body = await response.json();
        if (body.error) throw new Error(body.error.message ?? "MCP request failed.");
        return body.result;
      }
      if (/text\/event-stream/i.test(contentType)) {
        let buffer = "";
        for await (const chunk of response.body) {
          buffer += Buffer.from(chunk).toString("utf8");
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const data = frame
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("");
            if (!data) continue;
            let parsed;
            try {
              parsed = JSON.parse(data);
            } catch {
              continue;
            }
            if (parsed.id === message.id) {
              if (parsed.error) throw new Error(parsed.error.message ?? "MCP request failed.");
              return parsed.result;
            }
            handleNotification(parsed);
          }
        }
        throw new Error("MCP http stream ended without a response.");
      }
      throw new Error(`MCP http endpoint answered an unexpected content-type: ${contentType || "none"}.`);
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(`MCP request ${message.method} timed out.`);
      throw error;
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }

  return {
    send(message) {
      post(message, HANDSHAKE_TIMEOUT_MS).catch(() => undefined); // fire-and-forget notification
    },
    request(method, params, { timeoutMs }) {
      const id = nextId++;
      return { id, promise: post({ jsonrpc: "2.0", id, method, params }, timeoutMs) };
    },
    kill() {
      for (const controller of controllers) controller.abort();
    },
    get spawnError() {
      return null;
    },
  };
}

function createMcpSession(adapter, onEvent) {
  return adapter.transport === "http" ? createHttpMcpSession(adapter, onEvent) : createStdioSession(adapter, onEvent);
}

export function mcpHandshakeTimeoutMs(adapter) {
  const configured = Number(adapter?.startupTimeoutMs ?? adapter?.timeoutMs);
  return Number.isFinite(configured)
    ? Math.max(HANDSHAKE_TIMEOUT_MS, Math.floor(configured))
    : HANDSHAKE_TIMEOUT_MS;
}

async function handshake(session, timeoutMs = HANDSHAKE_TIMEOUT_MS) {
  await session.request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: CLIENT_INFO,
  }, { timeoutMs }).promise;
  session.send({ jsonrpc: "2.0", method: "notifications/initialized" });
}

/** Extract readable text from an MCP tools/call result's content array. */
function contentText(result) {
  const parts = Array.isArray(result?.content) ? result.content : [];
  return parts
    .map((part) => (part?.type === "text" ? part.text : `[${part?.type ?? "unknown"}]`))
    .join("\n")
    .trim();
}

/** Resolve which tool to call: explicit option, adapter default, single listed
 *  tool, or a single-entry allowlist. Anything else is an explicit error. */
function resolveToolName(adapter, options, tools) {
  const explicit = options?.toolName ?? adapter?.toolName;
  if (explicit) return String(explicit);
  if (tools.length === 1) return tools[0].name;
  if ((adapter.allowedTools ?? []).length === 1) return adapter.allowedTools[0];
  throw new Error(
    `MCP server exposes ${tools.length} tools (${tools.map((t) => t.name).join(", ") || "none"}); set toolName to pick one.`,
  );
}

/**
 * Spawn the MCP server, call one tool with the task, and return a terminal
 * outcome. `shouldCancel` is polled; on cancellation the client sends
 * notifications/cancelled for the in-flight call, then stops the process.
 */
export async function callMcpTool({ adapter, task, options = {}, onEvent = () => {}, shouldCancel = () => false }) {
  const session = createMcpSession(adapter, onEvent);
  const timeoutMs = Number(adapter.timeoutMs ?? 60_000);
  const handshakeTimeoutMs = mcpHandshakeTimeoutMs(adapter);
  let cancelled = false;
  let cancelTimer = null;

  try {
    await handshake(session, handshakeTimeoutMs);
    if (session.spawnError) throw session.spawnError;

    const listed = await session.request("tools/list", {}, { timeoutMs: handshakeTimeoutMs }).promise;
    const tools = Array.isArray(listed?.tools) ? listed.tools : [];
    const toolName = resolveToolName(adapter, options, tools);
    const args =
      options.toolArguments && typeof options.toolArguments === "object" && !Array.isArray(options.toolArguments)
        ? options.toolArguments
        : { task: String(task ?? "") };

    // Allowlist enforcement + descriptor shape come from the shared slice.
    const descriptor = describeMcpToolCall(adapter, toolName, args);
    onEvent({ type: "log", level: "info", message: `MCP calling tool ${toolName}.` });

    const call = session.request(descriptor.method, descriptor.params, { timeoutMs });
    cancelTimer = setInterval(() => {
      if (cancelled || !shouldCancel()) return;
      cancelled = true;
      session.send({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: call.id, reason: "Cancelled from the control plane." },
      });
      session.kill();
    }, 250);

    const result = await call.promise;
    if (cancelled) {
      return { status: "cancelled", summary: `MCP tool ${toolName} was cancelled.`, result: null };
    }
    const text = contentText(result);
    if (result?.isError) {
      return { status: "failed", summary: `MCP tool ${toolName} reported an error.`, result: { output: text } };
    }
    return {
      status: "succeeded",
      summary: text ? text.slice(0, 200) : `MCP tool ${toolName} completed.`,
      result: { toolName, output: text },
    };
  } catch (error) {
    if (cancelled) {
      return { status: "cancelled", summary: "MCP tool call was cancelled.", result: null };
    }
    const timedOut = /timed out/i.test(error?.message ?? "");
    return {
      status: timedOut ? "timed_out" : "failed",
      summary: session.spawnError
        ? `MCP server could not start: ${session.spawnError.message}`
        : `MCP tool call failed: ${error?.message ?? error}`,
      result: null,
    };
  } finally {
    if (cancelTimer) clearInterval(cancelTimer);
    session.kill();
  }
}

/** Health probe: spawn, handshake, list tools, stop. Proves the configured
 *  command really is a speaking MCP server, not just an existing binary. */
export async function probeMcpServer(adapter) {
  const session = createMcpSession(adapter, () => {});
  const handshakeTimeoutMs = mcpHandshakeTimeoutMs(adapter);
  try {
    await handshake(session, handshakeTimeoutMs);
    const listed = await session.request("tools/list", {}, { timeoutMs: handshakeTimeoutMs }).promise;
    const tools = Array.isArray(listed?.tools) ? listed.tools.map(publicMcpTool) : [];
    const toolNames = tools.map((tool) => tool.name).filter(Boolean);
    return { ok: true, message: `MCP server is reachable and exposes ${toolNames.length} tool(s): ${toolNames.join(", ") || "none"}.`, tools };
  } catch (error) {
    return {
      ok: false,
      message: session.spawnError
        ? `MCP server could not start: ${session.spawnError.message}`
        : `MCP handshake failed: ${error?.message ?? error}`,
      nextAction: "Check the MCP server command and arguments.",
    };
  } finally {
    session.kill();
  }
}

function publicMcpTool(tool) {
  return {
    name: String(tool?.name ?? ""),
    ...(typeof tool?.description === "string" ? { description: tool.description } : {}),
    ...(tool?.inputSchema && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema)
      ? { inputSchema: tool.inputSchema }
      : {}),
  };
}
