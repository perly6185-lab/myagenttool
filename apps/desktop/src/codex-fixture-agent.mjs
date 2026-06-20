const args = process.argv.slice(2);

if (args[0] === "exec" && args.includes("--help")) {
  console.log("Run Codex non-interactively");
  console.log("Usage: codex exec [OPTIONS] [PROMPT]");
  process.exit(0);
}

const task = args[args.length - 1] ?? "Summarize repository readiness.";
let cancelled = false;

process.on("SIGTERM", () => {
  cancelled = true;
});

console.log(JSON.stringify({
  type: "thread.started",
  thread_id: "codex_fixture_thread"
}));
console.log(JSON.stringify({ type: "turn.started" }));

for (let step = 1; step <= 8; step += 1) {
  if (cancelled) {
    console.log(JSON.stringify({
      type: "turn.failed",
      error: { message: "Codex fixture cancelled." }
    }));
    process.exit(130);
  }
  console.log(JSON.stringify({
    type: "item.completed",
    item: {
      id: `fixture_log_${step}`,
      type: "agent_message",
      text: `Codex fixture step ${step}: ${task}`
    }
  }));
  await sleep(150);
}

console.log(JSON.stringify({
  type: "item.completed",
  item: {
    id: "fixture_final",
    type: "agent_message",
    text: `Codex fixture completed read-only task: ${task}`
  }
}));
console.log(JSON.stringify({
  type: "turn.completed",
  usage: {
    input_tokens: 100,
    cached_input_tokens: 0,
    output_tokens: 40,
    reasoning_output_tokens: 0
  }
}));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
