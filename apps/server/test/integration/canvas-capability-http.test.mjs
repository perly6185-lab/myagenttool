/*
 * Canvas capabilities over HTTP (#1353). Boots the REAL server, registers the
 * built-in app_canvas, and drives the governed capability gateway
 * (POST /api/capabilities/:name/invocations): read + write run in-process,
 * undeclared inputs are rejected by the schema gate, and the destructive
 * remove is approval-gated.
 */

process.env.MYAGENT_REQUIRE_AUTH = "1";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const now = () => new Date().toISOString();
let server;
let base;

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");
  const { createCanvasApplicationRegistration } = await import("../../src/services/canvas-application.mjs");

  const { defaultProject, state } = createServerState({ defaultProjectPath: "/tmp", now });
  state.teams.push({ id: "team_a", name: "Team A" });
  state.users.push({ id: "usr_a", name: "A", teamId: "team_a" });
  state.tokens.push({ token: "tok_a", userId: "usr_a", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });

  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test", protocolVersion: "0.0.0", state, defaultProject, defaultProjectPath: "/tmp",
    persistenceEnabled: false, stateStorePath: "/tmp/unused.json", stateSchemaVersion: 1, dispatchLeaseMs: 30_000, now,
  });
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;

  // Register the built-in Canvas Application (opt-in, like the other built-ins).
  const reg = await call("/api/applications/register", { token: "tok_a", method: "POST", body: createCanvasApplicationRegistration({ autoOnline: true }) });
  assert.equal(reg.status < 300, true, `register app_canvas: ${JSON.stringify(reg.body)}`);
});

after(() => server?.close());

async function call(path, { token, method = "GET", body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try { parsed = await res.json(); } catch { parsed = null; }
  return { status: res.status, body: parsed };
}

async function capabilityName(action) {
  const caps = (await call("/api/capabilities", { token: "tok_a" })).body;
  const list = Array.isArray(caps) ? caps : caps?.capabilities ?? [];
  return list.find((c) => c.name.endsWith(`.${action}`) && c.name.includes("app_canvas"))?.name;
}
const invoke = async (action, input) => call(`/api/capabilities/${encodeURIComponent(await capabilityName(action))}/invocations`, { token: "tok_a", method: "POST", body: input });

test("the 7 governed Canvas capabilities are discoverable and ready", async () => {
  const caps = (await call("/api/capabilities", { token: "tok_a" })).body;
  const list = Array.isArray(caps) ? caps : caps?.capabilities ?? [];
  const canvas = list.filter((c) => c.name.includes("app_canvas.") && ["list", "get", "create", "add_elements", "update_elements", "remove_elements", "export"].includes(c.name.split(".").at(-1)));
  assert.equal(canvas.length, 7);
});

test("create runs through the gateway end-to-end", async () => {
  const res = await invoke("create", { name: "From capability", elements: [] });
  assert.equal(res.status < 300, true, `create: ${JSON.stringify(res.body)}`);
  const scenes = (await call("/api/canvas/scenes", { token: "tok_a" })).body.scenes;
  assert.equal(scenes.some((s) => s.name === "From capability"), true);
});

test("capabilities publish a bounded input schema", async () => {
  const caps = (await call("/api/capabilities", { token: "tok_a" })).body;
  const list = Array.isArray(caps) ? caps : caps?.capabilities ?? [];
  const remove = list.find((c) => c.name.endsWith(".remove_elements") && c.name.includes("app_canvas"));
  // The destructive capability declares a closed schema incl. its approval token —
  // handlers read only declared fields, so smuggled extras are inert.
  assert.equal(remove.inputSchema.additionalProperties, false);
  assert.ok(remove.inputSchema.properties.approvalToken, "remove_elements declares approvalToken");
  assert.ok(remove.inputSchema.required.includes("sceneId"));
});

test("remove_elements is approval-gated at the HTTP boundary", async () => {
  const created = await invoke("create", { name: "Gated", elements: [] });
  assert.equal(created.status < 300, true);
  const sceneId = (await call("/api/canvas/scenes", { token: "tok_a" })).body.scenes.find((s) => s.name === "Gated").id;
  const res = await invoke("remove_elements", { sceneId, expectedRevision: 1, elementIds: ["whatever"] });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "approval_required");
});
