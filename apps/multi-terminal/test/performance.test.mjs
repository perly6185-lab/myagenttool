import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createCompositionService } from "../src/composition.mjs";

for (const size of [10, 50, 100]) test(`${size}-terminal composition stays within the local one-second baseline`, async () => {
  const terminals = Array.from({ length: size }, (_, index) => ({
    id: `terminal-${index}`, name: `Terminal ${index}`,
    apiUrl: `https://terminal-${index}.example/`, consoleUrl: `https://console-${index}.example/`,
  }));
  const request = async (_terminal, operation) => ({
    ok: true, status: 200,
    json: async () => ({
      tasks: Array.from({ length: 10 }, (_, index) => ({ id: `wi_${index}`, title: `Task ${index}`, executionState: "running" })),
    }),
  });
  const service = createCompositionService({ terminals, request });
  const started = performance.now();
  const result = await service.overview();
  const elapsedMs = performance.now() - started;
  assert.equal(result.terminals.length, size);
  assert.equal(result.totals.running, size * 10);
  assert.ok(elapsedMs < 1_000, `composition took ${elapsedMs.toFixed(1)}ms`);
});
