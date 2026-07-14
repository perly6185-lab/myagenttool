import { hostname as osHostname } from "node:os";
import { dirname } from "node:path";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";

/*
 * #890 single-writer lock. The state snapshot is one JSON file rewritten wholesale
 * on every debounce; two server processes pointed at the same file silently
 * last-write-wins clobber each other (no OS advisory lock, no O_EXCL anywhere).
 * This is an exclusive lockfile next to the snapshot: a second live process on the
 * same host refuses to start instead of corrupting the first's state. A stale lock
 * (the previous owner crashed, its pid is dead) is reclaimed so an ordinary
 * restart is never blocked.
 */

// Whether a pid is a live process on THIS host. `kill(pid, 0)` sends no signal; it
// throws ESRCH when the process is gone, EPERM when it exists but we can't signal
// it (still alive → still a conflict).
function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM"; // exists but not signalable
  }
}

function readLock(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return null; // missing or unparseable → treat as reclaimable
  }
}

function writeLock(lockPath, payload) {
  const fd = openSync(lockPath, "wx"); // O_CREAT | O_EXCL — fails if it already exists
  try {
    writeSync(fd, JSON.stringify(payload));
  } finally {
    closeSync(fd);
  }
}

/**
 * Try to acquire the single-writer lock for `stateStorePath`.
 *
 * Returns `{ ok: true, lockPath, release() }` on success (a fresh lock, a
 * reclaimed stale one, or one we already held). Returns `{ ok: false, heldBy }`
 * when a DIFFERENT live process on this host owns it — the caller should refuse to
 * start. `release()` removes the lock only if we still own it (best-effort).
 *
 * Injectables (`pid`/`hostname`/`now`) exist for hermetic tests.
 */
export function acquireStateLock(
  stateStorePath,
  { pid = process.pid, hostname = osHostname(), now = () => new Date().toISOString() } = {},
) {
  const lockPath = `${stateStorePath}.lock`;
  const payload = { pid, hostname, acquiredAt: now() };
  const release = () => {
    // Only remove a lock we still own — never delete another live process's lock.
    const current = readLock(lockPath);
    if (current && current.pid === pid && current.hostname === hostname) {
      try {
        unlinkSync(lockPath);
      } catch {
        /* already gone */
      }
    }
  };

  try {
    mkdirSync(dirname(lockPath), { recursive: true });
  } catch {
    /* dir may already exist; write will surface a real problem */
  }

  const tryWrite = () => {
    try {
      writeLock(lockPath, payload);
      return { ok: true, lockPath, release };
    } catch (error) {
      if (error?.code === "EEXIST") return null; // contended — resolve below
      // Any other fs error (permissions, exotic filesystem): don't wedge the
      // control plane over a lock. Proceed WITHOUT a lock, loudly.
      console.error(`[server] could not create state lock (${error?.code ?? error?.message}); continuing without single-writer protection.`);
      return { ok: true, lockPath: null, release: () => {} };
    }
  };

  const first = tryWrite();
  if (first) return first;

  // The lock exists. Decide whether it is a live conflict or a reclaimable stale.
  const held = readLock(lockPath);
  const sameHost = held?.hostname === hostname;
  const ownPid = held?.pid === pid && sameHost;
  const staleSameHost = sameHost && !pidIsAlive(held?.pid);

  if (ownPid || staleSameHost || !held) {
    // Ours already, a dead owner, or an unreadable lock → reclaim it.
    try {
      unlinkSync(lockPath);
    } catch {
      /* someone else just removed it */
    }
    const second = tryWrite();
    if (second) return second;
    // Lost a race to reclaim → re-read to report who holds it now.
    return { ok: false, heldBy: readLock(lockPath) ?? held ?? null };
  }

  // A live process on this host, or a lock from another host we cannot verify:
  // refuse rather than risk clobbering another writer's state.
  return { ok: false, heldBy: held };
}
