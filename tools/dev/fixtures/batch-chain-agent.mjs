import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args[0] === "exec" && args.includes("--help")) {
  console.log("Run Codex non-interactively");
  console.log("Usage: codex exec [OPTIONS] [PROMPT]");
  process.exit(0);
}
if (args.includes("--version")) {
  console.log("codex-cli 0.0.0-batch-chain-fixture");
  process.exit(0);
}
if (args[0] === "login" && args[1] === "status") {
  console.log("Logged in with batch-chain fixture credentials");
  process.exit(0);
}

const task = process.argv.at(-1) ?? "Complete the batch-chain task.";
const controlDir = process.env.MYAGENTTOOL_CHAIN_CONTROL_DIR;
const firstDelayMs = boundedDelay(process.env.MYAGENTTOOL_CHAIN_AGENT_FIRST_DELAY_MS, 300);
const retryDelayMs = boundedDelay(process.env.MYAGENTTOOL_CHAIN_AGENT_RETRY_DELAY_MS, 150);
const attempt = nextAttempt("agent");
const recordPath = writeRecord("agent", {
  status: "running",
  attempt,
  cwd: process.cwd(),
  task: String(task).slice(0, 500),
});
let interrupted = false;

process.on("SIGTERM", () => {
  interrupted = true;
  finishRecord(recordPath, { status: "interrupted", signal: "SIGTERM" });
});
process.on("SIGINT", () => {
  interrupted = true;
  finishRecord(recordPath, { status: "interrupted", signal: "SIGINT" });
});

emit({ type: "thread.started", thread_id: `batch_chain_${process.pid}_${attempt}` });
emit({ type: "turn.started" });
await sleep(attempt === 1 ? firstDelayMs : retryDelayMs);
if (interrupted) {
  emit({ type: "turn.failed", error: { message: "Batch-chain fixture interrupted." } });
  process.exit(130);
}

const resultPath = path.join(process.cwd(), "CHAIN_RESULT.md");
fs.writeFileSync(resultPath, [
  "# Batch chain result",
  "",
  `Agent PID: ${process.pid}`,
  `Attempt: ${attempt}`,
  "",
  String(task),
  "",
].join("\n"));
emit({
  type: "item.completed",
  item: {
    id: `batch_chain_file_${process.pid}`,
    type: "file_change",
    path: "CHAIN_RESULT.md",
    action: "created",
    risk: "low",
    summary: "Created deterministic batch-chain evidence.",
    diff: "diff --git a/CHAIN_RESULT.md b/CHAIN_RESULT.md\nnew file mode 100644",
  },
});
emit({
  type: "item.completed",
  item: {
    id: `batch_chain_message_${process.pid}`,
    type: "agent_message",
    text: `Batch-chain fixture completed attempt ${attempt}.`,
  },
});
emit({
  type: "turn.completed",
  usage: {
    input_tokens: 20,
    cached_input_tokens: 0,
    output_tokens: 10,
    reasoning_output_tokens: 0,
  },
});
finishRecord(recordPath, {
  status: "completed",
  resultPath,
});

function boundedDelay(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(30_000, parsed)) : fallback;
}

function keyForCurrentWorktree() {
  return createHash("sha256").update(path.resolve(process.cwd())).digest("hex").slice(0, 20);
}

function nextAttempt(kind) {
  if (!controlDir) return 1;
  fs.mkdirSync(controlDir, { recursive: true });
  const attemptPath = path.join(controlDir, `${kind}-attempt-${keyForCurrentWorktree()}.txt`);
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

function writeRecord(kind, data) {
  if (!controlDir) return null;
  fs.mkdirSync(controlDir, { recursive: true });
  const target = path.join(controlDir, `${kind}-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(target, `${JSON.stringify({
    kind,
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

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
