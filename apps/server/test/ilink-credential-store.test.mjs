import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createIlinkCredentialStore } from "../src/services/ilink-credential-store.mjs";

test("iLink credential store encrypts tokens outside the state snapshot", () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-ilink-"));
  const store = createIlinkCredentialStore({ stateStorePath: join(root, "state.json") });
  store.save("ila_1", { botToken: "super-secret", baseUrl: "https://example.test" });
  assert.deepEqual(store.load("ila_1"), { botToken: "super-secret", baseUrl: "https://example.test" });
  assert.doesNotMatch(readFileSync(store.paths.dataPath, "utf8"), /super-secret/);
  store.remove("ila_1");
  assert.equal(store.load("ila_1"), null);
});
