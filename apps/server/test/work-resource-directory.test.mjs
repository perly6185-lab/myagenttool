import assert from "node:assert/strict";
import test from "node:test";

import { createWorkResourceDirectoryService } from "../src/services/work-resource-directory.mjs";

const ACTOR = { userId: "usr_1", teamId: "team_1" };

function fixture({ testConnectorConfig = async () => ({ status: 200, body: { ok: true } }) } = {}) {
  const localRecords = [{
    id: `lc_${"a".repeat(32)}`,
    kind: "task_input",
    title: "customers.csv",
    summary: "客户主数据",
    projectId: "prj_1",
    relativePath: "inputs/customers.csv",
    mimeType: "text/csv",
    sourceLabel: "项目输入 · customers.csv",
    original: { available: true },
    metadata: { sha256: "local-content-hash" },
    modifiedAt: "2026-08-26T08:00:00.000Z",
  }];
  const state = {
    projects: [{ id: "prj_1", ownerTeamId: "team_1" }, { id: "prj_2", ownerTeamId: "team_2" }],
    channelObjectFileSources: [{
      id: "source_1", ownerTeamId: "team_1", projectId: "prj_1", kind: "contact",
      fileName: "customers.csv", status: "active", rowCount: 2, contentHash: "source-hash", revision: 3,
      lastImportedAt: "2026-08-26T09:00:00.000Z",
    }],
    channelMutationBindings: [{ fileSourceId: "source_1", status: "active", stale: false }],
    channelObjectConnectorConfigs: [{
      id: "config_1", ownerTeamId: "team_1", projectId: "prj_1", connectorId: "crm",
      name: "公司 CRM", kinds: ["contact"], status: "enabled", health: "ready", revision: 2,
      updatedAt: "2026-08-26T10:00:00.000Z",
    }, {
      id: "config_foreign", ownerTeamId: "team_2", projectId: "prj_2", connectorId: "foreign",
      name: "Foreign secret", kinds: ["contact"], status: "enabled", health: "ready", revision: 1,
    }],
    channelObjectRecords: [{
      id: "record_1", ownerTeamId: "team_1", projectId: "prj_1", kind: "contact", sourceId: "source_1",
      source: "local_file", label: "Alice", status: "active", fields: { email: "alice@example.com", secret: "hidden" },
    }, {
      id: "record_2", ownerTeamId: "team_1", projectId: "prj_1", kind: "contact", source: "crm",
      label: "Bob", status: "active", fields: { email: "bob@example.com", token: "hidden" },
    }],
  };
  const service = createWorkResourceDirectoryService({
    state,
    searchLocalContent: async ({ projectId }) => ({
      status: 200,
      body: { results: localRecords.filter((record) => !projectId || record.projectId === projectId) },
    }),
    previewLocalContent: async () => ({
      status: 200,
      body: { preview: { title: "customers.csv", text: "name,email", truncated: false } },
    }),
    refreshLocalContent: async () => ({ status: 200, body: { refreshed: true } }),
    testConnectorConfig,
  });
  return { service, state };
}

test("projects local ledgers and remote connectors into one table view without duplicates", async () => {
  const { service } = fixture();
  const result = await service.listResources({ projectId: "prj_1", resourceKind: "table" }, ACTOR);

  assert.equal(result.status, 200);
  assert.equal(result.body.count, 2);
  assert.deepEqual(result.body.resources.map((resource) => resource.locality).sort(), ["local", "remote"]);
  assert.equal(result.body.resources.filter((resource) => resource.displayName === "customers.csv").length, 1);
  assert.equal(result.body.resources.some((resource) => JSON.stringify(resource).includes("config_1")), false);
  assert.equal(result.body.resources.some((resource) => JSON.stringify(resource).includes("source_1")), false);
});

test("returns bounded sanitized structured previews", async () => {
  const { service } = fixture();
  const listed = await service.listResources({ projectId: "prj_1", resourceKind: "table", locality: "remote" }, ACTOR);
  const resource = listed.body.resources[0];
  const previewed = await service.previewResource({ resourceId: resource.id }, ACTOR);

  assert.equal(previewed.status, 200);
  assert.equal(previewed.body.preview.kind, "structured_rows");
  assert.equal(previewed.body.preview.rows[0].fields.email, "bob@example.com");
  assert.equal(Object.hasOwn(previewed.body.preview.rows[0].fields, "token"), false);
});

test("does not expose another team's resources or project existence", async () => {
  const { service } = fixture();
  const result = await service.listResources({ projectId: "prj_2" }, ACTOR);
  assert.equal(result.status, 404);
  assert.equal(result.body.error, "project_not_found");
});

test("pins structured execution to a data-derived version and refuses drift", async () => {
  const { service, state } = fixture();
  const listed = await service.listResources({ projectId: "prj_1", resourceKind: "table", locality: "remote" }, ACTOR);
  const resource = listed.body.resources[0];
  assert.match(resource.currentVersion, /^sha256:[a-f0-9]{64}$/);

  const resolved = await service.resolveExecutionReference({ resourceId: resource.id, projectId: "prj_1", expectedVersion: resource.currentVersion }, ACTOR);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.snapshot.rows[0].fields.email, "bob@example.com");
  assert.equal(JSON.stringify(resolved.snapshot).includes("config_1"), false);
  assert.equal(JSON.stringify(resolved.snapshot).includes("record_2"), false);

  state.channelObjectRecords[1].revision = 2;
  state.channelObjectRecords[1].updatedAt = "2026-08-26T11:00:00.000Z";
  const drifted = await service.resolveExecutionReference({ resourceId: resource.id, projectId: "prj_1", expectedVersion: resource.currentVersion }, ACTOR);
  assert.equal(drifted.ok, false);
  assert.equal(drifted.error, "work_resource_version_changed");
  assert.notEqual(drifted.currentVersion, resource.currentVersion);
});

test("refreshes a remote resource by checking its connection without syncing rows", async () => {
  const calls = [];
  const { service } = fixture({ testConnectorConfig: async (id, actor) => {
    calls.push({ id, actor });
    return { status: 200, body: { ok: true } };
  } });
  const listed = await service.listResources({ projectId: "prj_1", locality: "remote" }, ACTOR);
  const refreshed = await service.refreshResource({ resourceId: listed.body.resources[0].id }, ACTOR);

  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.mode, "connection_check");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "config_1");
});
