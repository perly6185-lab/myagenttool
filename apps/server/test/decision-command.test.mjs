/*
 * The decider command runner (slice 3): env-resolved argv (no shell), issue
 * context on stdin, decision JSON on stdout. Real node subprocesses; every
 * failure mode resolves to null (the caller falls back to the heuristic).
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";

import { deciderTimeoutMs, extractJsonObject, resolveDeciderCommand, runDeciderCommand } from "../src/services/decision-command.mjs";

let dir;
function script(name, source) {
  const file = join(dir, name);
  writeFileSync(file, source);
  return ["node", file];
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), "decider-"));
});

test("resolveDeciderCommand parses the env argv array, rejects junk", () => {
  assert.equal(resolveDeciderCommand({}), null);
  assert.deepEqual(
    resolveDeciderCommand({ MYAGENTTOOL_AUTORUN_DECIDER_COMMAND_JSON: '["node","decide.mjs"]' }),
    ["node", "decide.mjs"],
  );
  assert.equal(resolveDeciderCommand({ MYAGENTTOOL_AUTORUN_DECIDER_COMMAND_JSON: "not json" }), null);
  assert.equal(resolveDeciderCommand({ MYAGENTTOOL_AUTORUN_DECIDER_COMMAND_JSON: "[]" }), null);
});

test("deciderTimeoutMs clamps to a sane range", () => {
  assert.equal(deciderTimeoutMs({}), 30_000);
  assert.equal(deciderTimeoutMs({ MYAGENTTOOL_AUTORUN_DECIDER_TIMEOUT_MS: "5000" }), 5000);
  assert.equal(deciderTimeoutMs({ MYAGENTTOOL_AUTORUN_DECIDER_TIMEOUT_MS: "1" }), 30_000);
});

test("extractJsonObject: strict JSON, prose-wrapped JSON, junk", () => {
  assert.deepEqual(extractJsonObject('{"path":"design"}'), { path: "design" });
  assert.deepEqual(extractJsonObject('Here you go:\n{"path":"design"}\nHope that helps!'), { path: "design" });
  assert.equal(extractJsonObject("no json here"), null);
  assert.equal(extractJsonObject('["array"]'), null);
});

test("runDeciderCommand round-trips stdin context to a stdout decision", async () => {
  const command = script(
    "echoer.mjs",
    [
      "let raw = '';",
      "process.stdin.on('data', (c) => (raw += c));",
      "process.stdin.on('end', () => {",
      "  const ctx = JSON.parse(raw);",
      "  process.stdout.write(JSON.stringify({ path: 'design', confidence: 0.9, rationale: `saw #${ctx.link.number}` }));",
      "});",
    ].join("\n"),
  );
  const decision = await runDeciderCommand({ command, input: { link: { number: 42 } } });
  assert.equal(decision.path, "design");
  assert.match(decision.rationale, /saw #42/);
});

test("runDeciderCommand: non-zero exit, junk output, and bad binary all yield null", async () => {
  assert.equal(await runDeciderCommand({ command: script("fail.mjs", "process.exit(2);") }), null);
  assert.equal(await runDeciderCommand({ command: script("junk.mjs", "process.stdout.write('not json');") }), null);
  assert.equal(await runDeciderCommand({ command: ["/nonexistent/binary"] }), null);
});

test("runDeciderCommand kills a hung decider at the timeout", async () => {
  const command = script("hang.mjs", "setTimeout(() => {}, 60_000);");
  const started = Date.now();
  const decision = await runDeciderCommand({ command, input: {}, timeoutMs: 1500 });
  assert.equal(decision, null);
  assert.ok(Date.now() - started < 10_000, "did not wait for the hung process");
});
