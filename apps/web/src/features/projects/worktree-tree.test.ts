/*
 * #1200: the worktree file tree loads one directory at a time. These cover the
 * two pure pieces that decide WHETHER a fetch happens and WHERE its result
 * lands — the part that was missing when clicking a folder did nothing.
 *
 * The load decision hinges on `children` absent (not read) vs [] (read, empty).
 * Conflating them is the original bug: an unread directory looked empty.
 */
import { describe, expect, it } from "vitest";

import { findNode, withChildren, type TreeNode } from "./worktree-view";

const tree = (): TreeNode[] => [
  { name: "apps", path: "apps", dir: true },
  { name: "docs", path: "docs", dir: true },
  { name: "README.md", path: "README.md", dir: false },
];

describe("findNode", () => {
  it("finds a top-level node", () => {
    expect(findNode(tree(), "apps")?.name).toBe("apps");
  });

  it("finds a node nested under a loaded directory", () => {
    const loaded = withChildren(tree(), "apps", [{ name: "web", path: "apps/web", dir: true }]);
    expect(findNode(loaded, "apps/web")?.name).toBe("web");
  });

  it("returns null for a path that is not present", () => {
    expect(findNode(tree(), "apps/web")).toBeNull();
  });
});

describe("withChildren", () => {
  it("attaches children to the named directory and leaves siblings alone", () => {
    const next = withChildren(tree(), "apps", [{ name: "web", path: "apps/web", dir: true }]);
    expect(findNode(next, "apps")?.children).toHaveLength(1);
    expect(findNode(next, "docs")?.children).toBeUndefined();
  });

  it("attaches to a nested directory without dropping the outer children", () => {
    const once = withChildren(tree(), "apps", [{ name: "web", path: "apps/web", dir: true }]);
    const twice = withChildren(once, "apps/web", [{ name: "src", path: "apps/web/src", dir: true }]);
    expect(findNode(twice, "apps")?.children).toHaveLength(1);
    expect(findNode(twice, "apps/web")?.children).toHaveLength(1);
    expect(findNode(twice, "apps/web/src")?.name).toBe("src");
  });

  it("does not mutate the previous tree (React state must not be shared)", () => {
    const before = tree();
    withChildren(before, "apps", [{ name: "web", path: "apps/web", dir: true }]);
    expect(before[0].children).toBeUndefined();
  });

  // The load decision: `!findNode(tree, path)?.children` triggers a fetch.
  // An empty directory must resolve to [] so it is NOT re-fetched forever.
  it("marks a genuinely empty directory as read, so it is not re-fetched", () => {
    const next = withChildren(tree(), "docs", []);
    const node = findNode(next, "docs");
    expect(node?.children).toEqual([]);
    expect(Boolean(node?.children)).toBe(true); // [] is truthy -> "read"
  });

  it("leaves an unread directory falsy, so the first expand fetches it", () => {
    expect(Boolean(findNode(tree(), "apps")?.children)).toBe(false);
  });
});
