import assert from "node:assert/strict";
import { test } from "node:test";
import { delimiter, join } from "node:path";
import { bundledAgentEnv } from "../src/bundled-agent-runtime.mjs";

test("uses system agent CLIs when both are already available", () => {
  const env = { PATH: "C:\\tools", PATHEXT: ".EXE;.CMD" };
  const patch = bundledAgentEnv({ appRoot: "C:\\app", execPath: "C:\\app\\MyAgentTool.exe", env, platform: "win32", exists: (path) => path.endsWith("codex.CMD") || path.endsWith("claude.EXE") });
  assert.deepEqual(patch, {});
});

test("uses packaged Codex, Claude, and PortableGit when system commands are absent", () => {
  const appRoot = "C:\\app";
  const execPath = join(appRoot, "MyAgentTool.exe");
  const codex = join(appRoot, "node_modules", "@openai", "codex", "bin", "codex.js");
  const claude = join(appRoot, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
  const bash = join(appRoot, "portable-git", "bin", "bash.exe");
  const git = join(appRoot, "portable-git", "cmd", "git.exe");
  const packaged = new Set([codex, claude, bash, git]);
  const patch = bundledAgentEnv({ appRoot, execPath, env: { PATH: "" }, platform: "win32", exists: (path) => packaged.has(path) });
  assert.deepEqual(JSON.parse(patch.MYAGENTTOOL_CODEX_COMMAND_JSON), [execPath, codex]);
  assert.equal(patch.MYAGENTTOOL_CLAUDE_COMMAND, claude);
  assert.equal(patch.MYAGENTTOOL_GIT_BASH_COMMAND, bash);
  assert.equal(patch.MYAGENTTOOL_GIT_COMMAND, git);
  assert.equal(patch.PATH, `${join(appRoot, "portable-git", "cmd")}${delimiter}${join(appRoot, "portable-git", "bin")}`);
});
