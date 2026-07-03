/*
 * Live A2A client for the Desktop Bridge.
 *
 * Executes the declarative adapter config from @myagenttool/adapters/a2a:
 * fetch the Agent Card, POST the task as JSON-RPC message/send (via the shared
 * descriptor), poll tasks/get until the task is terminal, and map cancellation
 * to tasks/cancel. Runs on the bridge so agents on networks only the user's
 * device can reach stay usable.
 *
 * First slice is poll-based; consuming the message/stream SSE is a follow-up.
 * Kept transport-pure (no /api/bridge calls) so it is testable against a
 * fixture A2A server; index.mjs owns the events/complete glue.
 */

import { describeA2aTaskCancel, describeA2aTaskSend } from "@myagenttool/adapters/a2a";

const POLL_INTERVAL_MS = 500;
const TERMINAL_STATES = new Set(["completed", "failed", "canceled", "cancelled", "rejected"]);

let rpcCounter = 1;

async function rpc(endpoint, headers, payload, timeoutMs) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ ...payload, id: rpcCounter++ }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`A2A endpoint answered ${response.status}.`);
  }
  const body = await response.json();
  if (body.error) {
    throw new Error(body.error.message ?? "A2A request failed.");
  }
  return body.result;
}

/** Pull readable text out of an A2A message or task (artifacts + status). */
function extractText(result) {
  const parts = [];
  const takeParts = (list) => {
    for (const part of list ?? []) {
      if (part?.kind === "text" || part?.type === "text") parts.push(part.text);
    }
  };
  if (result?.kind === "message" || result?.role) takeParts(result.parts);
  for (const artifact of result?.artifacts ?? []) takeParts(artifact.parts);
  takeParts(result?.status?.message?.parts);
  return parts.join("\n").trim();
}

function taskState(result) {
  return String(result?.status?.state ?? "").toLowerCase();
}

