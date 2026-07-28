import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";

const [command, sourceArg, rootArg, versionArg] = process.argv.slice(2);
if (!["install", "rollback"].includes(command) || !rootArg) {
  console.error("Usage: node scripts/release-manager.mjs install <source> <root> <version> | rollback _ <root>");
  process.exit(2);
}

const root = resolve(rootArg);
const releases = join(root, "releases");
const manifestPath = join(root, "release-state.json");
await mkdir(releases, { recursive: true, mode: 0o700 });

if (command === "install") {
  const source = resolve(sourceArg);
  const version = safeVersion(versionArg || basename(source));
  const destination = join(releases, version);
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true, filter: (path) => !path.includes("node_modules") && !path.includes(`${basename(root)}/`) });
  const packageBytes = await readFile(join(destination, "package.json"));
  const integrity = `sha256-${createHash("sha256").update(packageBytes).digest("hex")}`;
  const prior = await state().catch(() => ({ current: null, previous: null }));
  await persist({ current: version, previous: prior.current, integrity, updatedAt: new Date().toISOString() });
  console.log(JSON.stringify({ installed: version, previous: prior.current, integrity, path: destination }));
} else {
  const current = await state();
  if (!current.previous) throw new Error("no previous release available");
  await persist({ current: current.previous, previous: current.current, updatedAt: new Date().toISOString() });
  console.log(JSON.stringify({ rolledBackTo: current.previous, previous: current.current }));
}

async function state() {
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

async function persist(value) {
  const temporary = `${manifestPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, manifestPath);
}

function safeVersion(value) {
  const version = String(value ?? "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(version)) throw new Error("invalid release version");
  return version;
}
