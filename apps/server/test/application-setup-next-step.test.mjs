/*
 * Stage 4-1 (#1342/#1447): the add/install/login/register state-machine core.
 * setupNextStep is a pure derivation over Stage 3 local readiness — it names the
 * single next step toward a ready + registered Application.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { setupNextStep } from "../src/services/application-readiness.mjs";

const app = { status: "active", runtimeRequirements: [{ runtimeId: "runtime_codex", required: true }] };
const device = (row, status = "online") => ({ status, runtimeReadiness: row ? [row] : [] });

test("maps each runtime-blocked readiness to its remediation step", () => {
  assert.equal(setupNextStep(app, null).step, "start_bridge"); // no bridge
  assert.equal(setupNextStep(app, device({ runtimeId: "runtime_codex", status: "absent" })).step, "install");
  assert.equal(setupNextStep(app, device({ runtimeId: "runtime_codex", status: "stale" })).step, "repair");
  assert.equal(setupNextStep(app, device({ runtimeId: "runtime_codex", status: "available", authenticationStatus: "unauthenticated" })).step, "login");
});

test("a ready runtime yields register when unregistered, ready when already registered", () => {
  const ready = device({ runtimeId: "runtime_codex", status: "available", authenticationStatus: "authenticated" });
  assert.equal(setupNextStep(app, ready, { registered: false }).step, "register");
  assert.equal(setupNextStep(app, ready, { registered: true }).step, "ready");
});

test("a built-in Application (no runtime) needs only registration", () => {
  const builtin = { id: "app_markdown", status: "active", runtimeRequirements: [] };
  assert.equal(setupNextStep(builtin, null).step, "register"); // ready runtime-wise, just not registered
  assert.equal(setupNextStep(builtin, null, { registered: true }).step, "ready");
});

test("carries the readiness state + a non-null action for actionable steps", () => {
  const result = setupNextStep(app, device({ runtimeId: "runtime_codex", status: "absent" }));
  assert.equal(result.state, "not_installed");
  assert.equal(result.action, "install");
  assert.equal(result.scope, "local");
  // register is actionable even though readiness action is null for a ready runtime.
  assert.equal(setupNextStep(app, device({ runtimeId: "runtime_codex", status: "available", authenticationStatus: "authenticated" })).action, "register");
});

test("an archived Application has no next step", () => {
  assert.equal(setupNextStep({ status: "archived", runtimeRequirements: [] }, null).step, "none");
});