async function fetchAgentCard(adapter, timeoutMs) {
  const response = await fetch(`${adapter.agentUrl}${adapter.agentCardPath}`, {
    headers: adapter.headers ?? {},
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Agent Card fetch answered ${response.status}.`);
  }
  const card = await response.json();
  if (!card || typeof card !== "object" || !card.name) {
    throw new Error("Agent Card is not a valid A2A card.");
  }
  return card;
}

/**
 * Consume a message/stream SSE response until a terminal event. Each SSE data
 * line is a JSON-RPC response whose result is a Task, Message, or status/
 * artifact update event. Returns the last task-shaped result (with artifacts
 * merged in) or a direct message. Cancellation aborts the stream after sending
 * tasks/cancel for the announced task id.
 */
async function consumeA2aStream({ endpoint, headers, payload, deadline, shouldCancel, onEvent }) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1_000, deadline - Date.now()));
  const cancelTimer = setInterval(async () => {
    if (!shouldCancel()) return;
    clearInterval(cancelTimer);
    if (streamTaskId) {
      await rpc(endpoint, headers, describeA2aTaskCancel(streamTaskId), 5_000).catch(() => undefined);
    }
    controller.abort();
  }, 250);

  let streamTaskId = null;
  let lastTask = null;
  const artifacts = [];
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream", ...headers },
      body: JSON.stringify({ ...payload, method: "message/stream", id: rpcCounter++ }),
      signal: controller.signal,
    });
    if (!response.ok || !/text\/event-stream/i.test(response.headers.get("content-type") ?? "")) {
      throw new Error(`A2A stream endpoint answered ${response.status} (${response.headers.get("content-type") ?? "no content-type"}).`);
    }
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += Buffer.from(chunk).toString("utf8");
      // SSE events are separated by a blank line; data lines carry the payload.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (!data) continue;
        let message;
        try {
          message = JSON.parse(data);
        } catch {
          continue;
        }
        const result = message.result ?? message;
        if (result?.id && result?.status) {
          streamTaskId = result.id;
          lastTask = result;
        }
        if (result?.artifact) {
          artifacts.push(result.artifact);
          streamTaskId = streamTaskId ?? result.taskId ?? null;
        }
        if (result?.status?.state) {
          onEvent({ level: "info", message: `A2A task ${result.status.state}.` });
          if (result.final === true || TERMINAL_STATES.has(String(result.status.state).toLowerCase())) {
            const task = lastTask ?? { id: streamTaskId, status: result.status };
            return { ...task, status: result.status, artifacts: [...(task.artifacts ?? []), ...artifacts] };
          }
        }
        if (result?.kind === "message" || (result?.role && !result?.status)) {
          return result; // direct terminal message over the stream
        }
      }
    }
    throw new Error("A2A stream ended without a terminal event.");
  } catch (error) {
    // A --slow stream ends only via our timeout abort (or a cancel), so classify
    // a timeout deterministically instead of racing a wall-clock comparison that
    // can misread scheduling jitter as a plain failure.
    if (timedOut) {
      throw Object.assign(new Error("A2A stream exceeded its configured timeout."), { a2aTimedOut: true });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    clearInterval(cancelTimer);
  }
}

/**
 * Send one task to the A2A agent and wait for a terminal outcome. The card's
 * `url` (its declared RPC endpoint) wins over the configured base URL. When the
 * card declares streaming capability the task is consumed over the
 * message/stream SSE; otherwise (or if the stream is cancelled) we fall back to
 * the message/send + tasks/get polling path.
 */
export async function callA2aAgent({ adapter, task, options = {}, onEvent = () => {}, shouldCancel = () => false }) {
  const timeoutMs = Number(adapter.timeoutMs ?? 120_000);
  const deadline = Date.now() + timeoutMs;
  const stepTimeout = () => Math.max(1_000, Math.min(30_000, deadline - Date.now()));

  let endpoint;
  let remoteTaskId = null;
  try {
    const card = await fetchAgentCard(adapter, stepTimeout());
    endpoint = card.url ?? adapter.agentUrl;
    onEvent({ level: "info", message: `A2A agent "${card.name}" reachable at ${endpoint}.` });

    const send = describeA2aTaskSend(adapter, task, { skillId: options.skillId ?? null });
    let result;
    if (card.capabilities?.streaming) {
      try {
        result = await consumeA2aStream({ endpoint, headers: adapter.headers, payload: send, deadline, shouldCancel, onEvent });
      } catch (error) {
        if (shouldCancel()) {
          return { status: "cancelled", summary: "A2A task was cancelled.", result: null };
        }
        if (error?.a2aTimedOut || Date.now() >= deadline) {
          return { status: "timed_out", summary: "A2A task exceeded its configured timeout.", result: null };
        }
        throw error;
      }
    } else {
      result = await rpc(endpoint, adapter.headers, send, stepTimeout());
    }

    // A direct message reply is already terminal.
    if (result?.kind === "message" || (result?.role && !result?.status)) {
      const text = extractText(result);
      return { status: "succeeded", summary: text.slice(0, 200) || "A2A agent replied.", result: { output: text } };
    }

    remoteTaskId = result?.id ?? null;
    while (!TERMINAL_STATES.has(taskState(result))) {
      if (Date.now() >= deadline) {
        if (remoteTaskId) await rpc(endpoint, adapter.headers, describeA2aTaskCancel(remoteTaskId), 5_000).catch(() => undefined);
        return { status: "timed_out", summary: "A2A task exceeded its configured timeout.", result: null };
      }
      if (shouldCancel()) {
        if (remoteTaskId) await rpc(endpoint, adapter.headers, describeA2aTaskCancel(remoteTaskId), 5_000).catch(() => undefined);
        return { status: "cancelled", summary: "A2A task was cancelled.", result: null };
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (!remoteTaskId) throw new Error("A2A agent returned a task without an id.");
      result = await rpc(endpoint, adapter.headers, { jsonrpc: "2.0", method: "tasks/get", params: { id: remoteTaskId } }, stepTimeout());
    }

    const state = taskState(result);
    const text = extractText(result);
    if (state === "completed") {
      return { status: "succeeded", summary: text.slice(0, 200) || "A2A task completed.", result: { taskId: remoteTaskId, output: text } };
    }
    if (state === "canceled" || state === "cancelled") {
      return { status: "cancelled", summary: "A2A task was cancelled remotely.", result: null };
    }
    return { status: "failed", summary: text.slice(0, 200) || `A2A task ended ${state}.`, result: { taskId: remoteTaskId, output: text } };
  } catch (error) {
    const timedOut = /timeout|timed out/i.test(error?.message ?? "") || error?.name === "TimeoutError";
    return {
      status: timedOut ? "timed_out" : "failed",
      summary: `A2A call failed: ${error?.message ?? error}`,
      result: null,
    };
  }
}

/** Health probe: the Agent Card must fetch and parse. */
export async function probeA2aAgent(adapter) {
  try {
    const card = await fetchAgentCard(adapter, 10_000);
    const skills = (card.skills ?? []).map((s) => s.id ?? s.name).filter(Boolean);
    return { ok: true, message: `A2A agent "${card.name}" is reachable; skills: ${skills.join(", ") || "unspecified"}.` };
  } catch (error) {
    return { ok: false, message: `A2A agent card fetch failed: ${error?.message ?? error}`, nextAction: "Check the agent URL and card path." };
  }
}
