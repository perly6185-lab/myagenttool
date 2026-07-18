import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const policy = JSON.parse(fs.readFileSync(path.join(root, "tools/dev/smoke-policy.json"), "utf8"));
const errors = [];

const smokeScripts = Object.keys(packageJson.scripts).filter(
  (name) => name.startsWith("smoke:") && name !== "smoke:ci",
);
const manualEntries = policy.manual.flatMap((group) =>
  group.scripts.map((script) => ({ script, reason: group.reason })),
);
const classified = [...policy.ciGating, ...manualEntries.map(({ script }) => script)];

for (const script of smokeScripts) {
  const count = classified.filter((candidate) => candidate === script).length;
  if (count !== 1) errors.push(`${script} must be classified exactly once (found ${count})`);
}
for (const script of classified) {
  if (!smokeScripts.includes(script)) errors.push(`policy references missing script ${script}`);
}
for (const group of policy.manual) {
  if (!group.reason?.trim()) errors.push(`manual group ${group.scripts.join(", ")} has no reason`);
}

const referencedSmokeFiles = new Set(
  smokeScripts.flatMap((script) =>
    [...packageJson.scripts[script].matchAll(/tools\/dev\/([^\s&]+-smoke\.mjs)/g)].map(
      ([, file]) => file,
    ),
  ),
);
const smokeFiles = fs
  .readdirSync(path.join(root, "tools/dev"))
  .filter((file) => file.endsWith("-smoke.mjs"));
for (const file of smokeFiles) {
  if (!referencedSmokeFiles.has(file)) errors.push(`tools/dev/${file} has no smoke:* package script`);
}

if (errors.length > 0) {
  console.error("Smoke policy check failed:\n" + errors.map((error) => `  - ${error}`).join("\n"));
  process.exit(1);
}

console.log(
  `Smoke policy OK (${policy.ciGating.length} CI-gating, ${manualEntries.length} manual)`,
);
