const COMMAND_EVENT_TYPES = new Set([
  "item.started",
  "item.updated",
  "item.completed",
]);

const TERMINAL_EVENT_TYPES = new Set([
  "turn.completed",
  "turn.failed",
  "error",
]);

const ANONYMOUS_COMMAND_ID = "__anonymous_command__";

export function defaultCodexCommandTimeoutSeconds(platform = process.platform) {
  // Codex's Windows restricted-token sandbox performs an ACL/profile refresh
  // after emitting item.started and before launching the requested command.
  // On established developer profiles that bounded setup can legitimately take
  // more than two minutes, so retain the 120s idle bound elsewhere while giving
  // Windows startup enough headroom. Operators can still override this value.
  return platform === "win32" ? 240 : 120;
}

export function resolveCodexCommandTimeoutMs({
  configuredSeconds = null,
  totalTimeoutMs = 0,
  defaultSeconds = 120,
} = {}) {
  const explicit = configuredSeconds !== null
    && configuredSeconds !== undefined
    && String(configuredSeconds).trim() !== "";
  const seconds = Number(explicit ? configuredSeconds : defaultSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const requestedMs = Math.round(seconds * 1000);
  const totalMs = Number(totalTimeoutMs);
  if (!Number.isFinite(totalMs) || totalMs <= 1_000) return 0;
  // A default watchdog must be meaningfully shorter than the invocation limit;
  // otherwise the total timer owns the outcome. Explicit values are clamped so
  // both timers cannot fire at the same instant.
  if (!explicit && requestedMs >= totalMs) return 0;
  return Math.max(0, Math.min(requestedMs, totalMs - 1_000));
}

/**
 * Tracks observable Codex command_execution JSONL events.
 *
 * Codex CLI does not currently expose a control handle for an individual
 * command, so this module only detects a stalled command. The caller owns the
 * timeout reaction (normally terminating the outer Codex process tree).
 */
export function createCodexCommandWatchdog({
  timeoutMs,
  scheduleTimeout = setTimeout,
  clearScheduledTimeout = clearTimeout,
  onTimeout = () => undefined,
  now = Date.now,
} = {}) {
  const configuredTimeoutMs = Number(timeoutMs);
  const enabled = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0;
  const activeCommands = new Map();
  let disposed = false;
  let generationCounter = 0;

  function clearCommand(itemId) {
    const current = activeCommands.get(itemId);
    if (!current) return false;
    clearScheduledTimeout(current.timer);
    activeCommands.delete(itemId);
    return true;
  }

  function clearAll() {
    for (const current of activeCommands.values()) {
      clearScheduledTimeout(current.timer);
    }
    activeCommands.clear();
  }

  function scheduleCommand(command, observedAt) {
    const previous = activeCommands.get(command.itemId);
    if (previous) {
      clearScheduledTimeout(previous.timer);
    }

    const generation = ++generationCounter;
    const state = {
      itemId: command.itemId,
      commandSummary: command.commandSummary ?? previous?.commandSummary ?? "Command execution",
      startedAt: command.started ? observedAt : previous?.startedAt ?? observedAt,
      lastActivityAt: observedAt,
      generation,
      timer: null,
    };

    state.timer = scheduleTimeout(() => {
      const current = activeCommands.get(command.itemId);
      if (disposed || !current || current.generation !== generation) return;

      activeCommands.delete(command.itemId);
      const timedOutAt = Number(now());
      const evidence = {
        itemId: current.itemId,
        commandSummary: current.commandSummary,
        startedAt: current.startedAt,
        lastActivityAt: current.lastActivityAt,
        timedOutAt,
        idleMs: Math.max(0, timedOutAt - current.lastActivityAt),
        timeoutMs: configuredTimeoutMs,
      };

      try {
        const pending = onTimeout(evidence);
        if (pending && typeof pending.catch === "function") {
          pending.catch(() => undefined);
        }
      } catch {
        // A watchdog callback must not crash the Desktop Bridge timer loop.
      }
    }, configuredTimeoutMs);

    activeCommands.set(command.itemId, state);
  }

  function observe(event) {
    if (disposed || !enabled || !event || typeof event !== "object") {
      return false;
    }

    const eventType = String(event.type ?? "");
    if (TERMINAL_EVENT_TYPES.has(eventType)) {
      clearAll();
      return true;
    }

    if (!COMMAND_EVENT_TYPES.has(eventType) || event.item?.type !== "command_execution") {
      return false;
    }

    const itemId = commandItemId(event);
    if (eventType === "item.completed") {
      clearCommand(itemId);
      return true;
    }

    const observedAt = Number(now());
    scheduleCommand({
      itemId,
      commandSummary: commandSummary(event.item?.command),
      started: eventType === "item.started",
    }, observedAt);
    return true;
  }

  function snapshot() {
    return {
      enabled: enabled && !disposed,
      disposed,
      timeoutMs: enabled ? configuredTimeoutMs : null,
      activeCommands: [...activeCommands.values()].map((command) => ({
        itemId: command.itemId,
        commandSummary: command.commandSummary,
        startedAt: command.startedAt,
        lastActivityAt: command.lastActivityAt,
        generation: command.generation,
      })),
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearAll();
  }

  return {
    observe,
    snapshot,
    dispose,
  };
}

function commandItemId(event) {
  const value = event.item?.id ?? event.item_id ?? event.itemId;
  const normalized = String(value ?? "").trim();
  return normalized || ANONYMOUS_COMMAND_ID;
}

function commandSummary(command) {
  const normalized = String(command ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}
