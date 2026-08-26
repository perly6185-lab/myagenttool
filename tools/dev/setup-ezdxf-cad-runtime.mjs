#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runtimeRoot = resolve(repoRoot, ".runtime");
const pointer = resolve(runtimeRoot, "cad-preview-active.json");
let previous = null;
try { previous = JSON.parse(readFileSync(pointer, "utf8")).slot; } catch {}
const slot = previous === "cad-preview-a" ? "cad-preview-b" : "cad-preview-a";
const runtime = resolve(runtimeRoot, slot);
const bootstrap = process.env.MYAGENTTOOL_CAD_BOOTSTRAP_PYTHON || "python3.12";
const python = process.platform === "win32" ? resolve(runtime, "Scripts/python.exe") : resolve(runtime, "bin/python");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit", windowsHide: true });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command} exited with ${result.status}`);
}

rmSync(runtime, { recursive: true, force: true });
try {
  run(bootstrap, ["-c", "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)"]);
  run(bootstrap, ["-m", "venv", runtime]);
  run(python, ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--require-hashes", "--only-binary=:all:", "--requirement", resolve(repoRoot, "tools/dev/cad-runtime-requirements.txt")]);
  run(python, [resolve(repoRoot, "tools/dev/verify-ezdxf-cad-runtime.py")]);
  const installedPython = process.platform === "win32" ? resolve(runtime, "Scripts/python.exe") : resolve(runtime, "bin/python");
  if (!existsSync(installedPython)) throw new Error("managed CAD Python was not created");
  const pendingPointer = `${pointer}.${process.pid}.tmp`;
  writeFileSync(pendingPointer, `${JSON.stringify({ slot, installedAt: new Date().toISOString(), contract: "python3.12-ezdxf1.4.4-pillow12.3.0" })}\n`, { mode: 0o600 });
  renameSync(pendingPointer, pointer);
  console.log(`Managed CAD preview runtime ready: ${installedPython}`);
} catch (error) {
  rmSync(runtime, { recursive: true, force: true });
  console.error(`CAD runtime setup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
