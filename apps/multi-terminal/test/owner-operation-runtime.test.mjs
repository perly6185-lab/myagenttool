import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OwnerOperationRuntime } from "../src/owner-operation-runtime.mjs";
import { createCompositionService } from "../src/composition.mjs";

const terminal = { id: "studio" };
const operation = { method: "POST", path: "/api/invocations/inv_1/cancel", body: {} };

test("owner operations retry transient failures, audit, and replay idempotently", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "owner-runtime-")), "audit.json");
  const runtime = new OwnerOperationRuntime(file);
  let calls = 0;
  const request = async () => {
    calls += 1;
    return calls === 1
      ? { ok: false, status: 503, json: async () => ({ error: "temporary" }) }
      : { ok: true, status: 200, json: async () => ({ cancelled: true }) };
  };
  const input = { terminal, operation, idempotencyKey: "cancel:inv_1:0001", action: "cancel", localResourceId: "inv_1", request };
  const result = await runtime.execute(input);
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  const replay = await runtime.execute(input);
  assert.equal(replay.replayed, true);
  assert.equal(calls, 2);
  const conflict = await runtime.execute({ ...input, localResourceId: "inv_2" });
  assert.equal(conflict.code, "idempotency_key_conflict");
  assert.equal(runtime.records().length, 1);
  assert.equal(JSON.stringify(runtime.records()).includes("cancelled"), false, "public audit omits result bodies");
});

test("operation results are bounded and redact credential-shaped fields before persistence", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "owner-redaction-")), "audit.json");
  const runtime = new OwnerOperationRuntime(file, { retryLimit: 0 });
  const result = await runtime.execute({
    terminal, operation, idempotencyKey: "cancel:inv_1:redact", action: "cancel", localResourceId: "inv_1",
    request: async () => ({ ok: true, status: 200, json: async () => ({ token: "secret", nested: { password: "secret", safe: "ok" } }) }),
  });
  assert.deepEqual(result.result, { nested: { safe: "ok" } });
});

test("owner circuit opens after bounded terminal failures and never migrates", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "owner-circuit-")), "audit.json");
  const runtime = new OwnerOperationRuntime(file, { retryLimit: 0, circuitFailures: 2 });
  const request = async () => { throw new Error("offline"); };
  const base = { terminal, operation, action: "cancel", localResourceId: "inv_1", request };
  await runtime.execute({ ...base, idempotencyKey: "cancel:inv_1:0001" });
  await runtime.execute({ ...base, idempotencyKey: "cancel:inv_1:0002" });
  const blocked = await runtime.execute({ ...base, idempotencyKey: "cancel:inv_1:0003" });
  assert.equal(blocked.code, "owner_circuit_open");
  assert.equal(blocked.migrated, false);
});

test("cancel, retry, replay, and maintenance drills execute only on the registered owner", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "owner-four-actions-")), "audit.json");
  const runtime = new OwnerOperationRuntime(file, { retryLimit: 0 });
  const paths = [];
  const owner = { id: "studio", name: "Studio", apiUrl: "https://studio.example", consoleUrl: "https://console.example" };
  const service = createCompositionService({
    terminals: [owner], operationRuntime: runtime,
    request: async (terminalRow, requestOperation) => {
      assert.equal(terminalRow.id, "studio");
      paths.push(requestOperation.path);
      return { ok: true, status: 200, json: async () => ({ accepted: true }) };
    },
  });
  const drills = [
    { resourceType: "invocations", localResourceId: "inv_1", action: "cancel", body: {}, idempotencyKey: "pilot:cancel:0001" },
    { resourceType: "application-runs", localResourceId: "inv_2", action: "retry", body: { applicationId: "app_1", routineId: "routine_1" }, idempotencyKey: "pilot:retry:0001" },
    { resourceType: "deliveries", localResourceId: "delivery_1", action: "replay", body: { provider: "gitea" }, idempotencyKey: "pilot:replay:0001" },
    { resourceType: "applications", localResourceId: "app_1", action: "maintenance", body: {}, idempotencyKey: "pilot:maintenance:0001" },
  ];
  for (const drill of drills) assert.equal((await service.proxyAction({ terminalId: "studio", ...drill })).ok, true);
  assert.deepEqual(paths, [
    "/api/invocations/inv_1/cancel",
    "/api/applications/app_1/orchestrations/routine_1/runs/inv_2/recovery/actions",
    "/api/work-items/gitea/deliveries/delivery_1/replay",
    "/api/applications/app_1/refresh",
  ]);
  assert.equal(runtime.records().length, 4);
});
