import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
// The first app-server boot may migrate/open the user's runtime state before it
// can answer initialize. Keep that cold-start allowance separate from ordinary
// RPCs so a genuinely stuck turn/start still fails promptly.
const DEFAULT_INITIALIZE_TIMEOUT_MS = 60_000;
const DEFAULT_INTERRUPT_GRACE_MS = 10_000;

function providerFailureCode(message) {
  const text = String(message ?? "").trim();
  if (!text) return null;
  return /\b(?:selected\s+)?model\b.*\bat capacity\b/i.test(text)
    || /\bprovider\b.*\bcapacity\b/i.test(text)
    || /\bcapacity\b.*\b(?:unavailable|exhausted)\b/i.test(text)
    ? "provider_capacity"
    : null;
}

function transportFailureCode(message) {
  const text = String(message ?? "").trim();
  if (!text) return null;
  return /app-server (?:exited unexpectedly|stdin is not writable)/i.test(text)
    || /app-server transport closed/i.test(text)
    ? "transport_closed"
    : null;
}

/**
 * Minimal, version-tolerant client for Codex app-server's newline-delimited
 * JSON-RPC transport. One client can run multiple threads and survives between
 * turns; a turn normally completes on `turn/completed`, while process closure
 * is converted into a typed terminal failure.
 */
