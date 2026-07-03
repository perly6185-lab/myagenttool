import { describe, expect, it } from "vitest";
import { selectSessions } from "@/features/invocations/session-history";
import type { InvocationSnapshot } from "@/lib/console-state";

const rows: InvocationSnapshot[] = [
  { id: "a", projectId: "p1", worktreeId: "w1", createdAt: "2026-07-03T00:00:01Z" },
  { id: "b", projectId: "p1", worktreeId: null, createdAt: "2026-07-03T00:00:03Z" },
  { id: "c", projectId: "p2", worktreeId: null, createdAt: "2026-07-03T00:00:02Z" },
];

describe("selectSessions", () => {
  it("scopes to the current project and orders newest-first", () => {
    const out = selectSessions(rows, { scope: "project", currentProjectId: "p1", worktreeId: null, worktreeOnly: false });
    expect(out.map((r) => r.id)).toEqual(["b", "a"]); // p1 only, newest (b) first
  });

  it("returns all projects when scope is 'all'", () => {
    const out = selectSessions(rows, { scope: "all", currentProjectId: "p1", worktreeId: null, worktreeOnly: false });
    expect(out.map((r) => r.id)).toEqual(["b", "c", "a"]); // newest → oldest across projects
  });

  it("filters to a worktree when worktreeOnly is set", () => {
    const out = selectSessions(rows, { scope: "project", currentProjectId: "p1", worktreeId: "w1", worktreeOnly: true });
    expect(out.map((r) => r.id)).toEqual(["a"]);
  });

  it("caps the list at 50", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `x${i}`, projectId: "p1", createdAt: `2026-07-03T00:00:${String(i).padStart(2, "0")}Z` }));
    expect(selectSessions(many, { scope: "project", currentProjectId: "p1", worktreeId: null, worktreeOnly: false })).toHaveLength(50);
  });
});
