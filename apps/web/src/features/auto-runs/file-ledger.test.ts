import { describe, expect, it } from "vitest";

import { reconcileFileLedger, displayPath } from "./file-ledger";

describe("reconcileFileLedger", () => {
  it("cross-checks writes against the diff (absolute write vs repo-relative diff entry)", () => {
    const view = reconcileFileLedger(
      { reads: ["/wt/apps/server/src/x.mjs"], writes: ["/wt/apps/server/src/y.mjs", "/wt/apps/server/src/noop.mjs"] },
      ["apps/server/src/y.mjs", "apps/server/README.md"],
    );
    expect(view.readCount).toBe(1);
    expect(view.writeCount).toBe(2);
    expect(view.writes.find((w) => w.path.endsWith("y.mjs"))?.inDiff).toBe(true);
    expect(view.writes.find((w) => w.path.endsWith("noop.mjs"))?.inDiff).toBe(false);
    expect(view.diffOnly).toEqual(["apps/server/README.md"]);
  });

  it("no diff yet → inDiff null, diffOnly empty (cross-check pending)", () => {
    const view = reconcileFileLedger({ reads: ["/wt/a"], writes: ["/wt/b"], truncated: true }, null);
    expect(view.writes[0]?.inDiff).toBeNull();
    expect(view.diffOnly).toEqual([]);
    expect(view.truncated).toBe(true);
  });

  it("empty/missing ledger → zeroed view; all changed files are diff-only", () => {
    const view = reconcileFileLedger(undefined, ["apps/x"]);
    expect(view.readCount).toBe(0);
    expect(view.writeCount).toBe(0);
    expect(view.diffOnly).toEqual(["apps/x"]);
  });
});

describe("displayPath", () => {
  it("shortens a long absolute path to its tail", () => {
    expect(displayPath("/Users/x/wt-abc/apps/server/src/foo.mjs")).toBe("…/server/src/foo.mjs");
  });
  it("leaves a short path intact", () => {
    expect(displayPath("apps/server/foo.mjs")).toBe("apps/server/foo.mjs");
  });
});
