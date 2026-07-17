/**
 * #1228 — the agent line sink: chunk→line buffering plus a serial, awaitable
 * handler chain. Hermetic: no child process, no HTTP — handlers are recorded
 * fakes with controllable timing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createAgentLineSink } from "../src/agent-line-sink.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("splits chunks into lines across chunk boundaries, CRLF included", async () => {
  const handled = [];
  const sink = createAgentLineSink(async (line) => {
    handled.push(line);
  });
  sink.push(Buffer.from("alpha\nbra"));
  sink.push(Buffer.from("vo\r\ncharlie\n"));
  await sink.flush();
  assert.deepEqual(handled, ["alpha", "bravo", "charlie"]);
});

test("flush delivers the residual partial line, trimmed", async () => {
  const handled = [];
  const sink = createAgentLineSink(async (line) => {
    handled.push(line);
  });
  sink.push(Buffer.from("first\n  RESULT tail "));
  await sink.flush();
  assert.deepEqual(handled, ["first", "RESULT tail"]);
  // Idempotent: a second flush neither re-delivers nor hangs.
  await sink.flush();
  assert.deepEqual(handled, ["first", "RESULT tail"]);
});

test("flush resolves only after a slow handler settles — the #1228 race", async () => {
  const gate = deferred();
  const completed = [];
  const sink = createAgentLineSink(async (line) => {
    await gate.promise;
    completed.push(line);
  });
  sink.push(Buffer.from("result-line\n"));
  let flushed = false;
  const flushing = sink.flush().then(() => {
    flushed = true;
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(flushed, false, "flush must wait for the in-flight handler");
  assert.deepEqual(completed, []);
  gate.resolve();
  await flushing;
  assert.deepEqual(completed, ["result-line"]);
});

test("preserves stream order: a later line never starts before an earlier one finishes", async () => {
  const gate = deferred();
  const started = [];
  const completed = [];
  const sink = createAgentLineSink(async (line) => {
    started.push(line);
    if (line === "slow") {
      await gate.promise;
    }
    completed.push(line);
  });
  sink.push(Buffer.from("slow\nfast\n"));
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(started, ["slow"], "the chain is serial — fast must not start early");
  gate.resolve();
  await sink.flush();
  assert.deepEqual(completed, ["slow", "fast"]);
});

test("a rejecting handler fails that line only and reports through onError", async () => {
  const handled = [];
  const failures = [];
  const sink = createAgentLineSink(
    async (line) => {
      if (line === "bad") {
        throw new Error("malformed RESULT json");
      }
      handled.push(line);
    },
    {
      onError: (error, line) => {
        failures.push({ message: error.message, line });
      },
    },
  );
  sink.push(Buffer.from("bad\ngood\n"));
  await sink.flush();
  assert.deepEqual(handled, ["good"]);
  assert.deepEqual(failures, [{ message: "malformed RESULT json", line: "bad" }]);
});

test("a throwing onError does not break the chain", async () => {
  const handled = [];
  const sink = createAgentLineSink(
    async (line) => {
      if (line === "bad") {
        throw new Error("boom");
      }
      handled.push(line);
    },
    {
      onError: () => {
        throw new Error("reporter is broken too");
      },
    },
  );
  sink.push(Buffer.from("bad\ngood\n"));
  await sink.flush();
  assert.deepEqual(handled, ["good"]);
});
