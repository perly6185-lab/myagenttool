import { callMcpTool } from "./mcp-client.mjs";
import { mcpLocalExecutionGate } from "./local-execution-policy.mjs";

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "timed_out", "cancelled"]);

export async function runMcpInvocation(work, {
  request,
  manifest,
  clientFn = callMcpTool,
  gateFn = mcpLocalExecutionGate,
} = {}) {
  if (typeof request !== "function") {
    throw new Error("MCP bridge runner requires a request function.");
  }
  const invocationId = work?.invocationId;
  const gate = gateFn(work, work?.adapter, { manifest });
  if (!gate.allowed) {
    await request("POST", "/api/bridge/events", {
      invocationId,
      type: "local_execution_refused",
      level: "error",
      message: gate.reason,
      data: gate.evidence,
    });
    await request("POST", "/api/bridge/complete", {
      invocationId,
      status: "failed",
      summary: gate.reason,
      result: {
        touchedUserFiles: false,
        policyDecision: "local_execution_refused",
        localExecutionGate: gate.evidence,
      },
    });
    return;
  }

  const outcome = await runMcpClientInvocation(work, { request, clientFn });
  await request("POST", "/api/bridge/complete", {
    invocationId,
    status: normalizeStatus(outcome?.status),
    summary: outcome?.summary ?? "MCP tool call completed.",
    result: outcome?.result ?? null,
  });
}

export async function runMcpClientInvocation(work, { request, clientFn = callMcpTool } = {}) {
  const invocationId = work?.invocationId;
  const task = String(work?.input?.task ?? "");
  const adapter = work?.adapter;
  let cancelRequested = false;
  const cancelTimer = setInterval(() => {
    if (cancelRequested) return;
    request("GET", `/api/bridge/cancel-status?invocationId=${encodeURIComponent(invocationId)}`)
      .then(async (status) => {
        if (!status?.cancelRequested || cancelRequested) return;
        cancelRequested = true;
        await request("POST", "/api/bridge/events", {
          invocationId,
          type: "cancel_dispatched",
          level: "info",
          message: "Desktop Bridge sent cancellation to the MCP server.",
        });
      })
      .catch(() => undefined);
  }, 250);

  try {
    return await clientFn({
      adapter,
      task,
      options: work?.options ?? {},
      shouldCancel: () => cancelRequested,
      onEvent: (event) => {
        request("POST", "/api/bridge/events", {
          invocationId,
          type: event?.type ?? "log",
          level: event?.level ?? "info",
          message: event?.message ?? "MCP event received.",
          ...(event?.data ? { data: event.data } : {}),
        }).catch(() => undefined);
      },
    });
  } catch (error) {
    return {
      status: "failed",
      summary: `MCP tool call failed: ${error instanceof Error ? error.message : String(error)}`,
      result: null,
    };
  } finally {
    clearInterval(cancelTimer);
  }
}

function normalizeStatus(status) {
  return TERMINAL_STATUSES.has(status) ? status : "failed";
}
