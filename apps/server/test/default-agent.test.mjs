import assert from "node:assert/strict";
import test from "node:test";

import { selectDefaultAgent } from "../src/services/invocations.mjs";

const agent = (id, type = "cli") => ({ id, adapter: { type } });

test("Codex CLI is the canonical default agent", () => {
  const agents = [agent("agt_demo_cli"), agent("agt_codex_cli"), agent("agt_other")];
  assert.equal(selectDefaultAgent(agents)?.id, "agt_codex_cli");
});

test("a real repository agent is preferred over the demo fallback when Codex is absent", () => {
  const agents = [agent("agt_demo_cli"), agent("agt_other"), agent("agt_platform", "platform")];
  assert.equal(selectDefaultAgent(agents)?.id, "agt_other");
});

test("the demo agent remains a last-resort compatibility fallback", () => {
  assert.equal(selectDefaultAgent([agent("agt_demo_cli")])?.id, "agt_demo_cli");
  assert.equal(selectDefaultAgent([]), null);
});
