import { existsSync } from "node:fs";

const required = ["run-local-demo.mjs", "local-smoke.mjs", "m0-acceptance.mjs"];
const missing = required.filter((path) => !existsSync(new URL(path, import.meta.url)));

if (missing.length > 0) {
  console.error(`[tools-dev:check] missing files: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("[tools-dev:check] local demo tooling check OK");
