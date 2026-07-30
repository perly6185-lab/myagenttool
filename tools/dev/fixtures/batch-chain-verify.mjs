import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const controlDir = process.env.MYAGENTTOOL_CHAIN_CONTROL_DIR;
const firstDelayMs = boundedDelay(process.env.MYAGENTTOOL_CHAIN_VERIFY_FIRST_DELAY_MS, 250);
const retryDelayMs = boundedDelay(process.env.MYAGENTTOOL_CHAIN_VERIFY_RETRY_DELAY_MS, 100);
const attempt = nextAttempt();
const recordPath = writeRecord({
  status: "running",
  attempt,
  cwd: process.cwd(),
});

await sleep(attempt === 1 ? firstDelayMs : retryDelayMs);
const evidencePath = path.join(process.cwd(), "CHAIN_RESULT.md");
if (!fs.existsSync(evidencePath)) {
  finishRecord(recordPath, { status: "failed", error: "CHAIN_RESULT.md is missing" });
  console.error("CHAIN_RESULT.md is missing");
  process.exit(2);
}
finishRecord(recordPath, { status: "completed", evidencePath });
console.log(`verified ${evidencePath}`);

function boundedDelay(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(30_000, parsed)) : fallback;
}

function worktreeKey() {
  return createHash("sha256").update(path.resolve(process.cwd())).digest("hex").slice(0, 20);
}

function nextAttempt() {
  if (!controlDir) return 1;
  fs.mkdirSync(controlDir, { recursive: true });
  const attemptPath = path.join(controlDir, `verify-attempt-${worktreeKey()}.txt`);
  let current = 0;
  try {
    current = Number(fs.readFileSync(attemptPath, "utf8")) || 0;
  } catch {
    current = 0;
  }
  const next = current + 1;
  fs.writeFileSync(attemptPath, String(next));
  return next;
}

function writeRecord(data) {
  if (!controlDir) return null;
  fs.mkdirSync(controlDir, { recursive: true });
  const target = path.join(controlDir, `verify-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(target, `${JSON.stringify({
    kind: "verify",
    pid: process.pid,
    parentPid: process.ppid,
    startedAt: new Date().toISOString(),
    ...data,
  }, null, 2)}\n`);
  return target;
}

function finishRecord(target, data) {
  if (!target) return;
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    current = {};
  }
  fs.writeFileSync(target, `${JSON.stringify({
    ...current,
    ...data,
    completedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
