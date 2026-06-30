if (process.argv.includes("--version")) {
  console.log("demo-agent 0.0.0");
  process.exit(0);
}

if (process.argv.includes("--self-check-update")) {
  console.log("demo-agent self-check update completed");
  process.exit(0);
}

if (process.argv.includes("--self-check-health")) {
  console.log("demo-agent self-check health ok");
  process.exit(0);
}

if (process.argv.includes("--self-check-rollback")) {
  console.log("demo-agent self-check rollback completed");
  process.exit(0);
}

const payload = JSON.parse(process.argv[2] ?? "{}");
const task = String(payload.task ?? "Run demo task.");
let cancelled = false;

process.on("SIGTERM", () => {
  cancelled = true;
});

for (let step = 1; step <= 5; step += 1) {
  if (cancelled) {
    console.log(`cancelled before step ${step}`);
    process.exit(130);
  }
  console.log(`step ${step}/5: working on "${task}"`);
  await sleep(250);
}

const result = {
  summary: `Demo CLI Agent completed: ${task}`,
  task,
  steps: 5,
  touchedUserFiles: false,
  cost: {
    model: "unknown",
    billable: false
  }
};

console.log(`RESULT ${JSON.stringify(result)}`);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
