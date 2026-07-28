// Regression smoke for the first-class Claude Code agent (#188 + review fix #191):
// detection, permission-mode normalization, args, output-format resolution, the
// deterministic-id upserts for both supported coding agents.
import assert from "node:assert/strict";
import {
  claudeCliArgs,
  createAgentService,
  defaultRiskTags,
  isClaudeCliCommand,
  normalizeClaudePermissionMode,
  normalizeCliOutputFormat,
} from "../../apps/server/src/services/agents.mjs";

let passed = 0;
const ok = (msg) => { passed += 1; console.log(`  ok - ${msg}`); };

// Detection (incl. the unified claude.ps1 from #191).
assert.equal(isClaudeCliCommand("claude"), true);
assert.equal(isClaudeCliCommand("/usr/local/bin/claude"), true);
assert.equal(isClaudeCliCommand("claude.ps1"), true);
assert.equal(isClaudeCliCommand("codex"), false);
ok("isClaudeCliCommand (incl. claude.ps1)");

// Permission mode allowlist.
assert.equal(normalizeClaudePermissionMode("acceptEdits"), "acceptEdits");
assert.equal(normalizeClaudePermissionMode("default"), "plan", "interactive modes fall back to plan");
assert.equal(normalizeClaudePermissionMode(undefined), "plan");
ok("normalizeClaudePermissionMode allowlist");

// Args + output format + risk tags.
assert.deepEqual(claudeCliArgs("acceptEdits"),
  ["-p", "{{task}}", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits"]);
assert.equal(normalizeCliOutputFormat(undefined, "claude"), "claude_jsonl");
assert.equal(normalizeCliOutputFormat(undefined, "codex"), "codex_jsonl");
assert.equal(normalizeCliOutputFormat(undefined, "foo"), "plain_result");
assert.deepEqual(defaultRiskTags("cli", "claude"),
  ["read_local", "write_local", "shell_exec", "network_access", "repo_context", "code_change"]);
ok("claudeCliArgs + output-format + risk tags");

// createCliAgent via registerAgent: deterministic ids + upsert.
{
  const state = { device: { id: "dev1", status: "online" }, agents: [] };
  let n = 0;
  const svc = createAgentService({ state, now: () => "t", nextId: (p) => `${p}_${++n}`, appendEvent: () => {} });

  const a = svc.registerAgent({ type: "cli", command: "claude", permissionMode: "acceptEdits" });
  assert.equal(a.id, "agt_claude_acceptEdits", "deterministic id per mode");
  assert.equal(a.adapter.outputFormat, "claude_jsonl");
  assert.equal(a.adapter.permissionMode, "acceptEdits");
  assert.equal(a.capabilities[0].riskLevel, "high");

  svc.registerAgent({ type: "cli", command: "claude", permissionMode: "acceptEdits", name: "Renamed" });
  assert.equal(state.agents.length, 1, "same mode upserts in place");
  assert.equal(state.agents[0].name, "Renamed");

  svc.registerAgent({ type: "cli", command: "claude", permissionMode: "plan" });
  assert.equal(state.agents.length, 2, "different mode is a distinct agent");

  const cdx = svc.registerAgent({ type: "cli", command: "codex" });
  assert.equal(cdx.id, "agt_codex_cli", "default Codex Ask mode reuses the seeded deterministic id");
  assert.equal(cdx.adapter.outputFormat, "codex_jsonl");
  assert.equal(cdx.adapter.permissionMode, "ask");
  assert.equal(cdx.adapter.sandbox, "workspace-write");
  ok("createCliAgent: deterministic-id upserts for Claude and Codex");
}

console.log(`\nclaude-agent-smoke: ${passed} checks passed`);
