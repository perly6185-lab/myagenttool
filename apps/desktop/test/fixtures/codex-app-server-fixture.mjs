import { createInterface } from "node:readline";

const slow = process.argv.includes("--slow");
const commandSlow = process.argv.includes("--command-slow");
const crash = process.argv.includes("--crash");
const crashOnInitialize = process.argv.includes("--crash-on-initialize");
const approval = process.argv.includes("--approval");
const capacity = process.argv.includes("--capacity");
const expectAuto = process.argv.includes("--expect-auto");
const expectModel = process.argv.includes("--expect-model");
const reader = createInterface({ input: process.stdin });
let activeTurn = null;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

reader.on("line", (line) => {
  const message = JSON.parse(line);
  const { id, method, params = {} } = message;

  if (!method && id === "approval_fixture") {
    if (message.result?.decision === "accept") {
      finishTurn("completed");
    } else {
      finishTurn("interrupted");
    }
    return;
  }
  if (method === "initialize") {
    if (crashOnInitialize) {
      process.exit(18);
    }
    send({ id, result: { userAgent: "fixture", platformFamily: "windows", platformOs: "windows" } });
    return;
  }
  if (method === "initialized") {
    return;
  }
  if (method === "thread/start" || method === "thread/resume") {
    if (expectAuto && (params.approvalPolicy !== "on-request" || params.approvalsReviewer !== "auto_review" || params.sandbox !== "workspace-write")) {
      send({ id, error: { code: -32602, message: "permission profile mismatch" } });
      return;
    }
    if (expectModel && params.model !== "gpt-5.6-sol") {
      send({ id, error: { code: -32602, message: "model mismatch" } });
      return;
    }
    const threadId = params.threadId ?? "thr_fixture";
    send({ id, result: { thread: { id: threadId } } });
    send({ method: "thread/started", params: { thread: { id: threadId } } });
    return;
  }
  if (method === "turn/start") {
    activeTurn = { threadId: params.threadId, turnId: "turn_fixture" };
    send({ id, result: { turn: { id: activeTurn.turnId, status: "inProgress", items: [] } } });
    send({
      method: "turn/started",
      params: {
        threadId: activeTurn.threadId,
        turn: { id: activeTurn.turnId, status: "inProgress", items: [] },
      },
    });
    if (crash) {
      process.exit(17);
    }
    if (commandSlow) {
      send({
        method: "item/started",
        params: {
          threadId: activeTurn.threadId,
          turnId: activeTurn.turnId,
          item: {
            id: "command_fixture",
            type: "commandExecution",
            command: "fixture slow command",
            status: "inProgress",
          },
        },
      });
    } else if (approval) {
      send({
        id: "approval_fixture",
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: activeTurn.threadId,
          turnId: activeTurn.turnId,
          itemId: "command_fixture",
          command: "fixture approved command",
          startedAtMs: Date.now(),
        },
      });
    } else if (capacity) {
      finishTurn("failed", { message: "Selected model is at capacity. Please try a different model." });
    } else if (!slow) {
      finishTurn("completed");
    }
    return;
  }
  if (method === "turn/interrupt") {
    send({ id, result: {} });
    finishTurn("interrupted");
    return;
  }
  send({ id, error: { code: -32601, message: `unsupported fixture method ${method}` } });
});

function finishTurn(status, error = null) {
  if (!activeTurn) return;
  const { threadId, turnId } = activeTurn;
  if (status === "completed") {
    send({
      method: "item/completed",
      params: {
        threadId,
        turnId,
        completedAtMs: Date.now(),
        item: { id: "item_fixture", type: "agentMessage", text: "fixture completed" },
      },
    });
    send({
      method: "thread/tokenUsage/updated",
      params: {
        threadId,
        turnId,
        tokenUsage: {
          total: { totalTokens: 10, inputTokens: 7, cachedInputTokens: 2, cacheWriteInputTokens: 0, outputTokens: 3, reasoningOutputTokens: 1 },
          last: { totalTokens: 10, inputTokens: 7, cachedInputTokens: 2, cacheWriteInputTokens: 0, outputTokens: 3, reasoningOutputTokens: 1 },
          modelContextWindow: 1000,
        },
      },
    });
  }
  send({
    method: "turn/completed",
    params: {
      threadId,
      turn: {
        id: turnId,
        status,
        items: [],
        error,
      },
    },
  });
  activeTurn = null;
}
