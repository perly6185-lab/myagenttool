import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { materializeTerminal, normalizeTerminal, TerminalRegistry } from "../src/registry.mjs";

const terminal = { id: "studio", name: "Studio", apiUrl: "https://studio.example/api/", consoleUrl: "https://studio.example/", observerTokenEnv: "STUDIO_OBSERVER_TOKEN" };

test("registry persists references but never raw credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "terminal-registry-"));
  const file = join(dir, "registry.json");
  const registry = new TerminalRegistry(file);
  await registry.upsert(terminal);
  const disk = await readFile(file, "utf8");
  assert.match(disk, /STUDIO_OBSERVER_TOKEN/);
  assert.doesNotMatch(disk, /secret-value/);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(materializeTerminal(registry.list()[0], { STUDIO_OBSERVER_TOKEN: "secret-value" }).observerToken, "secret-value");
});

test("registry rejects raw tokens, insecure remote HTTP, and URL credentials", () => {
  assert.throws(() => normalizeTerminal({ ...terminal, observerToken: "raw" }), /raw observer/);
  assert.throws(() => normalizeTerminal({ ...terminal, apiUrl: "http://remote.example/" }), /HTTPS/);
  assert.throws(() => normalizeTerminal({ ...terminal, apiUrl: "https://user:pass@remote.example/" }), /invalid/);
});
