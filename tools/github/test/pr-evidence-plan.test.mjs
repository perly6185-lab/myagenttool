/*
 * L3 enabler: planPrEvidence maps a diff's changed files to the risk-evidence
 * routes it requires, and (with a draft body) which are still missing — the pure
 * core behind `pnpm pr:evidence`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { planPrEvidence } from "../src/pr-evidence.mjs";

test("a diff with no risk-triggering files requires no routes", () => {
  const plan = planPrEvidence({ files: ["tools/github/src/index.mjs", "package.json"], body: "" });
  assert.deepEqual(plan.routes, []);
});

test("a governed-surface + desktop diff requires Security Review and cross-platform evidence", () => {
  const plan = planPrEvidence({
    files: ["apps/server/src/services/applications.mjs", "apps/desktop/src/local-execution-policy.mjs"],
    body: "",
  });
  const labels = plan.routes.map((r) => r.label);
  assert.ok(labels.some((l) => /Security Review/.test(l)), "governed surface → Security Review");
  assert.ok(labels.some((l) => /Cross-platform/.test(l)), "desktop → cross-platform evidence");
  // With no body, every required route is unsatisfied.
  assert.ok(plan.routes.every((r) => r.present === false));
  assert.equal(plan.bodyProvided, false);
});

test("a draft body that fills the sections marks the routes present and satisfied", () => {
  const files = ["apps/server/src/services/applications.mjs", "apps/desktop/src/local-execution-policy.mjs"];
  const body = [
    "## Verification",
    "- pnpm test passed",
    "Closes #123",
    "## Security Review",
    "- Tenancy: scoped by owning team via denyForeignProject.",
    "- Filesystem: read_only, confined to approvedRoots.",
    "- Approval: unchanged approvalToken gate.",
    "- Injection: argv stays server-side, no new spawn.",
    "cross-platform execution/cancellation verified on macos + linux via the desktop bridge",
  ].join("\n");
  const plan = planPrEvidence({ files, body });
  assert.ok(plan.routes.every((r) => r.present), "every required route is satisfied by the body");
  assert.equal(plan.linksIssue, true);
  assert.equal(plan.verification, true);
  assert.equal(plan.allSatisfied, true);
});

test("a partial body leaves the unfilled routes missing and allSatisfied false", () => {
  const files = ["apps/server/src/services/applications.mjs", "apps/desktop/src/local-execution-policy.mjs"];
  // Verification + Security Review present, but no cross-platform evidence.
  const body = [
    "## Verification",
    "- pnpm test",
    "Closes #1",
    "## Security Review",
    "- Tenancy: x",
    "- Filesystem: x",
    "- Approval: x",
    "- Injection: x",
  ].join("\n");
  const plan = planPrEvidence({ files, body });
  const missing = plan.routes.filter((r) => !r.present).map((r) => r.label);
  assert.ok(missing.some((l) => /Cross-platform/.test(l)), "cross-platform still missing");
  assert.ok(plan.routes.some((r) => /Security Review/.test(r.label) && r.present), "security review satisfied");
  assert.equal(plan.allSatisfied, false);
});

test("each route carries the PR-template section that satisfies it", () => {
  const plan = planPrEvidence({ files: ["apps/web/src/features/x.tsx"], body: "" });
  for (const route of plan.routes) {
    assert.ok(route.section && route.section.length > 0, `${route.label} names a section`);
  }
});
