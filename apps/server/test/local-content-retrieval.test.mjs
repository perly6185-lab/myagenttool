import test from "node:test";
import assert from "node:assert/strict";

import {
  createLocalContentRetrievalAuthorizer,
  createLocalContentRetrievalService,
  LOCAL_CONTENT_RETRIEVAL_CONTRACT,
} from "../src/services/local-content-retrieval.mjs";

const actor = { userId: "usr_1", teamId: "team_1" };

function fixture({ previewText = "authoritative reference text" } = {}) {
  const calls = { directories: [], searches: [], reads: [], events: [] };
  const service = createLocalContentRetrievalService({
    browseDirectories: async (input, receivedActor) => {
      calls.directories.push({ input, actor: receivedActor });
      return { status: 200, body: { dimension: input.dimension, entries: [{ value: "work_1", count: 3 }], count: 1, totalEntries: 1, hasMore: false, nextCursor: null } };
    },
    searchLocalContent: async (input, receivedActor) => {
      calls.searches.push({ input, actor: receivedActor });
      return { status: 200, body: { results: [{
        id: `lc_${"a".repeat(32)}`,
        kind: "article",
        projectId: "project_1",
        workItemId: "work_1",
        title: "Indexed source",
        summary: "Bounded summary",
        source: { type: "article_import", id: "private-source-id" },
        sourceLabel: "Project · Task",
        occurredAt: "2026-08-15T00:00:00.000Z",
        original: { available: true, reason: null },
        indexStatus: "ready",
        matchSnippet: "matched phrase",
        relativePath: "private/original.md",
      }], count: 1, query: input.query, hasMore: false, nextCursor: null } };
    },
    readLocalContentText: async (input, receivedActor) => {
      calls.reads.push({ input, actor: receivedActor });
      const text = previewText.slice(input.offset, input.offset + input.limit);
      const nextOffset = input.offset + text.length;
      return { status: 200, body: { chunk: {
        contentId: input.contentId,
        title: "Indexed source",
        kind: "article",
        mimeType: "text/markdown",
        format: "plain_text",
        offset: input.offset,
        text,
        nextOffset: nextOffset < previewText.length ? nextOffset : null,
        eof: nextOffset >= previewText.length,
        sourceTruncated: false,
        continuationUnavailable: false,
      } } };
    },
    authorizeRetrieval: () => ({ ok: true }),
    appendEvent: (event) => calls.events.push(event),
  });
  return { service, calls };
}

test("provider-neutral retrieval separates directory, summary, and original stages", async () => {
  const fx = fixture();
  const context = { invocationId: "inv_1", provider: "claude" };
  const directory = await fx.service.directory({ ...context, dimension: "work_item", limit: 500 }, actor);
  assert.equal(directory.status, 200);
  assert.equal(directory.body.trust, "untrusted_reference");
  assert.equal(fx.calls.directories[0].input.limit, 50);
  assert.equal(fx.calls.directories[0].actor, actor);

  const summaries = await fx.service.summaries({ ...context, query: "indexed", limit: 500 }, actor);
  assert.equal(summaries.status, 200);
  assert.equal(fx.calls.searches[0].input.limit, 20);
  assert.deepEqual(summaries.body.candidates[0].directory, {
    kind: "article", projectId: "project_1", workItemId: "work_1", sourceType: "article_import",
  });
  assert.equal(summaries.body.candidates[0].summary, "Bounded summary");
  assert.equal(JSON.stringify(summaries.body).includes("private/original.md"), false);
  assert.equal(JSON.stringify(summaries.body).includes("private-source-id"), false);

  const read = await fx.service.read({ ...context, contentId: `lc_${"a".repeat(32)}`, offset: 0, limit: 12 }, actor);
  assert.equal(read.status, 200);
  assert.equal(read.body.text, "authoritativ");
  assert.equal(read.body.trust, "untrusted_reference");
  assert.equal(read.body.budget.readsUsed, 1);
  assert.equal(fx.calls.reads[0].input.limit, 12);
  assert.deepEqual(fx.calls.events.map((event) => event.data.operation), ["directory", "summaries", "read"]);
  assert.equal(fx.calls.events.every((event) => event.invocationId === "inv_1"), true);
});

test("retrieval reports an unavailable continuation without claiming end of file", async () => {
  const fx = fixture();
  fx.service.releaseInvocation("inv_partial");
  const service = createLocalContentRetrievalService({
    readLocalContentText: async (input) => ({ status: 200, body: { chunk: {
      contentId: input.contentId,
      title: "Parser-limited document",
      kind: "article",
      mimeType: "application/pdf",
      format: "plain_text",
      offset: 0,
      text: "extracted prefix",
      nextOffset: null,
      eof: false,
      sourceTruncated: true,
      continuationUnavailable: true,
    } } }),
    authorizeRetrieval: () => ({ ok: true }),
  });
  const result = await service.read({
    invocationId: "inv_partial", provider: "claude", contentId: `lc_${"c".repeat(32)}`,
  }, actor);
  assert.equal(result.status, 200);
  assert.equal(result.body.eof, false);
  assert.equal(result.body.nextOffset, null);
  assert.equal(result.body.sourceTruncated, true);
  assert.equal(result.body.continuationUnavailable, true);
});

