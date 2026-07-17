/*
 * #1213: what the Projects list says about where a project pushes.
 *
 * A `file://` remote IS a local repo — the URL scheme decides it, not a flag the
 * server carries and not a guess about who created the repo. These pin that, and
 * the case the whole local-repo feature exists for: a repo with no origin, which
 * today only announces itself when a publish fails.
 */
import { describe, expect, it } from "vitest";

import { originOf } from "./projects-view";
import type { ProjectSnapshot } from "@/lib/console-state";

const project = (git?: ProjectSnapshot["git"]): ProjectSnapshot => ({
  id: "prj_1",
  name: "demo",
  color: "#fff",
  ownerTeamId: "team_1",
  budgetPoolId: null,
  defaultAgentId: null,
  status: "active",
  isolation: "shared",
  createdAt: "2026-07-17T00:00:00.000Z",
  git,
});

const facts = (over: Partial<NonNullable<ProjectSnapshot["git"]>>) => ({
  repoPath: "/repo",
  remoteUrl: null,
  defaultBranch: "main",
  currentBranch: "main",
  isRepo: true,
  ...over,
});

describe("originOf", () => {
  it("a repo with no remote has nowhere to publish — the case the action exists for", () => {
    expect(originOf(project(facts({ remoteUrl: null })))).toBe("none");
  });

  it("a file:// remote is a local repo", () => {
    expect(originOf(project(facts({ remoteUrl: "file:///C:/data/repos/prj_1.git" })))).toBe("local");
  });

  it("an https remote is a remote repo", () => {
    expect(originOf(project(facts({ remoteUrl: "https://github.com/o/r.git" })))).toBe("remote");
  });

  it("an ssh remote is a remote repo (not local just because it is not https)", () => {
    expect(originOf(project(facts({ remoteUrl: "git@github.com:o/r.git" })))).toBe("remote");
  });

  it("a non-repo project is not offered a local repo — there is nothing to publish", () => {
    expect(originOf(project(facts({ isRepo: false })))).toBe("not-a-repo");
  });

  it("a project with no git facts at all is treated as not-a-repo, not as 'no origin'", () => {
    // Absent facts must not render the amber "nowhere to publish" warning on a
    // project that was never a repo — that would be a false alarm.
    expect(originOf(project(undefined))).toBe("not-a-repo");
  });
});
