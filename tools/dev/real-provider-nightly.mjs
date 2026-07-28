import { spawnSync } from "node:child_process";

const providers = [
  { name: "codex", command: process.env.MYAGENTTOOL_CODEX_COMMAND ?? "codex" },
  { name: "claude", command: process.env.MYAGENTTOOL_CLAUDE_COMMAND ?? "claude" },
];
const results = providers.map(({ name, command }) => {
  const run = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 15_000, env: process.env });
  return { name, available: run.status === 0, status: run.status, signal: run.signal ?? null };
});
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), providers: results }));
if (!results.some((row) => row.available)) {
  console.error("No real CLI provider is available on this runner.");
  process.exitCode = 1;
}
