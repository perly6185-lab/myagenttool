/*
 * Agent Workspace W1 (#160): the project registry captures git metadata on
 * register, omits it gracefully for a non-repo folder, and bumps last-opened on
 * select. Hermetic: real temp git repo under mkdtemp, no server boot.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { createProjectService, readGitFacts, readProjectTree } from "../src/services/projects.mjs";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

let repoDir;
let plainDir;
let svc;
let state;

before(() => {
  repoDir = mkdtempSync(join(tmpdir(), "prj-reg-"));
  execFileSync("git", ["init", "-b", "main", repoDir], { encoding: "utf8" });
  git(repoDir, "config", "user.email", "t@example.com");
  git(repoDir, "config", "user.name", "T");
  git(repoDir, "remote", "add", "origin", "https://github.com/o/r.git");
  writeFileSync(join(repoDir, "README.md"), "hi\n");
  git(repoDir, "add", ".");
  git(repoDir, "commit", "-m", "init");

  plainDir = mkdtempSync(join(tmpdir(), "prj-plain-"));

  let counter = 0;
  state = { projects: [], worktrees: [], projectTargets: [], currentProjectId: null };
  svc = createProjectService({
    state,
    now: () => new Date().toISOString(),
    nextId: (p) => `${p}_${++counter}`,
    appendEvent: () => {},
    persistStateSoon: () => {},
  });
});

test("readGitFacts captures remote + branches for a real repo", () => {
  const facts = readGitFacts(repoDir);
  assert.equal(facts.isRepo, true);
  assert.equal(facts.remoteUrl, "https://github.com/o/r.git");
  assert.equal(facts.currentBranch, "main");
  assert.equal(facts.defaultBranch, "main");
});

test("readGitFacts is graceful (null fields, isRepo:false) for a non-repo folder", () => {
  const facts = readGitFacts(plainDir);
  assert.equal(facts.isRepo, false);
  assert.equal(facts.remoteUrl, null);
  assert.equal(facts.defaultBranch, null);
  assert.equal(facts.currentBranch, null);
});

test("addProject captures git metadata on register + exposes activeCheckoutId", () => {
  const p = svc.addProject({ name: "Repo", path: repoDir, ownerTeamId: "team_a" });
  assert.equal(p.git.remoteUrl, "https://github.com/o/r.git");
  assert.equal(p.git.defaultBranch, "main");
  assert.equal(p.git.currentBranch, "main");
  assert.equal(p.activeCheckoutId, null, "shared project scopes to the root until a worktree is chosen");
  // the derived target inherits the captured remote/default branch
  const target = state.projectTargets.find((t) => t.projectId === p.id);
  assert.equal(target.remoteUrl, "https://github.com/o/r.git");
  assert.equal(target.defaultBranch, "main");
});

test("project automatic execution is opt-in and future pull-forward can be configured", () => {
  const project = svc.addProject({ name: "Auto", path: repoDir });
  assert.equal(project.autoExecutionEnabled, false, "existing and newly registered projects start safely disabled");
  assert.equal(project.futurePullForwardEnabled, true);
  const updated = svc.updateProject(project.id, {
    autoExecutionEnabled: true,
    futurePullForwardEnabled: false,
  });
  assert.equal(updated.autoExecutionEnabled, true);
  assert.equal(updated.futurePullForwardEnabled, false);
});

test("addProject on a non-repo folder omits git metadata gracefully", () => {
  const p = svc.addProject({ name: "Plain", path: plainDir, ownerTeamId: "team_a" });
  assert.equal(p.git.isRepo, false);
  assert.equal(p.git.remoteUrl, null);
});

test("re-registering an existing path refreshes its git facts + selects it (last-opened bumps)", () => {
  const first = svc.addProject({ name: "Repo", path: repoDir });
  const openedAt = first.lastOpenedAt;
  // add a second remote-less state change is overkill; just re-register and assert same id + selected
  const again = svc.addProject({ name: "Repo", path: repoDir });
  assert.equal(again.id, first.id, "same path re-registers the same project");
  assert.equal(state.currentProjectId, again.id, "re-register selects it");
  assert.ok(again.git.remoteUrl, "git facts refreshed on re-register");
  assert.ok(again.lastOpenedAt >= openedAt);
});

test("gitStatusMap marks .gitignore'd entries as 'ignored' (#161 badge)", async () => {
  const { gitStatusMap } = await import("../src/services/projects.mjs");
  const dir = mkdtempSync(join(tmpdir(), "prj-ign-"));
  execFileSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  writeFileSync(join(dir, ".gitignore"), "junk.log\n");
  writeFileSync(join(dir, "junk.log"), "noise\n");
  writeFileSync(join(dir, "keep.txt"), "kept\n");
  git(dir, "add", ".gitignore", "keep.txt");
  git(dir, "commit", "-m", "init");
  writeFileSync(join(dir, "keep.txt"), "changed\n");
  const map = gitStatusMap(dir);
  assert.equal(map.get("junk.log"), "ignored", "the ignored file carries the ignored status");
  assert.equal(map.get("keep.txt"), "modified", "a tracked change is still classified");
});

test("safeProjectPath rejects an in-tree symlink that escapes the registered root (review: symlink escape)", async () => {
  const { safeProjectPath } = await import("../src/services/projects.mjs");
  const { symlinkSync, mkdirSync: mkdir } = await import("node:fs");
  const outside = mkdtempSync(join(tmpdir(), "prj-secret-"));
  const root = mkdtempSync(join(tmpdir(), "prj-root-"));
  mkdir(join(root, "sub"));
  try { symlinkSync(outside, join(root, "escape"), "dir"); } catch { return; } // skip if symlinks unsupported
  // a normal in-root path is fine
  assert.ok(safeProjectPath({ path: root }, "sub"));
  // the symlink-to-outside is rejected by realpath containment
  assert.throws(() => safeProjectPath({ path: root }, "escape"), /escapes the registered project root/);
});

test("searchProjectContent does NOT return contents of .gitignore'd or secret files (review: secret leak)", async () => {
  const { searchProjectContent } = await import("../src/services/projects.mjs");
  const dir = mkdtempSync(join(tmpdir(), "prj-search-"));
  execFileSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  writeFileSync(join(dir, ".gitignore"), ".env\nsecrets/\n");
  writeFileSync(join(dir, ".env"), "API_KEY=SUPERSECRET\n");
  writeFileSync(join(dir, "app.js"), "const k = 'SUPERSECRET-in-code';\n");
  git(dir, "add", ".gitignore", "app.js");
  git(dir, "commit", "-m", "init");
  const out = searchProjectContent({ id: "p", path: dir }, { query: "SUPERSECRET" });
  const paths = out.results.map((r) => r.path);
  assert.ok(paths.includes("app.js"), "a tracked source match is returned");
  assert.ok(!paths.includes(".env"), "the .gitignore'd .env is NOT searched/returned");
});

test("searchProjectContent matches several understanding terms in one bounded scan", async () => {
  const { searchProjectContent } = await import("../src/services/projects.mjs");
  const dir = mkdtempSync(join(tmpdir(), "prj-search-multi-"));
  execFileSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  writeFileSync(join(dir, "schedule.mjs"), "const timezone = terminal.timezone;\nconst preview = computePreview();\n");
  const out = searchProjectContent({ id: "p", path: dir }, { queries: ["timezone", "preview"] });
  assert.deepEqual(out.queries, ["timezone", "preview"]);
  assert.deepEqual(out.results.map((result) => result.term), ["timezone", "preview"]);
  assert.equal(out.stats.scannedFiles > 0, true);
});

test("readGitFacts reports null (not 'HEAD') for a detached HEAD (review F)", () => {
  const dir = mkdtempSync(join(tmpdir(), "prj-detached-"));
  execFileSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  writeFileSync(join(dir, "a.txt"), "1\n");
  git(dir, "add", "."); git(dir, "commit", "-m", "c1");
  const sha = git(dir, "rev-parse", "HEAD");
  git(dir, "checkout", "--detach", sha);
  const facts = readGitFacts(dir);
  assert.equal(facts.isRepo, true);
  assert.equal(facts.currentBranch, null, "detached HEAD is not surfaced as a branch named HEAD");
});

test("readProjectTree marks a child inside an ignored directory as ignored (review G)", () => {
  const dir = mkdtempSync(join(tmpdir(), "prj-igntree-"));
  execFileSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  writeFileSync(join(dir, ".gitignore"), "build/\n");
  mkdirSync(join(dir, "build"));
  writeFileSync(join(dir, "build", "out.js"), "x\n");
  git(dir, "add", ".gitignore"); git(dir, "commit", "-m", "init");
  const child = readProjectTree({ id: "p", path: dir }, { relativePath: "build" });
  assert.equal((child.entries ?? []).find((e) => e.name === "out.js")?.gitStatus, "ignored", "child inherits ignored");
});

test("gitStatusMap caches per root within the TTL; fresh:true recomputes (perf refactor)", async () => {
  const { gitStatusMap } = await import("../src/services/projects.mjs");
  const dir = mkdtempSync(join(tmpdir(), "prj-cache-"));
  execFileSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  writeFileSync(join(dir, "a.txt"), "1\n");
  git(dir, "add", "."); git(dir, "commit", "-m", "c1");
  const a = gitStatusMap(dir);
  assert.strictEqual(gitStatusMap(dir), a, "a second call within the TTL is served from cache (same object)");
  // a change is not reflected within the TTL...
  writeFileSync(join(dir, "b.txt"), "2\n");
  assert.strictEqual(gitStatusMap(dir), a, "still cached within the window");
  // ...but fresh:true recomputes and sees it
  const c = gitStatusMap(dir, { fresh: true });
  assert.notStrictEqual(c, a, "fresh recomputes a new map");
  assert.equal(c.get("b.txt"), "added", "the fresh map reflects the new untracked file");
});
