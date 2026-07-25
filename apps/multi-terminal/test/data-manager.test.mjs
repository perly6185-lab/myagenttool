import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
test("persistent data backs up and restores with an integrity manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "multi-data-"));
  const data = join(root, "data"); const backup = join(root, "backup"); const restored = join(root, "restored");
  await mkdir(data); await writeFile(join(data, "registry.json"), "persistent");
  const script = fileURLToPath(new URL("../scripts/data-manager.mjs", import.meta.url));
  await exec(process.execPath, [script, "backup", data, backup]);
  await exec(process.execPath, [script, "restore", backup, restored]);
  assert.equal(await readFile(join(restored, "registry.json"), "utf8"), "persistent");
  assert.match(await readFile(`${backup}.manifest`, "utf8"), /sourceHash/);
});
