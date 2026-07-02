/*
 * Fixture A2A server for tests: serves an Agent Card at /.well-known/agent.json
 * and a JSON-RPC endpoint at /rpc. `message/send` returns a working task that
 * completes on the second `tasks/get` (exercising the poll loop). `--slow`
 * keeps tasks working forever (for cancel/timeout tests); `--direct` replies
 * with a direct message instead of a task. Prints "LISTENING <port>" on stdout.
 */

import { createServer } from "node:http";

const slow = process.argv.includes("--slow");
const direct = process.argv.includes("--direct");

const tasks = new Map(); // id → { polls }
let taskCounter = 0;
const cancelled = new Set();

function rpcResult(id, result) {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function taskBody(taskId, state, text) {
  return {
    id: taskId,
    kind: "task",
    status: { state },
    artifacts: state === "completed" ? [{ parts: [{ kind: "text", text }] }] : [],
  };
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/.well-known/agent.json") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      name: "fixture-a2a-echo",
      url: `http://127.0.0.1:${server.address().port}/rpc`,
      version: "0.0.0",
      skills: [{ id: "echo", name: "Echo" }],
    }));
    return;
  }
  if (req.method === "POST" && req.url === "/rpc") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const message = JSON.parse(body);
      res.writeHead(200, { "content-type": "application/json" });
      if (message.method === "message/send") {
        const text = message.params?.message?.parts?.find((p) => p.kind === "text")?.text ?? "";
        if (direct) {
          res.end(rpcResult(message.id, { kind: "message", role: "agent", parts: [{ kind: "text", text: `echo: ${text}` }] }));
          return;
        }
        const taskId = `task_${++taskCounter}`;
        tasks.set(taskId, { polls: 0, text });
        res.end(rpcResult(message.id, taskBody(taskId, "working", null)));
        return;
      }
      if (message.method === "tasks/get") {
        const taskId = message.params?.id;
        const task = tasks.get(taskId);
        if (!task) {
          res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { message: "task not found" } }));
          return;
        }
        if (cancelled.has(taskId)) {
          res.end(rpcResult(message.id, taskBody(taskId, "canceled", null)));
          return;
        }
        task.polls += 1;
        const done = !slow && task.polls >= 2;
        res.end(rpcResult(message.id, taskBody(taskId, done ? "completed" : "working", `echo: ${task.text}`)));
        return;
      }
      if (message.method === "tasks/cancel") {
        cancelled.add(message.params?.id);
        res.end(rpcResult(message.id, taskBody(message.params?.id, "canceled", null)));
        return;
      }
      res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { message: `unknown method ${message.method}` } }));
    });
    return;
  }
  res.writeHead(404).end();
});

server.listen(0, "127.0.0.1", () => {
  console.log(`LISTENING ${server.address().port}`);
});
