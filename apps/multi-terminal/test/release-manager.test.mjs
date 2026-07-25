import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);

test("release manager installs, upgrades, and rolls back without mutating persistent data", async () => {
  const temp = await mkdtemp(join(tmpdir(), "multi-release-"));
  const root = join(temp, "install");
  const first = join(temp, "v1");
  const second = join(temp, "v2");
  await mkdir(first); await mkdir(second); await mkdir(join(root, "data"), { recursive: true });
  await writeFile(join(first, "version.txt"), "v1");
  await writeFile(join(second, "version.txt"), "v2");
  await writeFile(join(first, "package.json"), "{\"version\":\"1.0.0\"}");
  await writeFile(join(second, "package.json"), "{\"version\":\"1.1.0\"}");
  await writeFile(join(root, "data", "registry.json"), "persistent");
  const script = fileURLToPath(new URL("../scripts/release-manager.mjs", import.meta.url));
  await exec(process.execPath, [script, "install", first, root, "1.0.0"]);
  await exec(process.execPath, [script, "install", second, root, "1.1.0"]);
  let state = JSON.parse(await readFile(join(root, "release-state.json"), "utf8"));
  assert.deepEqual({ current: state.current, previous: state.previous }, { current: "1.1.0", previous: "1.0.0" });
  assert.match(state.integrity, /^sha256-[a-f0-9]{64}$/);
  await exec(process.execPath, [script, "rollback", "_", root]);
  state = JSON.parse(await readFile(join(root, "release-state.json"), "utf8"));
  assert.equal(state.current, "1.0.0");
  assert.equal(await readFile(join(root, "data", "registry.json"), "utf8"), "persistent");
});
