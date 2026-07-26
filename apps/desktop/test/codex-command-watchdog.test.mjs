import test from "node:test";
import assert from "node:assert/strict";

import {
  createCodexCommandWatchdog,
  defaultCodexCommandTimeoutSeconds,
  resolveCodexCommandTimeoutMs,
} from "../src/codex-command-watchdog.mjs";

test("command timeout defaults to 120s, stays below the total limit, and can be disabled", () => {
  assert.equal(resolveCodexCommandTimeoutMs({ totalTimeoutMs: 600_000 }), 120_000);
  assert.equal(resolveCodexCommandTimeoutMs({ totalTimeoutMs: 60_000 }), 0, "default yields to a shorter invocation timeout");
  assert.equal(resolveCodexCommandTimeoutMs({ configuredSeconds: 30, totalTimeoutMs: 60_000 }), 30_000);
  assert.equal(resolveCodexCommandTimeoutMs({ configuredSeconds: 0, totalTimeoutMs: 60_000 }), 0);
  assert.equal(resolveCodexCommandTimeoutMs({ configuredSeconds: 60, totalTimeoutMs: 60_000 }), 59_000);
});

test("Windows allows the restricted-token sandbox to finish its bounded startup", () => {
  assert.equal(defaultCodexCommandTimeoutSeconds("win32"), 240);
  assert.equal(defaultCodexCommandTimeoutSeconds("linux"), 120);
  assert.equal(resolveCodexCommandTimeoutMs({
    totalTimeoutMs: 600_000,
    defaultSeconds: defaultCodexCommandTimeoutSeconds("win32"),
  }), 240_000);
});

function createFakeClock(initialNow = 1_000) {
  let currentNow = initialNow;
  let nextId = 0;
  const active = new Map();
  const callbacks = [];

  function scheduleTimeout(callback, delayMs) {
    const timer = {
      id: ++nextId,
      callback,
      dueAt: currentNow + delayMs,
    };
    active.set(timer.id, timer);
    callbacks.push(timer);
    return timer.id;
  }

  function clearScheduledTimeout(timerId) {
    active.delete(timerId);
  }

  function advance(ms) {
    currentNow += ms;
    let progressed = true;
    while (progressed) {
      progressed = false;
      const due = [...active.values()]
        .filter((timer) => timer.dueAt <= currentNow)
        .sort((left, right) => left.dueAt - right.dueAt || left.id - right.id);
      for (const timer of due) {
        if (!active.delete(timer.id)) continue;
        timer.callback();
        progressed = true;
      }
    }
  }

  return {
    now: () => currentNow,
    scheduleTimeout,
    clearScheduledTimeout,
    advance,
    pendingCount: () => active.size,
    callbackAt: (index) => callbacks[index]?.callback,
  };
}

function commandEvent(type, id = "cmd_1", command = "rg --files") {
  return {
    type,
    item: {
      id,
      type: "command_execution",
      command,
    },
  };
}

test("tracks command starts and ignores unrelated JSONL events", () => {
  const clock = createFakeClock();
  const watchdog = createCodexCommandWatchdog({
    timeoutMs: 500,
    now: clock.now,
    scheduleTimeout: clock.scheduleTimeout,
    clearScheduledTimeout: clock.clearScheduledTimeout,
  });

  assert.equal(watchdog.observe({ type: "item.started", item: { id: "msg_1", type: "agent_message" } }), false);
  assert.equal(watchdog.observe(commandEvent("item.started", "cmd_1", "rg   --files\napps")), true);

  assert.deepEqual(watchdog.snapshot(), {
    enabled: true,
    disposed: false,
    timeoutMs: 500,
    activeCommands: [{
      itemId: "cmd_1",
      commandSummary: "rg --files apps",
      startedAt: 1_000,
      lastActivityAt: 1_000,
      generation: 1,
    }],
  });
  assert.equal(clock.pendingCount(), 1);
});

test("an update refreshes the timer while preserving the command start time", () => {
  const clock = createFakeClock();
  const timeouts = [];
  const watchdog = createCodexCommandWatchdog({
    timeoutMs: 100,
    now: clock.now,
    scheduleTimeout: clock.scheduleTimeout,
    clearScheduledTimeout: clock.clearScheduledTimeout,
    onTimeout: (evidence) => timeouts.push(evidence),
  });

  watchdog.observe(commandEvent("item.started"));
  clock.advance(75);
  watchdog.observe(commandEvent("item.updated"));
  clock.advance(75);
  assert.equal(timeouts.length, 0);

  assert.deepEqual(watchdog.snapshot().activeCommands[0], {
    itemId: "cmd_1",
    commandSummary: "rg --files",
    startedAt: 1_000,
    lastActivityAt: 1_075,
    generation: 2,
  });

  clock.advance(25);
  assert.equal(timeouts.length, 1);
  assert.deepEqual(timeouts[0], {
    itemId: "cmd_1",
    commandSummary: "rg --files",
    startedAt: 1_000,
    lastActivityAt: 1_075,
    timedOutAt: 1_175,
    idleMs: 100,
    timeoutMs: 100,
  });
  assert.equal(watchdog.snapshot().activeCommands.length, 0);
});

