import test from "node:test";
import assert from "node:assert/strict";
import { terminalObservationReadModel } from "../src/read-models/terminal-observation.mjs";

test("observation v1 exposes bounded summaries without credentials, files, or internal state", () => {
  const result = terminalObservationReadModel({
    namespace: "local",
    protocolVersion: "1",
    device: { id: "dev_local", status: "online", platform: "darwin", credential: "secret" },
    capabilities: [{ id: "cap_1", name: "office.read", available: true, command: "private" }],
    invocations: [],
    tokens: [{ token: "secret" }],
  }, [{
    id: "wi_1", title: "Excel to PPT", status: "open", executionState: "running",
    terminalId: "dev_local", attentionRequired: false, updatedAt: "2026-07-25T00:00:00.000Z",
    inputAssets: [{ id: "asset_1", family: "spreadsheet", path: "private.xlsx", terminalId: "dev_local" }],
    outputAssets: [{ id: "asset_2", family: "presentation", path: "private.pptx", terminalId: "dev_local" }],
    observability: { trace: { traceId: "trace_1", private: "detail" } },
  }], { now: () => "2026-07-25T01:00:00.000Z" });
  assert.equal(result.contract, "terminal-observation/v1");
  assert.equal(result.queue.running, 1);
  assert.equal(result.tasks[0].traceId, "trace_1");
  assert.deepEqual(result.tasks[0].inputAssets[0], { id: "asset_1", family: "spreadsheet", terminalId: "dev_local" });
  assert.doesNotMatch(JSON.stringify(result), /secret|private\\.xlsx|private\\.pptx|command/);
});
