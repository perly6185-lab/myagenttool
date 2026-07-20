import assert from "node:assert/strict";
import test from "node:test";
import { localApplicationReadiness } from "../src/services/application-readiness.mjs";

const app = { status: "active", runtimeRequirements: [{ runtimeId: "runtime_codex", required: true }] };
const device = (row, status = "online") => ({ status, runtimeReadiness: row ? [row] : [] });

test("local readiness never searches another device", () => {
  assert.equal(localApplicationReadiness(app, null).state, "bridge_offline");
  assert.equal(localApplicationReadiness(app, device(null)).state, "repair_required");
});

test("local readiness distinguishes login, repair, and ready", () => {
  assert.equal(localApplicationReadiness(app, device({ runtimeId: "runtime_codex", status: "available", authenticationStatus: "unauthenticated" })).state, "login_required");
  assert.equal(localApplicationReadiness(app, device({ runtimeId: "runtime_codex", status: "stale" })).state, "repair_required");
  assert.equal(localApplicationReadiness(app, device({ runtimeId: "runtime_codex", status: "available", authenticationStatus: "authenticated" })).state, "ready");
});

test("built-in applications need no external runtime", () => {
  assert.equal(localApplicationReadiness({ id: "app_markdown", status: "active", runtimeRequirements: [] }, null).state, "ready");
});

test("legacy known Applications infer local Runtime requirements by fixed id", () => {
  assert.equal(localApplicationReadiness({ id: "app_codex", status: "active" }, device(null)).state, "repair_required");
});

test("legacy Bridge readiness without runtimeId matches by governed command", () => {
  assert.equal(localApplicationReadiness(app, {
    status: "online",
    applicationBinaryReadiness: [{ command: "codex", status: "available", authenticationStatus: "authenticated" }],
  }).state, "ready");
});
