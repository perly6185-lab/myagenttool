import { cp, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

const [command, sourceArg, destinationArg] = process.argv.slice(2);
if (!["backup", "restore"].includes(command) || !sourceArg || !destinationArg) {
  console.error("Usage: node scripts/data-manager.mjs backup <data> <backup> | restore <backup> <data>");
  process.exit(2);
}
const source = resolve(sourceArg);
const destination = resolve(destinationArg);
if (source === destination || source === "/" || destination === "/") throw new Error("unsafe data path");
await lstat(source);
const temporary = `${destination}.${process.pid}.tmp`;
await rm(temporary, { recursive: true, force: true });
await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
await cp(source, temporary, { recursive: true });
const manifest = JSON.stringify({ command, createdAt: new Date().toISOString(), sourceHash: createHash("sha256").update(await inventory(temporary)).digest("hex") });
await writeFile(`${temporary}.manifest`, `${manifest}\n`, { mode: 0o600 });
await rm(destination, { recursive: true, force: true });
await rename(temporary, destination);
await rename(`${temporary}.manifest`, `${destination}.manifest`);
console.log(manifest);

async function inventory(root) {
  const stat = await lstat(root);
  if (stat.isFile()) return readFile(root);
  const { readdir } = await import("node:fs/promises");
  const names = (await readdir(root)).sort();
  return Buffer.from((await Promise.all(names.map(async (name) => `${name}:${(await inventory(`${root}/${name}`)).toString("base64")}`))).join("\n"));
}
