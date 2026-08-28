import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  openDurableStoreLifecycle,
  sqlitePathForState,
} from "../src/runtime/durable-store-lifecycle.mjs";

function loggerFixture() {
  const logs = [];
  const warnings = [];
  return {
    logs,
    warnings,
    logger: {
      log: (message) => logs.push(message),
      warn: (message) => warnings.push(message),
    },
  };
}

test("durable store lifecycle stays in memory when persistence is disabled", async () => {
  let openCalls = 0;
  const lifecycle = await openDurableStoreLifecycle({
    persistenceEnabled: false,
    stateStorePath: "/unused/state.json",
    openSqlite: async () => { openCalls += 1; },
  });

  assert.equal(openCalls, 0);
  assert.equal(lifecycle.store, null);
  assert.equal(lifecycle.backing, "memory");
  assert.equal(lifecycle.diagnostic.status, "disabled");
});

test("durable store lifecycle preserves an explicit non-SQLite fallback", async () => {
  let openCalls = 0;
  const lifecycle = await openDurableStoreLifecycle({
    persistenceEnabled: true,
    requestedStore: "memory",
    stateStorePath: "/unused/state.json",
    openSqlite: async () => { openCalls += 1; },
  });

  assert.equal(openCalls, 0);
  assert.equal(lifecycle.backing, "json");
  assert.equal(lifecycle.diagnostic.reason, "sqlite_not_requested");
});

test("durable store lifecycle opens SQLite at the derived path and closes once", async () => {
  const directory = mkdtempSync(join(tmpdir(), "durable-store-lifecycle-"));
  const stateStorePath = join(directory, "nested", "local-demo-state.json");
  const expectedPath = join(directory, "nested", "local-demo-state.sqlite");
  const log = loggerFixture();
  let openedPath = null;
  let closeCalls = 0;
  try {
    const lifecycle = await openDurableStoreLifecycle({
      persistenceEnabled: true,
      requestedStore: "SQLITE",
      stateStorePath,
      openSqlite: async ({ path }) => {
        openedPath = path;
        return { close: () => { closeCalls += 1; } };
      },
      logger: log.logger,
    });

    assert.equal(sqlitePathForState(stateStorePath), expectedPath);
    assert.equal(openedPath, expectedPath);
    assert.equal(existsSync(join(directory, "nested")), true);
    assert.equal(lifecycle.backing, "sqlite");
    assert.equal(lifecycle.diagnostic.status, "ready");
    assert.deepEqual(log.warnings, []);
    lifecycle.close();
    lifecycle.close();
    assert.equal(closeCalls, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("durable store lifecycle degrades loudly with structured evidence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "durable-store-fallback-"));
  const log = loggerFixture();
  try {
    const lifecycle = await openDurableStoreLifecycle({
      persistenceEnabled: true,
      stateStorePath: join(directory, "state.json"),
      openSqlite: async () => { throw new Error("sqlite load failed"); },
      logger: log.logger,
    });

    assert.equal(lifecycle.store, null);
    assert.equal(lifecycle.backing, "json");
    assert.equal(lifecycle.diagnostic.status, "fallback");
    assert.equal(lifecycle.diagnostic.reason, "sqlite_unavailable");
    assert.equal(lifecycle.diagnostic.error, "sqlite load failed");
    assert.match(log.warnings[0], /falling back to the JSON snapshot backing/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("server entry point delegates SQLite adapter loading to the lifecycle boundary", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/index.mjs", import.meta.url), "utf8");
  assert.match(source, /from "\.\/runtime\/durable-store-lifecycle\.mjs"/);
  assert.doesNotMatch(source, /from "\.\/runtime\/store\/sqlite-store\.mjs"/);
  assert.doesNotMatch(source, /import\("\.\/runtime\/store\/sqlite-store\.mjs"\)/);
});
