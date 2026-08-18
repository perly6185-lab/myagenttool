import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { materializeTerminal, normalizeTerminal, TerminalRegistry } from "../src/registry.mjs";

const terminal = { id: "studio", name: "Studio", apiUrl: "https://studio.example/api/", consoleUrl: "https://studio.example/", observerTokenEnv: "STUDIO_OBSERVER_TOKEN", operatorTokenEnv: "STUDIO_OPERATOR_TOKEN" };

test("registry persists references but never raw credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "terminal-registry-"));
  const file = join(dir, "registry.json");
  const registry = new TerminalRegistry(file);
  await registry.upsert(terminal);
  const disk = await readFile(file, "utf8");
  assert.match(disk, /STUDIO_OBSERVER_TOKEN/);
  assert.doesNotMatch(disk, /secret-value/);
  // Windows does not expose POSIX owner/group mode bits and reports the
  // writable file as 0666 even when writeFile received mode 0600.
  if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
  const materialized = materializeTerminal(registry.list()[0], { STUDIO_OBSERVER_TOKEN: "secret-value", STUDIO_OPERATOR_TOKEN: "operator-value" });
  assert.equal(materialized.observerToken, "secret-value");
  assert.equal(materialized.operatorToken, "operator-value");
});

test("registry rejects raw tokens, insecure remote HTTP, and URL credentials", () => {
  assert.throws(() => normalizeTerminal({ ...terminal, observerToken: "raw" }), /raw tokens/);
  assert.throws(() => normalizeTerminal({ ...terminal, apiUrl: "http://remote.example/" }), /HTTPS/);
  assert.throws(() => normalizeTerminal({ ...terminal, apiUrl: "https://user:pass@remote.example/" }), /invalid/);
});
