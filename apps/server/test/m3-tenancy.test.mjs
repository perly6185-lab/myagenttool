/*
 * Route-level regression test for the m3 ai-usage tenancy guard.
 *
 * POST /api/m3/ai-usage attributes cost to a project's ledger/budget, so a
 * foreign team must not be able to bill another team's project. Drives
 * handleM3Routes with stubs — no server boot. The other M3 lifecycle endpoints
 * are operator/org-level (no per-team owner) and intentionally not guarded here.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { handleM3Routes } from "../src/routes/m3.mjs";

const TEAM_A = "team_a";
const TEAM_B = "team_b";

async function postAiUsage({ actor, body }) {
  const state = { projects: [{ id: "proj_a", ownerTeamId: TEAM_A }] };
  const calls = [];
  let recorded = false;
  await handleM3Routes({
    req: { method: "POST" },
    res: {},
    url: new URL("http://local/api/m3/ai-usage"),
    sendJson: (_res, status, payload) => calls.push({ status, payload }),
    readJson: async () => body,
    state,
    actor,
    recordAiUsage: () => {
      recorded = true;
      return { blocked: false };
    },
  });
  return { calls, recorded };
}

test("m3 ai-usage: a foreign team cannot bill another team's project (404, nothing recorded)", async () => {
  const { calls, recorded } = await postAiUsage({
    actor: { teamId: TEAM_B },
    body: { projectId: "proj_a", provider: "openai", model: "gpt", estimatedCost: "1.00" },
  });
  assert.equal(calls.at(-1).status, 404);
  assert.equal(recorded, false, "usage must not be recorded against a foreign project");
});

test("m3 ai-usage: the owning team can record usage", async () => {
  const { calls, recorded } = await postAiUsage({
    actor: { teamId: TEAM_A },
    body: { projectId: "proj_a", provider: "openai", model: "gpt", estimatedCost: "1.00" },
  });
  assert.equal(calls.at(-1).status, 201);
  assert.equal(recorded, true);
});
