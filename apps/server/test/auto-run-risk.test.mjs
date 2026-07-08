/*
 * The merge-risk model — drives the risk badge and (slice 3) the auto-merge
 * policy. A regression that rates a failing/unverified run "low" would let the
 * loop auto-merge a bad PR, so the level boundaries are the safety line.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { computeMergeRisk, matchesGlob, sensitivePathHit, DEFAULT_SENSITIVE_PATHS } from "../src/services/auto-run-risk.mjs";

const green = {
  verification: { verified: true, passed: true },
  judgment: { solved: true, confidence: 0.95 },
  prChecks: { total: 3, passed: 3, failed: 0, pending: 0, state: "SUCCESS" },
  promptInjection: null,
};

test("all signals green => low", () => {
  const r = computeMergeRisk(green);
  assert.equal(r.level, "low");
});

test("a hard-negative signal => high (each one)", () => {
  assert.equal(computeMergeRisk({ ...green, verification: { verified: true, passed: false } }).level, "high");
  assert.equal(computeMergeRisk({ ...green, judgment: { solved: false, confidence: 0.9 } }).level, "high");
  assert.equal(computeMergeRisk({ ...green, prChecks: { total: 2, passed: 1, failed: 1, pending: 0, state: "FAILURE" } }).level, "high");
  assert.equal(computeMergeRisk({ ...green, promptInjection: { suspicious: true, markers: ["x"] } }).level, "high");
});

test("missing/unsettled signal (no failure) => medium", () => {
  assert.equal(computeMergeRisk({ ...green, verification: { verified: false, passed: true } }).level, "medium", "no verify command");
  assert.equal(computeMergeRisk({ ...green, judgment: null }).level, "medium", "judge not run");
  assert.equal(computeMergeRisk({ ...green, prChecks: { total: 0, passed: 0, failed: 0, pending: 0, state: "NONE" } }).level, "medium", "no checks");
  assert.equal(computeMergeRisk({ ...green, prChecks: { total: 2, passed: 1, failed: 0, pending: 1, state: "PENDING" } }).level, "medium", "checks pending");
});

test("judge solved but low confidence => not low (medium)", () => {
  assert.equal(computeMergeRisk({ ...green, judgment: { solved: true, confidence: 0.4 } }).level, "medium");
});

test("high level reports the hard reasons, not the soft ones", () => {
  const r = computeMergeRisk({ ...green, prChecks: { total: 2, passed: 1, failed: 1, pending: 0, state: "FAILURE" } });
  assert.equal(r.level, "high");
  assert.ok(r.reasons.some((x) => /failing/.test(x)));
});

test("extra AI-review + diff-size signals (slice 2/3)", () => {
  assert.equal(computeMergeRisk(green, { extra: { review: { status: "fail", summary: "unsafe" } } }).level, "high");
  assert.equal(computeMergeRisk(green, { extra: { review: { status: "pass" } } }).level, "low", "review pass keeps it low");
  assert.equal(computeMergeRisk(green, { extra: { review: null } }).level, "low", "no review configured doesn't downgrade on its own");
  assert.equal(computeMergeRisk(green, { extra: { diffTooLarge: true } }).level, "medium", "oversized diff blocks low");
  assert.equal(computeMergeRisk(green, { extra: { review: { status: "unknown" } } }).level, "medium", "review requested but not run => not low");
});

test("sensitive-path signal downgrades an otherwise-green run", () => {
  const hit = { path: ".github/workflows/ci.yml", pattern: ".github/workflows/**" };
  const r = computeMergeRisk(green, { extra: { review: { status: "pass" }, sensitivePath: hit } });
  assert.equal(r.level, "medium");
  assert.ok(r.reasons.some((x) => /sensitive path/.test(x)));
});

test("matchesGlob: ** / *, segment boundaries", () => {
  assert.equal(matchesGlob(".github/workflows/ci.yml", ".github/workflows/**"), true);
  assert.equal(matchesGlob("a/b/migrations/x.sql", "**/migrations/**"), true);
  assert.equal(matchesGlob("migrations/x.sql", "**/migrations/**"), true, "**/ matches zero dirs");
  assert.equal(matchesGlob("apps/web/package.json", "**/package.json"), true);
  assert.equal(matchesGlob("src/main/Hello.java", "**/auth/**"), false);
  assert.equal(matchesGlob("src/x.tsx", "*.tsx"), false, "* does not cross a separator");
  assert.equal(matchesGlob("x.tsx", "*.tsx"), true);
});

test("sensitivePathHit: first match across path-strings or {path} objects", () => {
  assert.equal(sensitivePathHit(["src/Hello.java", "README.md"], DEFAULT_SENSITIVE_PATHS), null);
  const hit = sensitivePathHit([{ path: "src/Hello.java" }, { path: ".github/workflows/ci.yml" }], DEFAULT_SENSITIVE_PATHS);
  assert.equal(hit.path, ".github/workflows/ci.yml");
  assert.equal(sensitivePathHit(["anything"], []), null, "empty pattern list never hits");
});

test("DEFAULT_SENSITIVE_PATHS catches single-file + case + variant evasions (audit)", () => {
  for (const p of ["src/auth.ts", "lib/authMiddleware.js", "bun.lockb", "terraform.tfvars", "services/api/infra/deploy.yaml", ".ENV", "Containerfile", "src/session.key", "config/secret.json", ".github/dependabot.yml"]) {
    assert.ok(sensitivePathHit([p], DEFAULT_SENSITIVE_PATHS), `${p} must be sensitive`);
  }
  for (const p of ["README.md", "src/main/Hello.java", "docs/guide.md", "src/components/Button.tsx"]) {
    assert.equal(sensitivePathHit([p], DEFAULT_SENSITIVE_PATHS), null, `${p} must be normal`);
  }
});

test("matchesGlob is case-insensitive", () => {
  assert.equal(matchesGlob(".ENV.local", "**/.env*"), true);
  assert.equal(matchesGlob("Dockerfile", "**/*dockerfile*"), true);
});
