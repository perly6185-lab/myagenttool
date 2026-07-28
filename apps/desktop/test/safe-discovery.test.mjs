import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withGitSafeDirectoryEnv, withSafeDiscoveryEnv } from "../src/safe-discovery.mjs";

test("withGitSafeDirectoryEnv trusts only the governed root without mutating global config", () => {
  const root = resolve("fixture-worktree");
  const env = {
    PATH: "fixture-path",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.autocrlf",
    GIT_CONFIG_VALUE_0: "false",
  };

  const result = withGitSafeDirectoryEnv(env, { root });

  assert.equal(env.GIT_CONFIG_COUNT, "1");
  assert.equal(result.GIT_CONFIG_COUNT, "2");
  assert.equal(result.GIT_CONFIG_KEY_0, "core.autocrlf");
  assert.equal(result.GIT_CONFIG_VALUE_0, "false");
  assert.equal(result.GIT_CONFIG_KEY_1, "safe.directory");
  assert.equal(result.GIT_CONFIG_VALUE_1, root);
});

test("withGitSafeDirectoryEnv rejects ambiguous roots and config counts", () => {
  assert.throws(
    () => withGitSafeDirectoryEnv({}, { root: "relative-worktree" }),
    /root must be an absolute path/,
  );
  assert.throws(
    () => withGitSafeDirectoryEnv({ GIT_CONFIG_COUNT: "invalid" }, { root: resolve("fixture") }),
    /GIT_CONFIG_COUNT must be a non-negative integer/,
  );
});

test("withSafeDiscoveryEnv injects absolute discovery paths without mutating the input", () => {
  const env = { PATH: "fixture-path" };
  const root = resolve("fixture-worktree");
  const configPath = fileURLToPath(new URL("../src/safe-ripgrep.conf", import.meta.url));

  const result = withSafeDiscoveryEnv(env, { root, configPath });

  assert.deepEqual(env, { PATH: "fixture-path" });
  assert.equal(result.PATH, "fixture-path");
  assert.equal(result.MYAGENTTOOL_DISCOVERY_ROOT, root);
  assert.equal(result.RIPGREP_CONFIG_PATH, configPath);
});

test("withSafeDiscoveryEnv rejects relative discovery paths", () => {
  const absolute = resolve("fixture");
  assert.throws(
    () => withSafeDiscoveryEnv({}, { root: "relative-worktree", configPath: absolute }),
    /root must be an absolute path/,
  );
  assert.throws(
    () => withSafeDiscoveryEnv({}, { root: absolute, configPath: "safe-ripgrep.conf" }),
    /configPath must be an absolute path/,
  );
});

test("safe ripgrep config excludes generated trees and limits large files", async () => {
  const configPath = fileURLToPath(new URL("../src/safe-ripgrep.conf", import.meta.url));
  const config = await readFile(configPath, "utf8");

  for (const directory of [
    "node_modules",
    "dist",
    "coverage",
    "build",
    "out",
    ".cache",
    ".codex-run",
  ]) {
    assert.match(config, new RegExp(`--glob=!\\*\\*/${directory.replace(".", "\\.")}/\\*\\*`));
  }
  assert.match(config, /--glob=!apps\/electron\/release\/\*\*/);
  assert.match(config, /--max-filesize=\d+[KMG]/);
});
