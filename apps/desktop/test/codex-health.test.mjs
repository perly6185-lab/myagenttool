import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateCodexHealth } from "../src/codex-health.mjs";

const helpOk = { status: 0, stdout: "Run Codex non-interactively\nUsage: codex exec" };

test("Codex health requires both the exec surface and authentication", () => {
  const healthy = evaluateCodexHealth({ helpResult: helpOk, authResult: { status: 0 } });
  assert.equal(healthy.ok, true);
  assert.equal(healthy.authenticated, true);

  const loggedOut = evaluateCodexHealth({ helpResult: helpOk, authResult: { status: 1, stderr: "Not logged in" } });
  assert.equal(loggedOut.ok, false);
  assert.match(loggedOut.summary, /not authenticated/);
  assert.match(loggedOut.nextAction, /codex login/);
});

test("Codex health distinguishes unavailable and timed-out probes", () => {
  assert.match(
    evaluateCodexHealth({ helpResult: { status: 1 }, authResult: { status: 0 } }).summary,
    /unavailable/,
  );
  assert.match(
    evaluateCodexHealth({ helpResult: helpOk, authResult: { status: null, timedOut: true } }).summary,
    /timed out/,
  );
});

test("the deterministic fixture is treated as authenticated without a user login", () => {
  const result = evaluateCodexHealth({ helpResult: helpOk, authResult: null, fixture: true });
  assert.equal(result.ok, true);
});
