import assert from "node:assert/strict";
import { test } from "node:test";

import { filterCapabilities } from "../src/routes/capabilities.mjs";
import { createCapabilityService } from "../src/services/capabilities.mjs";
import { CODING_AGENT_INTERFACE_FAMILY, codingAgentInterfaceForTool } from "../src/services/coding-agent-interface.mjs";

const codexTool = { name: "codex.review.diff", agents: [{ status: "available" }], outputCollection: "codexReviewFindings" };
const claudeCapability = {
  name: "app.app_claude.review.diff",
  provider: { type: "application", id: "app_claude" },
  kind: "tool_facade",
  status: "available",
  metadata: {
    execution: { mode: "tool_facade", toolName: "claude.review.diff" },
    outputCollection: "claudeReviewFindings",
    interface: codingAgentInterfaceForTool("claude.review.diff", { outputCollection: "claudeReviewFindings" }),
  },
};

function harness() {
  const invocations = [];
  const tools = [codexTool, { name: "claude.review.diff", agents: [{ status: "available" }], outputCollection: "claudeReviewFindings" }];
  const service = createCapabilityService({
    state: { projects: [], applications: [{ id: "app_claude", name: "Claude", status: "active", ownerTeamId: "team_local" }] },
    listTools: () => tools,
    getTool: (name) => tools.find((item) => item.name === name) ?? null,
    createToolInvocation: (name) => {
      const invocation = { id: `inv_${invocations.length + 1}`, status: "queued", options: { metadata: { tool: name } } };
      invocations.push(invocation);
      return { status: 201, body: { tool: name, invocation } };
    },
    listApplications: () => [{ id: "app_claude", name: "Claude", status: "active", ownerTeamId: "team_local" }],
    listApplicationCapabilities: () => [claudeCapability],
    invokeApplicationCapability: () => ({ ok: false }),
    createInvocation: () => { throw new Error("not used"); },
    completeInvocation: () => {},
    findAgent: () => null,
    planAgentFacadeInvocation: () => null,
    planApplicationWrapperInvocation: () => null,
  });
  return { service, invocations };
}

test("Codex Tool and Claude Application publish coding-agent/v1 provenance and parity metadata", () => {
  const { service } = harness();
  const capabilities = service.listCapabilities({ teamId: "team_local" });
  const codex = capabilities.find((item) => item.name === "codex.review.diff");
  const claude = capabilities.find((item) => item.name === "app.app_claude.review.diff");
  assert.equal(codex.provider.type, "tool");
  assert.equal(claude.provider.type, "application");
  for (const capability of [codex, claude]) {
    assert.equal(capability.metadata.interface.family, CODING_AGENT_INTERFACE_FAMILY);
    assert.equal(capability.metadata.interface.version, "1");
    assert.equal(capability.metadata.interface.operation, "review.diff");
    assert.equal(capability.metadata.interface.mutation, "read_only");
  }
});

test("Tool and Application facade invocations return the same additive envelope", () => {
  const { service } = harness();
  const codex = service.createCapabilityInvocation("codex.review.diff", {});
  const claude = service.createCapabilityInvocation("app.app_claude.review.diff", {});
  for (const [result, providerType, collection] of [[codex, "tool", "codexReviewFindings"], [claude, "application", "claudeReviewFindings"]]) {
    assert.equal(result.status, 201);
    assert.ok(result.body.capability);
    assert.equal(result.body.provider.type, providerType);
    assert.match(result.body.invocationId, /^inv_/u);
    assert.equal(result.body.status, "queued");
    assert.equal(result.body.outputCollection, collection);
    assert.equal(result.body.interface.family, CODING_AGENT_INTERFACE_FAMILY);
  }
  assert.equal(codex.body.tool, "codex.review.diff", "legacy Tool field remains available");
});

test("capability filters select the interface family and provider-neutral operation", () => {
  const capabilities = harness().service.listCapabilities({ teamId: "team_local" });
  const byFamily = filterCapabilities(capabilities, new URLSearchParams("interfaceFamily=coding_agent"));
  assert.deepEqual(byFamily.map((item) => item.name).sort(), ["app.app_claude.review.diff", "claude.review.diff", "codex.review.diff"]);
  const reviews = filterCapabilities(capabilities, new URLSearchParams("interfaceFamily=coding_agent&operation=review.diff"));
  assert.equal(reviews.length, 3);
  assert.equal(filterCapabilities(capabilities, new URLSearchParams("operation=execute.change")).length, 0, "disabled Codex exec is not invented by the interface mapper");
});

test("write operations publish distinct mutation and approval posture", () => {
  assert.deepEqual(codingAgentInterfaceForTool("codex.exec", { outputCollection: "codexExecChanges" }), {
    family: "coding_agent", version: "1", provider: "codex", operation: "execute.change", mutation: "worktree_write", session: "isolated", approval: "approval_broker", resultCollection: "codexExecChanges",
  });
  assert.equal(codingAgentInterfaceForTool("ccusage.report"), null);
});
