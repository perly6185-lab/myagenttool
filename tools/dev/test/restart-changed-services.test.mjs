import assert from "node:assert/strict";
import test from "node:test";
import { servicesForFiles } from "../restart-changed-services-lib.mjs";

test("maps application and Windows paths to their owning services", () => {
  assert.deepEqual(servicesForFiles(["apps/server/src/index.mjs", "apps\\web\\src\\app.tsx"]), ["server", "web"]);
  assert.deepEqual(servicesForFiles(["apps/desktop/src/index.mjs"]), ["desktop"]);
});

test("maps shared and adapter packages to their consumers", () => {
  assert.deepEqual(servicesForFiles(["packages/protocol/src/index.ts"]), ["server", "desktop", "web"]);
  assert.deepEqual(servicesForFiles(["packages/adapters/src/index.ts"]), ["server", "desktop"]);
});

test("maps workspace metadata and demo runner to every service", () => {
  assert.deepEqual(servicesForFiles(["pnpm-lock.yaml"]), ["server", "desktop", "web"]);
  assert.deepEqual(servicesForFiles(["tools/dev/run-local-demo.mjs"]), ["server", "desktop", "web"]);
});

test("ignores documentation and deduplicates service restarts", () => {
  assert.deepEqual(servicesForFiles(["docs/README.md"]), []);
  assert.deepEqual(servicesForFiles(["apps/web/src/a.ts", "apps/web/src/b.ts"]), ["web"]);
});
