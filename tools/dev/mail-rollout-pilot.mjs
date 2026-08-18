import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { createMailPilot, recordMailPilotDay, summarizeMailPilot } from "./src/mail-rollout-pilot.mjs";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const command = process.argv[2] ?? "status";
const file = path.resolve(option("--file", ".myagenttool/mail-rollout-pilot.json"));

async function readPilot({ allowMissing = false } = {}) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return null;
    if (error?.code === "ENOENT") {
      throw new Error(`mail rollout pilot has not started; run pnpm mail:pilot:start -- --account <non-sensitive-test-account-alias>`);
    }
    throw error;
  }
}

async function savePilot(pilot) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(pilot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

async function main() {
  if (command === "start") {
    if (process.argv.includes("--at")) throw new Error("pilot start time is set by the local clock and cannot be overridden");
    const pilot = createMailPilot({ accountAlias: option("--account"), timeZone: option("--timezone", "Asia/Shanghai") });
    await savePilot(pilot);
    process.stdout.write(`${JSON.stringify({ file, ...summarizeMailPilot(pilot) }, null, 2)}\n`);
  } else if (command === "record") {
    const current = await readPilot();
    const pilot = recordMailPilotDay(current, {
      at: option("--at", new Date().toISOString()),
      phase: option("--phase"),
      scenarios: option("--scenarios", "").split(",").map((item) => item.trim()).filter(Boolean),
      syncRuns: option("--sync-runs", 0), moveBatches: option("--move-batches", 0),
      duplicateMoves: option("--duplicate-moves", 0), crossTenantWrites: option("--cross-tenant-writes", 0),
      unreconciledJobs: option("--unreconciled-jobs", 0), recoveryFailures: option("--recovery-failures", 0),
    });
    await savePilot(pilot);
    process.stdout.write(`${JSON.stringify({ file, ...summarizeMailPilot(pilot) }, null, 2)}\n`);
  } else if (command === "status") {
    const pilot = await readPilot({ allowMissing: true });
    const status = pilot
      ? summarizeMailPilot(pilot)
      : {
          status: "not_started",
          passed: false,
          daysRecorded: 0,
          remainingDays: 7,
          message: "Mail rollout pilot has not started.",
          nextCommand: "pnpm mail:pilot:start -- --account <non-sensitive-test-account-alias>",
        };
    process.stdout.write(`${JSON.stringify({ file, ...status }, null, 2)}\n`);
  } else {
    throw new Error("usage: mail-rollout-pilot.mjs <start|record|status> [--file path] [--account alias] [--phase readonly|manual|automatic] [--scenarios offline,credential_expired,restart,conflict]");
  }
}

main().catch((error) => {
  process.stderr.write(`mail rollout pilot: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
