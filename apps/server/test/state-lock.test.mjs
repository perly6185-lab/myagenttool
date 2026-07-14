/*
 * #890 single-writer lock. Proves the lockfile refuses a second live writer,
 * reclaims a stale one (dead owner), never deletes a foreign lock on release, and
 * treats an unverifiable cross-host lock conservatively.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { acquireStateLock } from "../src/runtime/state-lock.mjs";

const now = () => "2026-07-14T00:00:00.000Z";

function tmpRoot() {
  const root = join(tmpdir(), `myagenttool-lock-${Date.now()}-${Math.floor(process.hrtime()[1] % 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

test("#890 acquire on a fresh path succeeds and writes an owner record", () => {
  const root = tmpRoot();
  const statePath = join(root, "state", "snapshot.json");
  try {
    const lock = acquireStateLock(statePath, { pid: 4242, hostname: "hostA", now });
    assert.equal(lock.ok, true);
    assert.equal(lock.lockPath, `${statePath}.lock`);
    const written = JSON.parse(readFileSync(lock.lockPath, "utf8"));
    assert.equal(written.pid, 4242);
    assert.equal(written.hostname, "hostA");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#890 a DIFFERENT live process on the same host is refused", () => {
  const root = tmpRoot();
  const statePath = join(root, "snapshot.json");
  const lockPath = `${statePath}.lock`;
  try {
    // pid 1 (init/launchd) is always alive; kill(1,0) throws EPERM → treated alive.
    writeFileSync(lockPath, JSON.stringify({ pid: 1, hostname: "hostA", acquiredAt: now() }));
    const lock = acquireStateLock(statePath, { pid: 4242, hostname: "hostA", now });
    assert.equal(lock.ok, false);
    assert.equal(lock.heldBy.pid, 1);
    // The incumbent lock is untouched.
    assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).pid, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#890 a stale lock (dead owner) is reclaimed", () => {
  const root = tmpRoot();
  const statePath = join(root, "snapshot.json");
  const lockPath = `${statePath}.lock`;
  try {
    writeFileSync(lockPath, JSON.stringify({ pid: 999_999_999, hostname: "hostA", acquiredAt: now() }));
    const lock = acquireStateLock(statePath, { pid: 4242, hostname: "hostA", now });
    assert.equal(lock.ok, true, "a dead owner's lock is reclaimed");
    assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).pid, 4242);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#890 an unreadable/garbage lock is reclaimed", () => {
  const root = tmpRoot();
  const statePath = join(root, "snapshot.json");
  const lockPath = `${statePath}.lock`;
  try {
    writeFileSync(lockPath, "not json at all");
    const lock = acquireStateLock(statePath, { pid: 4242, hostname: "hostA", now });
    assert.equal(lock.ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#890 release removes our lock, and re-acquire then succeeds", () => {
  const root = tmpRoot();
  const statePath = join(root, "snapshot.json");
  try {
    const first = acquireStateLock(statePath, { pid: 4242, hostname: "hostA", now });
    assert.equal(first.ok, true);
    first.release();
    assert.equal(existsSync(first.lockPath), false, "release removes our own lock");
    const second = acquireStateLock(statePath, { pid: 4343, hostname: "hostA", now });
    assert.equal(second.ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#890 release never deletes a foreign lock", () => {
  const root = tmpRoot();
  const statePath = join(root, "snapshot.json");
  const lockPath = `${statePath}.lock`;
  try {
    const mine = acquireStateLock(statePath, { pid: 4242, hostname: "hostA", now });
    assert.equal(mine.ok, true);
    // Another process overwrites the lock (simulating a takeover after a reclaim).
    writeFileSync(lockPath, JSON.stringify({ pid: 1, hostname: "hostA", acquiredAt: now() }));
    mine.release(); // must NOT delete pid 1's lock
    assert.equal(existsSync(lockPath), true, "a foreign lock survives our release");
    assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).pid, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#890 re-acquiring our own lock (same pid+host) is idempotent", () => {
  const root = tmpRoot();
  const statePath = join(root, "snapshot.json");
  try {
    const first = acquireStateLock(statePath, { pid: 4242, hostname: "hostA", now });
    assert.equal(first.ok, true);
    const again = acquireStateLock(statePath, { pid: 4242, hostname: "hostA", now });
    assert.equal(again.ok, true, "the same process re-acquiring its own lock succeeds");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#890 a lock from another host cannot be verified and is refused", () => {
  const root = tmpRoot();
  const statePath = join(root, "snapshot.json");
  const lockPath = `${statePath}.lock`;
  try {
    // pid 4242 might be dead HERE, but we cannot check liveness on another host,
    // so clobbering could corrupt a live writer there — refuse conservatively.
    writeFileSync(lockPath, JSON.stringify({ pid: 4242, hostname: "otherHost", acquiredAt: now() }));
    const lock = acquireStateLock(statePath, { pid: 4242, hostname: "hostA", now });
    assert.equal(lock.ok, false);
    assert.equal(lock.heldBy.hostname, "otherHost");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
