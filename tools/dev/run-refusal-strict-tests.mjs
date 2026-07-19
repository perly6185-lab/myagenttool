#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const pnpm = "pnpm";
const env = { ...process.env, REFUSAL_STRICT: "1" };

for (const script of ["test:unit", "test:integration"]) {
  console.log(`\n> REFUSAL_STRICT=1 pnpm --filter @myagenttool/server ${script}`);
  const result = spawnSync(pnpm, ["--filter", "@myagenttool/server", script], {
    env,
    shell: process.platform === "win32",
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    console.error(`[refusal-strict] failed to start pnpm: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