test("retrieval validates provider context and enforces per-invocation read budgets", async () => {
  const fx = fixture({ previewText: "x".repeat(200_000) });
  assert.deepEqual(await fx.service.directory({ invocationId: "inv_1", provider: "other", dimension: "kind" }, actor), {
    status: 400, body: { error: "local_content_retrieval_provider_invalid" },
  });
  for (let index = 0; index < 4; index += 1) {
    const result = await fx.service.read({
      invocationId: "inv_budget", provider: "codex", contentId: `lc_${"b".repeat(32)}`, offset: index * 32_768, limit: 32_768,
    }, actor);
    assert.equal(result.status, 200);
  }
  const limited = await fx.service.read({
    invocationId: "inv_budget", provider: "codex", contentId: `lc_${"b".repeat(32)}`, offset: 131_072, limit: 1,
  }, actor);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, "local_content_retrieval_character_limit_exceeded");
  assert.equal(fx.service.releaseInvocation("inv_budget"), true);
  const afterRelease = await fx.service.read({
    invocationId: "inv_budget", provider: "codex", contentId: `lc_${"b".repeat(32)}`, offset: 0, limit: 1,
  }, actor);
  assert.equal(afterRelease.status, 200);
});

test("retrieval fails closed when invocation authorization is unavailable or denied", async () => {
  const unavailable = createLocalContentRetrievalService({
    browseDirectories: async () => ({ status: 200, body: {} }),
  });
  assert.deepEqual(await unavailable.directory({ invocationId: "inv_1", provider: "claude", dimension: "kind" }, actor), {
    status: 503, body: { error: "local_content_retrieval_authorizer_unavailable" },
  });
  const deniedEvents = [];
  const denied = createLocalContentRetrievalService({
    browseDirectories: async () => ({ status: 200, body: {} }),
    authorizeRetrieval: () => ({ ok: false, status: 404, error: "invocation_not_found" }),
    appendEvent: (event) => deniedEvents.push(event),
  });
  assert.deepEqual(await denied.directory({ invocationId: "inv_foreign", provider: "codex", dimension: "kind" }, actor), {
    status: 404, body: { error: "invocation_not_found" },
  });
  assert.equal(deniedEvents[0].data.status, 404);
  assert.equal(JSON.stringify(deniedEvents[0]).includes("reference text"), false);
});

test("Claude and Codex share one versioned read-only tool contract", async () => {
  const fx = fixture();
  const described = fx.service.describe();
  assert.equal(described.body, LOCAL_CONTENT_RETRIEVAL_CONTRACT);
  assert.equal(described.body.version, "1.0.0");
  assert.deepEqual(described.body.tools.map((tool) => tool.name), [
    "local_content.directories",
    "local_content.search",
    "local_content.read",
  ]);
  assert.equal(described.body.tools.every((tool) => tool.annotations.readOnlyHint), true);
  assert.equal(described.body.tools.every((tool) => tool.inputSchema.properties.provider.enum.join() === "claude,codex"), true);

  const claude = await fx.service.invoke("local_content.search", {
    invocationId: "inv_claude", provider: "claude", query: "indexed",
  }, actor);
  const codex = await fx.service.invoke("local_content.search", {
    invocationId: "inv_codex", provider: "codex", query: "indexed",
  }, actor);
  assert.deepEqual(codex, claude);
  assert.deepEqual(await fx.service.invoke("local_content.unknown", {}, actor), {
    status: 404, body: { error: "local_content_retrieval_tool_not_found" },
  });
});

test("invocation authorizer binds active provider and tenant scope", () => {
  const state = {
    agents: [
      { id: "agt_codex", adapter: { type: "cli", command: "codex" } },
      { id: "agt_claude", adapter: { type: "cli", command: "claude" } },
    ],
    invocations: [
      { id: "inv_running", status: "running", agentId: "agt_codex", projectId: "prj_1", requestedBy: "usr_1" },
      { id: "inv_queued", status: "queued", agentId: "agt_claude", requestedBy: "usr_1" },
    ],
    projects: [{ id: "prj_1", ownerTeamId: "team_1" }],
  };
  const authorize = createLocalContentRetrievalAuthorizer({ state, teamOf: (project) => project.ownerTeamId });
  assert.equal(authorize({ invocationId: "inv_running", provider: "codex" }, null).status, 401);
  assert.deepEqual(authorize({ invocationId: "inv_running", provider: "codex" }, actor), { ok: true });
  assert.equal(authorize({ invocationId: "inv_running", provider: "claude" }, actor).error, "local_content_retrieval_provider_mismatch");
  assert.equal(authorize({ invocationId: "inv_running", provider: "codex" }, { ...actor, teamId: "team_2" }).status, 404);
  assert.equal(authorize({ invocationId: "inv_queued", provider: "claude" }, actor).error, "local_content_retrieval_invocation_inactive");
});
