import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServerState } from "../../src/runtime/state-factory.mjs";
import { createServerRuntimeServices } from "../../src/runtime/service-composer.mjs";
import { createHttpServer } from "../../src/runtime/http-server.mjs";

test("observer token is read-only and can access only the bounded v1 projection", async (t) => {
  const previous = process.env.MYAGENTTOOL_OBSERVER_TOKEN;
  const token = "observer-token-at-least-24-characters";
  process.env.MYAGENTTOOL_OBSERVER_TOKEN = token;
  t.after(() => {
    if (previous == null) delete process.env.MYAGENTTOOL_OBSERVER_TOKEN;
    else process.env.MYAGENTTOOL_OBSERVER_TOKEN = previous;
  });
  const projectDir = await mkdtemp(join(tmpdir(), "observer-http-"));
  const now = () => "2026-07-25T01:00:00.000Z";
  const created = createServerState({ defaultProjectPath: projectDir, now });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test", protocolVersion: "1", state: created.state,
    defaultProject: created.defaultProject, defaultProjectPath: projectDir,
    persistenceEnabled: false, stateStorePath: join(projectDir, "unused.json"),
    stateSchemaVersion: 1, dispatchLeaseMs: 30_000, now,
  });
  const server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "1", ...httpDependencies });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/terminal-observation/v1`;

  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { authorization: "Bearer " + token } })).status, 401);
  const response = await fetch(url, { headers: { authorization: "Observer " + token } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.contract, "terminal-observation/v1");
  assert.equal(Object.hasOwn(body, "users"), false);
  assert.equal(Object.hasOwn(body, "applications"), false);
  assert.equal(Object.hasOwn(body, "tokens"), false);
  const mutation = await fetch(url, { method: "POST", headers: { authorization: "Observer " + token } });
  assert.equal(mutation.status, 405);
  assert.equal((await mutation.json()).error, "observer_read_only");
});
