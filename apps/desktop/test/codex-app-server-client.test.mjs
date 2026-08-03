import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import {
  createCodexAppServerClient,
  normalizeCodexAppServerNotification,
} from "../src/codex-app-server-client.mjs";

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/codex-app-server-fixture.mjs");
const clients = [];

function fixtureClient(...flags) {
  const client = createCodexAppServerClient({
    command: process.execPath,
    args: [fixture, ...flags],
    cwd: process.cwd(),
    env: process.env,
    requestTimeoutMs: 2_000,
    interruptGraceMs: 2_000,
  });
  clients.push(client);
  return client;
}

after(() => {
  for (const client of clients) client.close();
});

test("app-server turn completes on turn/completed while the persistent child stays alive", async () => {
  const client = fixtureClient();
  const events = [];
  const outcome = await client.runTurn({
    task: "hello",
    cwd: process.cwd(),
    writableRoots: [process.cwd()],
    sandbox: "workspace-write",
    timeoutMs: 5_000,
    onEvent: (event) => events.push(event),
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.result.threadId, "thr_fixture");
  assert.equal(outcome.result.turnId, "turn_fixture");
  assert.equal(outcome.result.output.latestMessage, "fixture completed");
  assert.equal(outcome.result.output.usage.input_tokens, 7);
  assert.equal(client.snapshot().running, true, "turn completion must not require process close");
  assert.ok(events.some((event) => event.type === "turn.completed"));
  assert.equal(events.find((event) => event.type === "turn.completed")?.usage?.input_tokens, 7);
});

test("app-server forwards the selected model when starting a thread", async () => {
  const client = fixtureClient("--expect-model");
  const outcome = await client.runTurn({
    task: "hello",
    cwd: process.cwd(),
    model: "gpt-5.6-sol",
    timeoutMs: 5_000,
  });

  assert.equal(outcome.status, "succeeded");
});

test("app-server cancellation uses turn/interrupt and converges on interrupted turn", async () => {
  const client = fixtureClient("--slow");
  let cancelled = false;
  setTimeout(() => {
    cancelled = true;
  }, 250);
  const outcome = await client.runTurn({
    task: "slow",
    cwd: process.cwd(),
    timeoutMs: 5_000,
    shouldCancel: () => cancelled,
  });

  assert.equal(outcome.status, "cancelled");
  assert.match(outcome.summary, /cancelled|interrupted/i);
});

test("app-server forwards boundary approvals and applies the auto-review permission profile", async () => {
  const client = fixtureClient("--approval", "--expect-auto");
  const approvals = [];
  const outcome = await client.runTurn({
    task: "approval",
    cwd: process.cwd(),
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
    timeoutMs: 5_000,
    onApprovalRequest: (request) => {
      approvals.push(request);
      return { approved: true, decision: "approved" };
    },
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].method, "item/commandExecution/requestApproval");
  assert.equal(client.snapshot().approvalHandlers, 0);
});

test("app-server refuses overlapping turns on the same thread without clearing the active guard", async () => {
  const client = fixtureClient("--slow");
  let cancelFirst = false;
  const first = client.runTurn({
    task: "first",
    cwd: process.cwd(),
    timeoutMs: 5_000,
    shouldCancel: () => cancelFirst,
  });
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));

  const overlapping = await client.runTurn({
    task: "second",
    cwd: process.cwd(),
    threadId: "thr_fixture",
    timeoutMs: 5_000,
  });
  const overlappingAgain = await client.runTurn({
    task: "third",
    cwd: process.cwd(),
    threadId: "thr_fixture",
    timeoutMs: 5_000,
  });
  cancelFirst = true;
  const firstOutcome = await first;

  assert.equal(overlapping.status, "failed");
  assert.equal(overlappingAgain.status, "failed");
  assert.match(overlapping.summary, /already has an active turn/i);
  assert.match(overlappingAgain.summary, /already has an active turn/i);
  assert.equal(firstOutcome.status, "cancelled");
});

test("app-server command idle timeout interrupts the turn and reports timed_out", async () => {
  const client = fixtureClient("--command-slow");
  const outcome = await client.runTurn({
    task: "slow command",
    cwd: process.cwd(),
    timeoutMs: 5_000,
    commandIdleTimeoutMs: 150,
  });

  assert.equal(outcome.status, "timed_out");
  assert.equal(outcome.result.timeoutKind, "command_idle");
  assert.equal(outcome.result.errorCode, "execution_timeout");
});

test("app-server total timeout reports the execution-timeout recovery category", async () => {
  const client = fixtureClient("--slow");
  const outcome = await client.runTurn({
    task: "slow turn",
    cwd: process.cwd(),
    timeoutMs: 150,
  });

  assert.equal(outcome.status, "timed_out");
  assert.equal(outcome.result.timeoutKind, "invocation_total");
  assert.equal(outcome.result.errorCode, "execution_timeout");
});

test("app-server transport exit fails an active turn without waiting for invocation timeout", async () => {
  const client = fixtureClient("--crash");
  const startedAt = Date.now();
  const outcome = await client.runTurn({
    task: "crash",
    cwd: process.cwd(),
    timeoutMs: 5_000,
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.result.errorCode, "transport_closed");
  assert.match(outcome.summary, /exited unexpectedly|transport closed/i);
  assert.ok(Date.now() - startedAt < 2_000);
});

test("app-server startup failure returns a terminal transport outcome instead of throwing", async () => {
  const client = fixtureClient("--crash-on-initialize");
  const outcome = await client.runTurn({
    task: "never starts",
    cwd: process.cwd(),
    timeoutMs: 5_000,
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.result.errorCode, "transport_closed");
  assert.match(outcome.summary, /exited unexpectedly|transport closed/i);
});

test("app-server classifies model capacity as a recoverable provider condition", async () => {
  const client = fixtureClient("--capacity");
  const outcome = await client.runTurn({
    task: "capacity",
    cwd: process.cwd(),
    timeoutMs: 5_000,
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.result.errorCode, "provider_capacity");
  assert.match(outcome.summary, /model is at capacity/i);
});

test("app-server notifications normalize to the existing Codex JSONL vocabulary", () => {
  assert.deepEqual(
    normalizeCodexAppServerNotification({
      method: "item/completed",
      params: {
        item: {
          id: "cmd_1",
          type: "commandExecution",
          command: "git status",
          status: "completed",
          exitCode: 0,
          aggregatedOutput: "ok",
        },
      },
    }),
    {
      type: "item.completed",
      item: {
        id: "cmd_1",
        type: "command_execution",
        command: "git status",
        status: "completed",
        exitCode: 0,
        aggregatedOutput: "ok",
        exit_code: 0,
        aggregated_output: "ok",
      },
    },
  );

  const fileChange = normalizeCodexAppServerNotification({
    method: "item/completed",
    params: {
      item: {
        id: "file_1",
        type: "fileChange",
        status: "completed",
        changes: [
          { path: "src/a.mjs", kind: "update", diff: "@@ a @@" },
          { path: "src/b.mjs", kind: "create", diff: "@@ b @@" },
        ],
      },
    },
  });
  assert.deepEqual(fileChange.item.files, [
    { path: "src/a.mjs", action: "update", diff: "@@ a @@" },
    { path: "src/b.mjs", action: "create", diff: "@@ b @@" },
  ]);
});
