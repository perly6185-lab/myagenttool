/*
 * Stage 4-2 (#1342/#1448): the local sign-in command is server-owned metadata on
 * the Runtime Catalog, and a login setup step carries it, so the web never
 * hardcodes per-application login commands.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { findKnownRuntime, listKnownRuntimes, loginCommandForApplicationId } from "../src/services/runtime-catalog.mjs";
import { setupNextStep } from "../src/services/application-readiness.mjs";

test("authentication-requiring runtimes carry an authoritative loginCommand; others do not", () => {
  assert.equal(findKnownRuntime("runtime_codex").loginCommand, "codex login");
  assert.equal(findKnownRuntime("runtime_claude").loginCommand, "claude auth login");
  assert.equal(findKnownRuntime("runtime_git").loginCommand, null);
  // Never a secret/token — just a fixed command name.
  assert.ok(listKnownRuntimes().every((r) => r.loginCommand == null || /^[a-z][a-z0-9 -]+$/.test(r.loginCommand)));
});

test("loginCommandForApplicationId derives from the backing runtime", () => {
  assert.equal(loginCommandForApplicationId("app_codex"), "codex login");
  assert.equal(loginCommandForApplicationId("app_claude"), "claude auth login");
  assert.equal(loginCommandForApplicationId("app_git"), null); // no auth runtime
  assert.equal(loginCommandForApplicationId("app_unknown"), null);
});

test("a login setup step carries the server-owned command; other steps do not", () => {
  const app = { id: "app_codex", status: "active", runtimeRequirements: [{ runtimeId: "runtime_codex", required: true }] };
  const device = (row) => ({ status: "online", runtimeReadiness: [row] });

  const login = setupNextStep(app, device({ runtimeId: "runtime_codex", status: "available", authenticationStatus: "unauthenticated" }));
  assert.equal(login.step, "login");
  assert.equal(login.loginCommand, "codex login");

  const install = setupNextStep(app, device({ runtimeId: "runtime_codex", status: "absent" }));
  assert.equal(install.step, "install");
  assert.equal(install.loginCommand, undefined, "loginCommand appears only on the login step");
});
