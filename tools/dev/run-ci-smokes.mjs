import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const policy = JSON.parse(fs.readFileSync(path.join(root, "tools/dev/smoke-policy.json"), "utf8"));
const pnpmEntry = process.env.npm_execpath;
if (!pnpmEntry) throw new Error("pnpm entrypoint is unavailable; run this command through pnpm");

for (const script of policy.ciGating) {
  console.log(`\n> ${script}`);
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [pnpmEntry, script], {
      cwd: root,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) process.exit(exitCode);
}
