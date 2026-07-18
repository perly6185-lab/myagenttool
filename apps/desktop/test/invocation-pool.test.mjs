/**
 * #1242 — the bridge invocation concurrency pool. Hermetic: fake claim/run with
 * controllable timing, no HTTP, no child process.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createInvocationPool, resolveBridgeConcurrency, refreshedConcurrency } from "../src/invocation-pool.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("resolveBridgeConcurrency: server value wins, then env, then fallback", () => {
  assert.equal(resolveBridgeConcurrency({ serverMaxConcurrency: 5, envValue: "2" }), 5);
  assert.equal(resolveBridgeConcurrency({ serverMaxConcurrency: undefined, envValue: "4" }), 4);
  assert.equal(resolveBridgeConcurrency({ serverMaxConcurrency: null, envValue: undefined }), 3);
  assert.equal(resolveBridgeConcurrency({}), 3);
});

test("refreshedConcurrency: adopts a usable server value, ignores an unusable one", () => {
  // A live change: server now says 6 → adopt it (clamped like resolve).
  assert.equal(refreshedConcurrency(3, { serverMaxConcurrency: 6 }), 6);
  assert.equal(refreshedConcurrency(3, { serverMaxConcurrency: 99 }), 16);
  // Unusable / absent server value → keep the current cap, never drop to fallback.
  assert.equal(refreshedConcurrency(5, { serverMaxConcurrency: undefined }), 5);
  assert.equal(refreshedConcurrency(5, { serverMaxConcurrency: null }), 5);
  assert.equal(refreshedConcurrency(5, { serverMaxConcurrency: 0 }), 5);
  assert.equal(refreshedConcurrency(5, { serverMaxConcurrency: "not-a-number" }), 5);
  // Server wins over env, matching resolveBridgeConcurrency.
  assert.equal(refreshedConcurrency(3, { serverMaxConcurrency: 4, envValue: "9" }), 4);
});

test("resolveBridgeConcurrency: clamps to [1,16] and ignores non-positive", () => {
  assert.equal(resolveBridgeConcurrency({ serverMaxConcurrency: 99 }), 16);
  assert.equal(resolveBridgeConcurrency({ serverMaxConcurrency: 0, envValue: "7" }), 7);
  assert.equal(resolveBridgeConcurrency({ serverMaxConcurrency: -3, envValue: "-1" }), 3);
  assert.equal(resolveBridgeConcurrency({ fallback: 1 }), 1);
});

test("fill launches up to the cap and no further", async () => {
  const gate = deferred();
  let claims = 0;
  const pool = createInvocationPool({
    cap: 3,
    claim: async () => {
      claims += 1;
      return { id: claims };
    },
    run: async () => {
      await gate.promise;
    },
  });
  const launched = await pool.fill();
  assert.equal(launched, 3, "launches exactly cap runs");
  assert.equal(pool.size(), 3);
  // Claimed exactly cap times — the loop stops on the capacity check, not an extra claim.
  assert.equal(claims, 3);
  gate.resolve();
});

test("cap as a getter is re-read every fill — a live cap change takes effect (#1272)", async () => {
  const gate = deferred();
  let cap = 1;
  let claims = 0;
  const pool = createInvocationPool({
    cap: () => cap,
    claim: async () => ({ id: ++claims }),
    run: async () => {
      await gate.promise;
    },
  });
  // Cap 1: one run in flight, pool full.
  assert.equal(await pool.fill(), 1);
  assert.equal(pool.size(), 1);
  assert.equal(await pool.fill(), 0, "still full at cap 1");

  // Operator raises the cap live → the next fill re-reads the getter and grows.
  cap = 3;
  assert.equal(await pool.fill(), 2, "fills up to the new cap of 3");
  assert.equal(pool.size(), 3);

  // Operator lowers the cap live → no force-kill, just no new launches until it drains.
  cap = 1;
  assert.equal(await pool.fill(), 0, "already above the lowered cap; launches nothing");
  assert.equal(pool.size(), 3, "in-flight runs above the new cap keep running");
  gate.resolve();
});

test("fill stops early when the server has nothing (claim falsy = 204)", async () => {
  let claims = 0;
  const pool = createInvocationPool({
    cap: 5,
    claim: async () => {
      claims += 1;
      return claims <= 2 ? { id: claims } : null;
    },
    run: async () => {},
  });
  const launched = await pool.fill();
  assert.equal(launched, 2);
  assert.equal(claims, 3, "one extra claim returned null and broke the loop");
});

test("a finished run frees its slot so a later fill can claim again", async () => {
  const gates = [deferred(), deferred()];
  let claims = 0;
  const pool = createInvocationPool({
    cap: 1,
    claim: async () => ({ id: ++claims }),
    run: async (work) => {
      await gates[work.id - 1].promise;
    },
  });
  await pool.fill();
  assert.equal(pool.size(), 1);
  // Full: a second fill launches nothing.
  assert.equal(await pool.fill(), 0);
  gates[0].resolve();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(pool.size(), 0, "slot freed after the run settles");
  assert.equal(await pool.fill(), 1, "now a run can be claimed again");
  gates[1].resolve();
});

test("a throwing run still frees its slot and reports through onError", async () => {
  const failures = [];
  let claims = 0;
  const pool = createInvocationPool({
    cap: 2,
    claim: async () => (++claims === 1 ? { id: 1 } : null),
    run: async () => {
      throw new Error("run blew up");
    },
    onError: (error, work) => failures.push({ message: error.message, id: work.id }),
  });
  await pool.fill();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(pool.size(), 0, "a rejected run must not leak a slot");
  assert.deepEqual(failures, [{ message: "run blew up", id: 1 }]);
});

test("concurrent fill() is a no-op while one is already filling", async () => {
  const claimGate = deferred();
  let claims = 0;
  const pool = createInvocationPool({
    cap: 4,
    claim: async () => {
      claims += 1;
      await claimGate.promise;
      return null;
    },
    run: async () => {},
  });
  const first = pool.fill();
  const second = await pool.fill(); // re-entrant while first is mid-claim
  assert.equal(second, 0, "the re-entrant fill returns immediately");
  claimGate.resolve();
  await first;
  assert.equal(claims, 1, "only the first fill issued a claim");
});