export function createCodexAppServerClient({
  command,
  args = ["app-server", "--stdio"],
  cwd,
  env,
  spawnProcess = spawn,
  onSpawn = () => undefined,
  terminateProcess = (processHandle) => processHandle.kill("SIGTERM"),
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  initializeTimeoutMs = DEFAULT_INITIALIZE_TIMEOUT_MS,
  interruptGraceMs = DEFAULT_INTERRUPT_GRACE_MS,
  clientInfo = {
    name: "myagenttool",
    title: "MyAgentTool Desktop Bridge",
    version: "0.1.0",
  },
  onStderr = () => undefined,
} = {}) {
  let child = null;
  let lineReader = null;
  let startPromise = null;
  let closed = false;
  let requestCounter = 0;
  const pending = new Map();
  const listeners = new Set();
  const stderrListeners = new Set();
  const activeThreadIds = new Set();
  const approvalHandlersByThread = new Map();

  function rawSend(message) {
    if (!child?.stdin?.writable) {
      throw new Error("Codex app-server stdin is not writable.");
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function request(method, params = {}, timeoutMs = requestTimeoutMs) {
    const id = ++requestCounter;
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectRequest(new Error(`Codex app-server ${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timer);
          resolveRequest(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectRequest(error);
        },
      });
      try {
        rawSend({ method, id, params });
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        rejectRequest(error);
      }
    });
  }

  function notify(method, params = {}) {
    rawSend({ method, params });
  }

  function failPending(error) {
    for (const waiter of pending.values()) {
      waiter.reject(error);
    }
    pending.clear();
  }

  async function respondToServerRequest(message) {
    const method = String(message.method ?? "");
    const params = message.params ?? {};
    if (method === "item/commandExecution/requestApproval"
      || method === "item/fileChange/requestApproval"
      || method === "item/permissions/requestApproval") {
      const handler = approvalHandlersByThread.get(params.threadId);
      let approved = false;
      try {
        const verdict = handler
          ? await handler({ method, params })
          : { approved: false, decision: "no_handler" };
        approved = verdict === true || verdict?.approved === true;
      } catch {
        approved = false;
      }
      rawSend({
        id: message.id,
        result: appServerApprovalResponse(method, params, approved),
      });
      return;
    }
    if (method === "applyPatchApproval" || method === "execCommandApproval") {
      rawSend({ id: message.id, result: { decision: "decline" } });
      return;
    }
    rawSend({
      id: message.id,
      error: {
        code: -32601,
        message: `MyAgentTool does not support app-server request ${method}.`,
      },
    });
  }

  function handleMessage(message) {
    if (message?.id !== undefined && !message.method) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) {
        waiter.reject(new Error(`Codex app-server ${waiter.method} failed: ${message.error.message ?? "unknown error"}`));
      } else {
        waiter.resolve(message.result);
      }
      return;
    }

    if (message?.id !== undefined && message.method) {
      void respondToServerRequest(message).catch(() => undefined);
      return;
    }

    if (message?.method) {
      for (const listener of listeners) {
        try {
          listener(message);
        } catch {
          // A consumer event handler cannot break the transport reader.
        }
      }
    }
  }

  function spawnServer() {
    if (closed) {
      throw new Error("Codex app-server client is closed.");
    }
    const spawnedChild = spawnProcess(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child = spawnedChild;
    onSpawn(spawnedChild);
    const spawnedLineReader = createInterface({ input: spawnedChild.stdout });
    lineReader = spawnedLineReader;
    spawnedLineReader.on("line", (line) => {
      const trimmed = String(line ?? "").trim();
      if (!trimmed) return;
      try {
        handleMessage(JSON.parse(trimmed));
      } catch {
        onStderr(`Codex app-server emitted malformed JSON: ${trimmed.slice(0, 300)}`);
      }
    });
    spawnedChild.stderr?.on("data", (chunk) => {
      const text = chunk.toString("utf8").trim();
      if (!text) return;
      onStderr(text);
      for (const listener of stderrListeners) {
        try {
          listener(text);
        } catch {
          // A consumer stderr handler cannot break the transport reader.
        }
      }
    });
    spawnedChild.on("error", (error) => {
      if (child === spawnedChild) failPending(error);
    });
    spawnedChild.on("close", (code, signal) => {
      const wasCurrentTransport = child === spawnedChild;
      const error = new Error(`Codex app-server exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "none"}).`);
      if (wasCurrentTransport) {
        failPending(error);
        for (const listener of listeners) {
          try {
            listener({ method: "transport/closed", params: { error } });
          } catch {
            // Ignore consumer cleanup errors.
          }
        }
      }
      if (wasCurrentTransport) child = null;
      if (lineReader === spawnedLineReader) lineReader = null;
      if (!closed && child === null) startPromise = null;
    });
    return spawnedChild;
  }

  async function start() {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      spawnServer();
      const result = await request("initialize", {
        clientInfo,
        capabilities: {
          experimentalApi: true,
        },
      }, initializeTimeoutMs);
      notify("initialized", {});
      return result;
    })();
    try {
      return await startPromise;
    } catch (error) {
      const failedChild = child;
      if (failedChild && failedChild.exitCode === null) terminateProcess(failedChild);
      if (child === failedChild) child = null;
      lineReader?.close();
      lineReader = null;
      startPromise = null;
      throw error;
    }
  }

  async function runTurn({
    task,
    cwd: turnCwd,
    writableRoots = [],
    sandbox = "workspace-write",
    approvalPolicy = "on-request",
    approvalsReviewer = "user",
    model = null,
    threadId: resumeThreadId = null,
    timeoutMs = 0,
    commandIdleTimeoutMs = 0,
    shouldCancel = () => false,
    onEvent = () => undefined,
    onTurnStderr = () => undefined,
    onApprovalRequest = null,
  } = {}) {
    let threadId = resumeThreadId;
    let ownsActiveThread = false;
    let turnId = null;
    let terminal = null;
    let lastAgentMessage = "";
    let tokenUsage = null;
    let touchedUserFiles = false;
    let cancelRequested = false;
    let timeoutKind = null;
    let eventChain = Promise.resolve();
    let resolveTerminal;
    let rejectTerminal;
    const terminalPromise = new Promise((resolveValue, rejectValue) => {
      resolveTerminal = resolveValue;
      rejectTerminal = rejectValue;
    });
    const activeCommandTimers = new Map();

    const roots = [...new Set([turnCwd, ...writableRoots].filter(Boolean))];

    function clearCommandTimer(itemId) {
      const timer = activeCommandTimers.get(itemId);
      if (timer) clearTimeout(timer);
      activeCommandTimers.delete(itemId);
    }

    function armCommandTimer(item) {
      const configured = Number(commandIdleTimeoutMs);
      if (!Number.isFinite(configured) || configured <= 0 || !item?.id) return;
      clearCommandTimer(item.id);
      activeCommandTimers.set(item.id, setTimeout(() => {
        timeoutKind = "command_idle";
        void interruptTurn();
      }, configured));
    }

    function clearTimers() {
      for (const timer of activeCommandTimers.values()) clearTimeout(timer);
      activeCommandTimers.clear();
    }

    function appendEvent(event) {
      eventChain = eventChain
        .then(() => onEvent(event))
        .catch(() => undefined);
    }

    async function interruptTurn() {
      if (!threadId || !turnId || terminal) return;
      try {
        await request("turn/interrupt", { threadId, turnId });
      } catch {
        // The terminal notification or transport close remains authoritative.
      }
    }

    let unsubscribe = () => undefined;
    const unsubscribeStderr = subscribeStderr(onTurnStderr);
    const handleNotification = (message) => {
      const params = message.params ?? {};
      const messageThreadId = params.threadId ?? params.thread?.id ?? null;
      const messageTurnId = params.turnId ?? params.turn?.id ?? null;
      if (threadId && messageThreadId && messageThreadId !== threadId) return;
      if (turnId && messageTurnId && messageTurnId !== turnId) return;

      if (message.method === "transport/closed") {
        rejectTerminal(params.error ?? new Error("Codex app-server transport closed."));
        return;
      }

      const normalized = normalizeCodexAppServerNotification(message);
      if (normalized?.type === "turn.completed") {
        normalized.usage = normalizeTokenUsage(tokenUsage);
      }
      if (normalized) appendEvent(normalized);

      if (message.method === "thread/tokenUsage/updated") {
        tokenUsage = params.tokenUsage?.last ?? params.tokenUsage?.total ?? null;
      }
      if (message.method === "item/started" && params.item?.type === "commandExecution") {
        armCommandTimer(params.item);
      }
      if (message.method === "item/commandExecution/outputDelta" && params.itemId) {
        armCommandTimer({ id: params.itemId });
      }
      if (message.method === "item/completed") {
        if (params.item?.type === "commandExecution") clearCommandTimer(params.item.id);
        if (params.item?.type === "fileChange" && params.item.status === "completed") touchedUserFiles = true;
        if (params.item?.type === "agentMessage" && params.item.text) lastAgentMessage = String(params.item.text);
      }
      if (message.method === "turn/completed") {
        terminal = params.turn ?? { status: "failed", error: { message: "Missing turn result." } };
        clearTimers();
        void eventChain.then(() => resolveTerminal(terminal));
      }
    };

    let totalTimer = null;
    let cancelTimer = null;
    let interruptWatchTimer = null;
    let interruptGraceTimer = null;
    try {
      // Keep transport startup inside the terminal-result boundary. Previously,
      // initialize/start failures escaped runTurn entirely, so the Desktop
      // Bridge never posted /api/bridge/complete and the invocation remained a
      // zombie "running" record.
      await start();

      const threadParams = {
        cwd: turnCwd,
        runtimeWorkspaceRoots: roots,
        approvalPolicy,
        approvalsReviewer,
        sandbox,
        ...(model ? { model: String(model) } : {}),
      };
      const threadResult = resumeThreadId
        ? await request("thread/resume", { threadId: resumeThreadId, ...threadParams })
        : await request("thread/start", threadParams);
      threadId = threadResult?.thread?.id ?? resumeThreadId;
      if (!threadId) {
        throw new Error("Codex app-server did not return a thread id.");
      }
      if (activeThreadIds.has(threadId)) {
        throw new Error(`Codex app-server thread ${threadId} already has an active turn.`);
      }
      activeThreadIds.add(threadId);
      ownsActiveThread = true;
      if (typeof onApprovalRequest === "function") {
        approvalHandlersByThread.set(threadId, onApprovalRequest);
      }
      unsubscribe = subscribe(handleNotification);
      appendEvent({ type: "thread.started", thread_id: threadId });

      const turnResult = await request("turn/start", {
        threadId,
        input: [{ type: "text", text: String(task ?? "") }],
      });
      turnId = turnResult?.turn?.id ?? null;
      if (!turnId) {
        throw new Error("Codex app-server did not return a turn id.");
      }

      const configuredTimeout = Number(timeoutMs);
      if (Number.isFinite(configuredTimeout) && configuredTimeout > 0) {
        totalTimer = setTimeout(() => {
          timeoutKind = "invocation_total";
          void interruptTurn();
        }, configuredTimeout);
      }

      cancelTimer = setInterval(() => {
        if (!cancelRequested && shouldCancel()) {
          cancelRequested = true;
          void interruptTurn();
        }
      }, 200);

      const interruptedTerminal = new Promise((_, rejectWait) => {
        interruptWatchTimer = setInterval(() => {
          if (!timeoutKind && !cancelRequested) return;
          clearInterval(interruptWatchTimer);
          interruptWatchTimer = null;
          interruptGraceTimer = setTimeout(() => {
            rejectWait(new Error(`Codex app-server did not complete after turn/interrupt (${timeoutKind ?? "cancelled"}).`));
          }, interruptGraceMs);
        }, 100);
      });
      const finalTurn = await Promise.race([terminalPromise, interruptedTerminal]);
      const finalStatus = String(finalTurn.status ?? "failed");
      const status = timeoutKind
        ? "timed_out"
        : cancelRequested || finalStatus === "interrupted"
          ? "cancelled"
          : finalStatus === "completed"
            ? "succeeded"
            : "failed";
      const errorMessage = finalTurn.error?.message ?? null;
      const providerErrorCode = providerFailureCode(errorMessage);
      return {
        status,
        summary: status === "succeeded"
          ? lastAgentMessage || "Codex app-server turn completed."
          : errorMessage || `Codex app-server turn ${status}.`,
        result: {
          threadId,
          turnId,
          transport: "app-server",
          touchedUserFiles,
          timeoutKind,
          ...(timeoutKind
            ? { errorCode: "execution_timeout" }
            : providerErrorCode
              ? { errorCode: providerErrorCode }
              : {}),
          output: {
            latestMessage: lastAgentMessage || null,
            usage: normalizeTokenUsage(tokenUsage),
          },
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const providerErrorCode = providerFailureCode(errorMessage);
      const transportErrorCode = transportFailureCode(errorMessage);
      return {
        status: timeoutKind ? "timed_out" : cancelRequested ? "cancelled" : "failed",
        summary: errorMessage,
        result: {
          threadId,
          turnId,
          transport: "app-server",
          touchedUserFiles,
          timeoutKind,
          errorCode: timeoutKind
            ? "execution_timeout"
            : providerErrorCode ?? transportErrorCode ?? "app_server_error",
        },
      };
    } finally {
      if (totalTimer) clearTimeout(totalTimer);
      if (cancelTimer) clearInterval(cancelTimer);
      if (interruptWatchTimer) clearInterval(interruptWatchTimer);
      if (interruptGraceTimer) clearTimeout(interruptGraceTimer);
      clearTimers();
      unsubscribe();
      unsubscribeStderr();
      if (ownsActiveThread && threadId) approvalHandlersByThread.delete(threadId);
      if (ownsActiveThread && threadId) activeThreadIds.delete(threadId);
      await eventChain;
    }
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function subscribeStderr(listener) {
    stderrListeners.add(listener);
    return () => stderrListeners.delete(listener);
  }

  function close() {
    if (closed) return;
    closed = true;
    failPending(new Error("Codex app-server client closed."));
    approvalHandlersByThread.clear();
    lineReader?.close();
    if (child && child.exitCode === null) {
      terminateProcess(child);
    }
    child = null;
    startPromise = null;
  }

  return {
    start,
    request,
    runTurn,
    close,
    snapshot: () => ({
      running: Boolean(child && child.exitCode === null),
      pendingRequests: pending.size,
      listeners: listeners.size,
      approvalHandlers: approvalHandlersByThread.size,
    }),
  };
}

function appServerApprovalResponse(method, params, approved) {
  if (method === "item/permissions/requestApproval") {
    return {
      permissions: approved ? (params.permissions ?? {}) : {},
      scope: "turn",
    };
  }
  return { decision: approved ? "accept" : "decline" };
}

export function normalizeCodexAppServerNotification(message) {
  const method = String(message?.method ?? "");
  const params = message?.params ?? {};
  if (method === "thread/started") {
    return { type: "thread.started", thread_id: params.thread?.id ?? params.threadId ?? null };
  }
  if (method === "turn/started") {
    return { type: "turn.started" };
  }
  if (method === "turn/completed") {
    const status = String(params.turn?.status ?? "failed");
    if (status === "failed" || status === "interrupted") {
      return {
        type: "turn.failed",
        error: params.turn?.error ?? { message: `Codex turn ${status}.` },
      };
    }
    return {
      type: "turn.completed",
      usage: null,
      turn_status: status,
    };
  }
  if (method === "error") {
    return { type: "error", error: params.error ?? params };
  }
  if (method === "item/started" || method === "item/completed") {
    return {
      type: method === "item/started" ? "item.started" : "item.completed",
      item: normalizeThreadItem(params.item),
    };
  }
  return null;
}

function normalizeThreadItem(item = {}) {
  const typeMap = {
    agentMessage: "agent_message",
    commandExecution: "command_execution",
    fileChange: "file_change",
  };
  const normalized = {
    ...item,
    type: typeMap[item.type] ?? item.type,
  };
  if (item.type === "fileChange" && Array.isArray(item.changes)) {
    normalized.files = item.changes.map((change) => ({
      path: change.path,
      action: change.kind,
      diff: change.diff ?? null,
    }));
    normalized.path = item.changes[0]?.path ?? null;
    normalized.action = item.changes[0]?.kind ?? item.status ?? "changed";
  }
  if (item.type === "commandExecution") {
    normalized.exit_code = item.exitCode ?? null;
    normalized.aggregated_output = item.aggregatedOutput ?? "";
  }
  return normalized;
}

function normalizeTokenUsage(usage) {
  if (!usage) return null;
  return {
    input_tokens: Number(usage.inputTokens ?? 0) || 0,
    cached_input_tokens: Number(usage.cachedInputTokens ?? 0) || 0,
    cache_write_input_tokens: Number(usage.cacheWriteInputTokens ?? 0) || 0,
    output_tokens: Number(usage.outputTokens ?? 0) || 0,
    reasoning_output_tokens: Number(usage.reasoningOutputTokens ?? 0) || 0,
    total_tokens: Number(usage.totalTokens ?? 0) || 0,
  };
}
