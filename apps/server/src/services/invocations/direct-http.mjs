export function createInvocationDirectHttpRuntime({
  appendEvent,
  completeInvocation,
  findAgent,
  isTerminal,
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  maxConcurrency = positiveInteger(process.env.MYAGENTTOOL_DIRECT_HTTP_MAX_CONCURRENCY, 8),
  perAgentMaxConcurrency = positiveInteger(process.env.MYAGENTTOOL_DIRECT_HTTP_PER_AGENT_MAX_CONCURRENCY, 2),
}) {
  const directHttpRuns = new Map();
  const scheduledInvocationIds = new Set();
  const pending = [];
  const activeByAgent = new Map();
  let activeCount = 0;

  function startInvocationIfAllowed(invocation, agent = findAgent(invocation.agentId)) {
    if (!agent || invocation.status === "waiting_for_local_approval" || isTerminal(invocation.status)) {
      return;
    }
    if (agent.adapter.type !== "http" || agent.location.type !== "remote_http") return;
    if (scheduledInvocationIds.has(invocation.id) || directHttpRuns.has(invocation.id)) return;

    scheduledInvocationIds.add(invocation.id);
    if (hasCapacity(agent.id)) {
      launch(invocation, agent);
      return;
    }

    invocation.status = "queued";
    invocation.updatedAt = now();
    invocation.options = {
      ...(invocation.options ?? {}),
      metadata: {
        ...(invocation.options?.metadata ?? {}),
        remoteConcurrencyState: "queued",
      },
    };
    pending.push({ invocation, agent });
    appendEvent({
      invocationId: invocation.id,
      type: "remote_http_queued",
      level: "info",
      message: "HTTP Agent request is waiting for remote execution capacity.",
    });
  }

  function hasCapacity(agentId) {
    return activeCount < maxConcurrency && (activeByAgent.get(agentId) ?? 0) < perAgentMaxConcurrency;
  }

  function launch(invocation, agent) {
    activeCount += 1;
    activeByAgent.set(agent.id, (activeByAgent.get(agent.id) ?? 0) + 1);
    invocation.status = "running";
    invocation.updatedAt = now();
    if (invocation.options?.metadata?.remoteConcurrencyState) {
      const metadata = { ...invocation.options.metadata };
      delete metadata.remoteConcurrencyState;
      invocation.options = { ...invocation.options, metadata };
    }
    appendEvent({
      invocationId: invocation.id,
      type: "invocation_started",
      level: "info",
      message: `${agent.name} invocation started.`,
    });

    void runHttpInvocation(invocation, agent)
      .catch((error) => {
        completeInvocation(invocation, {
          status: "failed",
          summary: `HTTP Agent failed: ${error instanceof Error ? error.message : String(error)}`,
          result: null
        });
      })
      .finally(() => {
        activeCount = Math.max(0, activeCount - 1);
        const agentCount = Math.max(0, (activeByAgent.get(agent.id) ?? 1) - 1);
        if (agentCount === 0) activeByAgent.delete(agent.id);
        else activeByAgent.set(agent.id, agentCount);
        scheduledInvocationIds.delete(invocation.id);
        drainPending();
      });
  }

  function drainPending() {
    for (let index = 0; index < pending.length;) {
      const entry = pending[index];
      if (isTerminal(entry.invocation.status)) {
        pending.splice(index, 1);
        scheduledInvocationIds.delete(entry.invocation.id);
        continue;
      }
      if (!hasCapacity(entry.agent.id)) {
        index += 1;
        continue;
      }
      pending.splice(index, 1);
      launch(entry.invocation, entry.agent);
    }
  }

  function abortDirectHttpRun(invocation) {
    const controller = directHttpRuns.get(invocation.id);
    if (!controller) {
      return false;
    }
    appendEvent({
      invocationId: invocation.id,
      type: "cancel_dispatched",
      level: "info",
      message: "Server aborted the HTTP Agent request."
    });
    controller.abort();
    return true;
  }

  async function runHttpInvocation(invocation, agent) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Number(agent.adapter.timeoutSeconds ?? invocation.options.timeoutSeconds ?? 30) * 1000);
    directHttpRuns.set(invocation.id, controller);
    appendEvent({
      invocationId: invocation.id,
      type: "log",
      level: "info",
      message: `HTTP Agent request started for ${agent.name}.`
    });

    try {
      const url = new URL(agent.adapter.requestPath ?? "/invoke", agent.adapter.baseUrl);
      const response = await fetchImpl(url, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invocationId: invocation.id,
          task: invocation.input.task,
          input: invocation.input,
          options: invocation.options
        })
      });

      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = { output: text };
      }

      if (!response.ok) {
        completeInvocation(invocation, {
          status: "failed",
          summary: payload?.summary ?? `HTTP Agent failed with status ${response.status}.`,
          result: payload
        });
        return;
      }

      completeInvocation(invocation, {
        status: "succeeded",
        summary: payload?.summary ?? "HTTP Agent completed.",
        result: payload
      });
    } catch (error) {
      if (timedOut) {
        completeInvocation(invocation, {
          status: "timed_out",
          summary: "HTTP Agent request timed out.",
          result: null
        });
        return;
      }
      if (controller.signal.aborted) {
        completeInvocation(invocation, {
          status: "cancelled",
          summary: "HTTP Agent request was cancelled.",
          result: null
        });
        return;
      }
      completeInvocation(invocation, {
        status: "failed",
        summary: `HTTP Agent request failed: ${error instanceof Error ? error.message : String(error)}`,
        result: null
      });
    } finally {
      clearTimeout(timeout);
      directHttpRuns.delete(invocation.id);
    }
  }

  return {
    abortDirectHttpRun,
    startInvocationIfAllowed,
  };
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
