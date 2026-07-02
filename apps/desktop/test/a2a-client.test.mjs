/*
 * End-to-end tests for the bridge's live A2A client against a fixture A2A
 * server (Agent Card + JSON-RPC over HTTP). Covers the polled-task happy path,
 * direct message replies, skill allowlist, cancellation → tasks/cancel,
 * timeout, unreachable agents, and the card health probe.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { after, before, test } from "node:test";

import { normalizeA2aAdapterConfig } from "@myagenttool/adapters/a2a";
import { callA2aAgent, probeA2aAgent } from "../src/a2a-client.mjs";

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/a2a-echo-server.mjs");

const servers = [];
async function startFixture(...flags) {
  const child = spawn(process.execPath, [fixture, ...flags], { stdio: ["ignore", "pipe", "pipe"] });
  servers.push(child);
  const port = await new Promise((resolvePort, reject) => {
    child.stdout.on("data", (chunk) => {
      const match = chunk.toString("utf8").match(/LISTENING (\d+)/);
      if (match) resolvePort(Number(match[1]));
    });
    child.on("error", reject);
    setTimeout(() => reject(new Error("fixture did not start")), 5_000);
  });
  return normalizeA2aAdapterConfig({ agentUrl: `http://127.0.0.1:${port}` });
}

let echoAdapter;
before(async () => {
  echoAdapter = await startFixture();
});
after(() => {
  for (const child of servers) child.kill("SIGTERM");
});

test("happy path: task is polled to completion and the artifact text returns", async () => {
  const events = [];
  const outcome = await callA2aAgent({ adapter: echoAdapter, task: "hello a2a", onEvent: (e) => events.push(e) });
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.result.output, "echo: hello a2a");
  assert.ok(events.some((e) => e.message.includes("fixture-a2a-echo")), "card fetch is surfaced as an event");
});

test("direct message reply is terminal without polling", async () => {
  const adapter = await startFixture("--direct");
  const outcome = await callA2aAgent({ adapter, task: "quick" });
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.result.output, "echo: quick");
});

test("skill allowlist from the shared descriptor is enforced", async () => {
  const restricted = { ...echoAdapter, allowedSkills: ["other"] };
  const outcome = await callA2aAgent({ adapter: restricted, task: "x", options: { skillId: "echo" } });
  assert.equal(outcome.status, "failed");
  assert.match(outcome.summary, /not in the adapter's allowed skills/);
});

test("cancellation: a working task is cancelled via tasks/cancel", async () => {
  const adapter = await startFixture("--slow");
  let cancel = false;
  setTimeout(() => (cancel = true), 400);
  const outcome = await callA2aAgent({ adapter, task: "x", shouldCancel: () => cancel });
  assert.equal(outcome.status, "cancelled");
});

test("timeout: a task that never completes times out at the adapter timeout", async () => {
  const slowAdapter = { ...(await startFixture("--slow")), timeoutMs: 1_200 };
  const outcome = await callA2aAgent({ adapter: slowAdapter, task: "x" });
  assert.equal(outcome.status, "timed_out");
});

test("unreachable agent fails with a clear summary", async () => {
  const adapter = normalizeA2aAdapterConfig({ agentUrl: "http://127.0.0.1:1", timeoutMs: 2_000 });
  const outcome = await callA2aAgent({ adapter, task: "x" });
  assert.notEqual(outcome.status, "succeeded");
  assert.match(outcome.summary, /A2A call failed|timed out/i);
});

test("probeA2aAgent: healthy card lists skills; bad URL is unhealthy", async () => {
  const ok = await probeA2aAgent(echoAdapter);
  assert.equal(ok.ok, true);
  assert.match(ok.message, /echo/);
  const bad = await probeA2aAgent(normalizeA2aAdapterConfig({ agentUrl: "http://127.0.0.1:1" }));
  assert.equal(bad.ok, false);
});
