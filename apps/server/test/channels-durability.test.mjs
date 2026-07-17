/*
 * S2 (#1090): channel registry records — the channel, its identity mappings,
 * and lifecycle status — survive a crash/restart via the Store (parent
 * acceptance: "Channel ... state survive server restart"). Crash model:
 * persistStateNow commits, persistStateSoon is a no-op.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createInMemoryStore } from "../src/runtime/store/in-memory-store.mjs";
import { createChannelService } from "../src/services/channels.mjs";

const now = () => "2026-07-15T00:00:00.000Z";
const owner = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };

test("a registered+enabled channel and its identity mapping survive restart", () => {
  const root = join(tmpdir(), `myagenttool-channel-durability-${process.pid}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });
  try {
    const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now });
    const persistence = createPersistenceRuntime({
      state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject, sameProjectPath: () => false,
    });
    const store = createInMemoryStore({ state, commit: () => persistence.persistStateNow() });
    let counter = 0;
    const service = createChannelService({
      state,
      now,
      nextId: (prefix) => `${prefix}_${String(++counter).padStart(4, "0")}`,
      appendEvent: () => {},
      persistStateSoon: () => {},
      store,
      validateApprovalToken: () => ({ approved: true }),
    });

    const created = service.registerChannel({ provider: "wecom", name: "ops" }, owner);
    const channelId = created.body.channel.id;
    service.enableChannel({ channelId, approvalToken: "ok" }, owner);
    service.mapChannelIdentity({ channelId, externalUserId: "wx_1", userId: "usr_local" }, owner);

    const fresh = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({
      state: fresh.state, enabled: true, stateStorePath, schemaVersion: 1, now,
      defaultProject: fresh.defaultProject, sameProjectPath: () => false,
    }).restorePersistentState();

    const channel = (fresh.state.channels ?? []).find((row) => row.id === channelId);
    assert(channel, "channel record is durable");
    assert.equal(channel.status, "enabled");
    assert.equal(channel.ownerTeamId, "team_local");
    const identity = (fresh.state.channelIdentities ?? []).find((row) => row.channelId === channelId);
    assert(identity, "identity mapping is durable");
    assert.equal(identity.externalUserId, "wx_1");
    assert.equal(identity.userId, "usr_local");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
