#!/usr/bin/env node
/*
 * Fake container runtime for tests. Emulates the docker/podman CLI surface the
 * container client uses:
 *   run ... -e TASK=<task> ... <image> → prints a log line + "echo: <task>", exit 0
 *   run with image "fail/agent"       → prints to stderr, exit 3
 *   run with image "hang/agent"       → never exits (for cancel/timeout tests)
 *   kill <name>                       → exit 0
 *   --version                         → prints a version banner
 */

const argv = process.argv.slice(2);

if (argv[0] === "--version") {
  console.log("fake-container-runtime version 0.0.0");
  process.exit(0);
}

if (argv[0] === "kill") {
  process.exit(0);
}

if (argv[0] === "run") {
  const envTask = argv
    .map((arg, i) => (arg === "-e" ? argv[i + 1] : null))
    .filter(Boolean)
    .find((pair) => pair.startsWith("TASK="));
  const task = envTask ? envTask.slice("TASK=".length) : "";
  const image = argv.filter((a) => a.includes("/") && !a.startsWith("-")).at(-1) ?? "";

  if (image.startsWith("hang/")) {
    setInterval(() => {}, 1_000); // never exit
  } else if (image.startsWith("fail/")) {
    console.error("boom");
    process.exit(3);
  } else {
    console.log("container working");
    console.log(`echo: ${task}`);
    process.exit(0);
  }
} else {
  console.error(`unsupported: ${argv.join(" ")}`);
  process.exit(2);
}