test("a matching completion clears the command timer", () => {
  const clock = createFakeClock();
  let timeoutCount = 0;
  const watchdog = createCodexCommandWatchdog({
    timeoutMs: 100,
    now: clock.now,
    scheduleTimeout: clock.scheduleTimeout,
    clearScheduledTimeout: clock.clearScheduledTimeout,
    onTimeout: () => { timeoutCount += 1; },
  });

  watchdog.observe(commandEvent("item.started", "cmd_1"));
  assert.equal(watchdog.observe(commandEvent("item.completed", "cmd_other")), true);
  assert.equal(clock.pendingCount(), 1);

  assert.equal(watchdog.observe(commandEvent("item.completed", "cmd_1")), true);
  assert.equal(clock.pendingCount(), 0);
  clock.advance(200);
  assert.equal(timeoutCount, 0);
});

test("a stale timer generation cannot time out a restarted command with the same id", () => {
  const clock = createFakeClock();
  const timeouts = [];
  const watchdog = createCodexCommandWatchdog({
    timeoutMs: 100,
    now: clock.now,
    scheduleTimeout: clock.scheduleTimeout,
    clearScheduledTimeout: clock.clearScheduledTimeout,
    onTimeout: (evidence) => timeouts.push(evidence),
  });

  watchdog.observe(commandEvent("item.started", "cmd_1", "first"));
  const staleCallback = clock.callbackAt(0);
  watchdog.observe(commandEvent("item.completed", "cmd_1"));
  watchdog.observe(commandEvent("item.started", "cmd_1", "second"));

  staleCallback();
  assert.equal(timeouts.length, 0);
  assert.equal(watchdog.snapshot().activeCommands[0].commandSummary, "second");

  clock.advance(100);
  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].commandSummary, "second");
});

test("terminal Codex events clear all active command timers", () => {
  const clock = createFakeClock();
  let timeoutCount = 0;
  const watchdog = createCodexCommandWatchdog({
    timeoutMs: 100,
    now: clock.now,
    scheduleTimeout: clock.scheduleTimeout,
    clearScheduledTimeout: clock.clearScheduledTimeout,
    onTimeout: () => { timeoutCount += 1; },
  });

  watchdog.observe(commandEvent("item.started", "cmd_1"));
  watchdog.observe(commandEvent("item.started", "cmd_2"));
  assert.equal(clock.pendingCount(), 2);

  assert.equal(watchdog.observe({ type: "turn.completed" }), true);
  assert.equal(clock.pendingCount(), 0);
  assert.equal(watchdog.snapshot().activeCommands.length, 0);
  clock.advance(200);
  assert.equal(timeoutCount, 0);
});

test("dispose is idempotent and prevents later observation or stale callbacks", () => {
  const clock = createFakeClock();
  let timeoutCount = 0;
  const watchdog = createCodexCommandWatchdog({
    timeoutMs: 100,
    now: clock.now,
    scheduleTimeout: clock.scheduleTimeout,
    clearScheduledTimeout: clock.clearScheduledTimeout,
    onTimeout: () => { timeoutCount += 1; },
  });

  watchdog.observe(commandEvent("item.started"));
  const staleCallback = clock.callbackAt(0);
  watchdog.dispose();
  watchdog.dispose();

  assert.deepEqual(watchdog.snapshot(), {
    enabled: false,
    disposed: true,
    timeoutMs: 100,
    activeCommands: [],
  });
  assert.equal(watchdog.observe(commandEvent("item.started")), false);
  staleCallback();
  assert.equal(timeoutCount, 0);
});

test("invalid or non-positive timeout configuration disables tracking", () => {
  for (const timeoutMs of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const watchdog = createCodexCommandWatchdog({ timeoutMs });
    assert.equal(watchdog.observe(commandEvent("item.started")), false);
    assert.deepEqual(watchdog.snapshot(), {
      enabled: false,
      disposed: false,
      timeoutMs: null,
      activeCommands: [],
    });
  }
});
