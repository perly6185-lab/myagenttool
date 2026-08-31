import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const errors = [];
  return {
    logs,
    warnings,
    errors,
    logger: {
      log: (message) => logs.push(message),
      warn: (message) => warnings.push(message),
      error: (message) => errors.push(message),
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

test("persistence-enabled lifecycle rejects non-SQLite stores", async () => {
  let openCalls = 0;
  const log = loggerFixture();
  await assert.rejects(
    openDurableStoreLifecycle({
      persistenceEnabled: true,
      requestedStore: "memory",
      stateStorePath: "/unused/state.json",
      openSqlite: async () => { openCalls += 1; },
      logger: log.logger,
    }),
    (error) => {
      assert.equal(error.code, "unsupported_durable_store");
      assert.equal(error.diagnostic.status, "failed");
      assert.equal(error.diagnostic.backing, null);
      return true;
    },
  );

  assert.equal(openCalls, 0);
  assert.match(log.errors[0], /require SQLite/);
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

test("durable store lifecycle fails closed when SQLite cannot open", async () => {
  const directory = mkdtempSync(join(tmpdir(), "durable-store-fallback-"));
  const log = loggerFixture();
  try {
    await assert.rejects(
      openDurableStoreLifecycle({
        persistenceEnabled: true,
        stateStorePath: join(directory, "state.json"),
        openSqlite: async () => { throw new Error("sqlite load failed"); },
        logger: log.logger,
      }),
      (error) => {
        assert.equal(error.code, "durable_store_open_failed");
        assert.equal(error.diagnostic.status, "failed");
        assert.equal(error.diagnostic.backing, null);
        assert.equal(error.diagnostic.error, "sqlite load failed");
        assert.equal(error.diagnostic.recoveryDirectory, null);
        return true;
      },
    );
    assert.match(log.errors[0], /Startup was aborted/);
    assert.doesNotMatch(log.errors[0], /falling back/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an integrity failure preserves SQLite, WAL, and SHM files before startup aborts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "durable-store-corrupt-"));
  const stateStorePath = join(directory, "state.json");
  const sqlitePath = join(directory, "state.sqlite");
  const files = [sqlitePath, `${sqlitePath}-wal`, `${sqlitePath}-shm`];
  const contents = ["broken-main", "pending-wal", "shared-memory"];
  const log = loggerFixture();
  try {
    files.forEach((file, index) => writeFileSync(file, contents[index]));
    await assert.rejects(
      openDurableStoreLifecycle({
        persistenceEnabled: true,
        stateStorePath,
        openSqlite: async () => {
          const error = new Error("integrity_check returned corruption");
          error.code = "sqlite_integrity_failed";
          throw error;
        },
        logger: log.logger,
        now: () => "2026-08-31T12:34:56.000Z",
      }),
      (error) => {
        assert.equal(error.code, "durable_store_integrity_failed");
        assert.match(error.diagnostic.recoveryDirectory, /state\.sqlite\.recovery-2026-08-31T12-34-56-000Z$/);
        files.forEach((file, index) => {
          assert.equal(readFileSync(file, "utf8"), contents[index], "the source evidence remains untouched");
          const backup = join(error.diagnostic.recoveryDirectory, file.split(/[\\/]/).at(-1));
          assert.equal(readFileSync(backup, "utf8"), contents[index]);
        });
        return true;
      },
    );
    assert.match(log.errors[0], /forensic copy was saved/);
    assert.match(log.errors[0], /JSON export was not loaded/);
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
