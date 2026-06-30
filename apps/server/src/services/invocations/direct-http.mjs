export function createInvocationDirectHttpRuntime({
  appendEvent,
  completeInvocation,
  findAgent,
  isTerminal,
}) {
  const directHttpRuns = new Map();

  function startInvocationIfAllowed(invocation, agent = findAgent(invocation.agentId)) {
    if (!agent || invocation.status === "waiting_for_local_approval" || isTerminal(invocation.status)) {
      return;
    }
    if (agent.adapter.type === "http" && agent.location.type === "remote_http") {
      queueMicrotask(() => runHttpInvocation(invocation, agent).catch((error) => {
        completeInvocation(invocation, {
          status: "failed",
          summary: `HTTP Agent failed: ${error instanceof Error ? error.message : String(error)}`,
          result: null
        });
      }));
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
      const response = await fetch(url, {
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
