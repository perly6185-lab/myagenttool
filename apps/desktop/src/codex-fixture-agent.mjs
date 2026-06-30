const args = process.argv.slice(2);

if (args[0] === "exec" && args.includes("--help")) {
  console.log("Run Codex non-interactively");
  console.log("Usage: codex exec [OPTIONS] [PROMPT]");
  process.exit(0);
}

if (args[0] === "exec" && args[1] === "resume" && args.includes("--help")) {
  console.log("Resume a previous session by id or pick the most recent with --last");
  console.log("Usage: codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]");
  process.exit(0);
}

const task = args[args.length - 1] ?? "Summarize repository readiness.";
const sessionMode = args[0] === "exec" && args[1] === "resume" ? "resumed" : "new";
let cancelled = false;

console.error("WARN codex_core_plugins::manager: failed to refresh featured plugins: 401 Unauthorized");

process.on("SIGTERM", () => {
  cancelled = true;
});

console.log(JSON.stringify({
  type: "thread.started",
  thread_id: sessionMode === "resumed" ? "codex_fixture_thread_resumed" : "codex_fixture_thread"
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
      text: `Codex fixture ${sessionMode} step ${step}: ${task}`
    }
  }));
  await sleep(150);
}

console.log(JSON.stringify({
  type: "item.completed",
  item: {
    id: "fixture_file_change",
    type: "file_change",
    path: "docs/engineering/CODEX_FIXTURE_REVIEW.md",
    action: "modified",
    risk: "medium",
    summary: "Updated the Codex fixture review note for managed diff review.",
    diff: [
      "diff --git a/docs/engineering/CODEX_FIXTURE_REVIEW.md b/docs/engineering/CODEX_FIXTURE_REVIEW.md",
      "index 1111111..2222222 100644",
      "--- a/docs/engineering/CODEX_FIXTURE_REVIEW.md",
      "+++ b/docs/engineering/CODEX_FIXTURE_REVIEW.md",
      "@@ -1,3 +1,4 @@",
      " # Codex fixture review",
      "-Managed sessions record JSONL evidence.",
      "+Managed sessions record JSONL evidence.",
      "+Reviewers can approve, reject, or send feedback with an audit link."
    ].join("\n")
  }
}));

console.log(JSON.stringify({
  type: "item.completed",
  item: {
    id: "fixture_final",
    type: "agent_message",
    text: `Codex fixture ${sessionMode} completed task: ${task}`
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
