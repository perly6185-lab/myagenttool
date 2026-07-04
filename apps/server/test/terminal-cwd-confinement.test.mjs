/*
 * WS3 bridge-trust deepening: a local managed terminal (an interactive shell —
 * the broadest execution surface on the bridge) must not be opened at an
 * arbitrary path. A CLIENT-SUPPLIED cwd is confined to a registered project or
 * worktree root; the default (the bridge's own working directory) is trusted.
 * Remote SSH-relay terminals run on the remote target and are out of scope.
 */

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  approvedLocalTerminalRoots,
  createTerminalRuntimeCapability,
  createTerminalService,
  terminalCwdWithinRoots,
} from "../src/services/terminal.mjs";

test("approvedLocalTerminalRoots collects project + worktree roots, resolved and deduped", () => {
  const roots = approvedLocalTerminalRoots({
    projects: [{ path: "/approved/project" }, { path: "/approved/project" }],
    worktrees: [{ path: "/approved/worktree" }, { worktreePath: "/approved/wt2" }],
  });
  assert.deepEqual(
    roots.sort(),
    [resolve("/approved/project"), resolve("/approved/worktree"), resolve("/approved/wt2")].sort(),
  );
});

test("terminalCwdWithinRoots: inside/equal true, outside and sibling-prefix false", () => {
  const roots = ["/approved/project"];
  assert.equal(terminalCwdWithinRoots("/approved/project", roots), true, "the root itself");
  assert.equal(terminalCwdWithinRoots("/approved/project/sub/dir", roots), true, "a nested dir");
  assert.equal(terminalCwdWithinRoots("/etc", roots), false, "outside");
  assert.equal(terminalCwdWithinRoots("/approved/project-evil", roots), false, "sibling prefix is not containment");
});

function terminalService() {
  const state = {
    device: { id: "dev_1" },
    projects: [{ id: "prj_1", path: "/approved/project" }],
    worktrees: [{ id: "wtr_1", path: "/approved/worktree" }],
    terminalSessions: [],
    terminalBridgeActions: [],
    terminalEvidenceRecords: [],
    codexSessions: [],
    terminalRuntimeCapability: createTerminalRuntimeCapability(),
  };
  let n = 0;
  const svc = createTerminalService({
    state,
    now: () => "2026-07-04T00:00:00.000Z",
    nextId: (p) => `${p}_${++n}`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    summarizeText: (text) => String(text).slice(0, 80),
    uniqueStrings: (arr) => [...new Set(arr)],
    codexSessionForInvocation: () => null,
  });
  return { state, svc };
}

test("createManagedTerminalSession: a client cwd outside every approved root is refused", () => {
  const { svc } = terminalService();
  assert.throws(
    () => svc.createManagedTerminalSession({ cwd: "/etc" }),
    /must be inside a registered project or worktree root/,
  );
});

test("createManagedTerminalSession: a cwd inside an approved root passes the confinement check", () => {
  // The full session build touches many runtime arrays; here we only assert the
  // confinement gate does NOT reject a valid in-root cwd (the accept path — the
  // containment decision itself is covered by the helper tests above).
  const { svc } = terminalService();
  let error = null;
  try {
    svc.createManagedTerminalSession({ cwd: "/approved/worktree/feature" });
  } catch (caught) {
    error = caught;
  }
  assert.doesNotMatch(String(error?.message ?? ""), /must be inside a registered project or worktree root/);
});
