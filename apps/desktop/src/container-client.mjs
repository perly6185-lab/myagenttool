/*
 * Live container client for the Desktop Bridge.
 *
 * Executes the declarative adapter config from @myagenttool/adapters/container:
 * one-shot `docker|podman run` built from the shared run descriptor (network
 * isolation, cpu/memory ceilings, task via the TASK env var, --rm), stdout and
 * stderr streamed as invocation events, cancellation mapped to
 * `<runtime> kill <name>` plus terminating the CLI child.
 *
 * Kept transport-pure (no /api/bridge calls) so it is testable against a fake
 * runtime binary; index.mjs owns the events/complete glue.
 */

import { spawn, spawnSync } from "node:child_process";
import { describeContainerRun } from "@myagenttool/adapters/container";

const CANCEL_GRACE_MS = 500;
const OUTPUT_TAIL_LIMIT = 4_000;

let runCounter = 0;

/** Build the `run` argv from the shared descriptor. Exported for tests so the
 *  mapping from governed config to actual flags is pinned. */
export function containerRunArgs(descriptor, name) {
  const args = [
    "run",
    "--rm",
    "--name",
    name,
    "--network",
    descriptor.network,
    "--cpus",
    String(descriptor.limits.cpu),
    "--memory",
    `${descriptor.limits.memoryMb}m`,
  ];
  for (const [key, value] of Object.entries(descriptor.env ?? {})) {
    args.push("-e", `${key}=${value}`);
  }
  args.push(descriptor.image, ...(descriptor.command ?? []));
  return args;
}

/** Run one task in a fresh container and wait for a terminal outcome. */
export async function runContainerAgent({ adapter, task, onEvent = () => {}, shouldCancel = () => false }) {
  let descriptor;
  try {
    descriptor = describeContainerRun(adapter, task);
  } catch (error) {
    return { status: "failed", summary: `Container run rejected: ${error?.message ?? error}`, result: null };
  }

  const name = `myagent-run-${process.pid}-${++runCounter}`;
  const args = containerRunArgs(descriptor, name);
  onEvent({ level: "info", message: `Container starting: ${descriptor.runtime} run ${descriptor.image} (network ${descriptor.network}).` });

  const child = spawn(descriptor.runtime, args, { stdio: ["ignore", "pipe", "pipe"] });

  let outputTail = "";
  let spawnError = null;
  let cancelled = false;
  let timedOut = false;

  const emitLines = (chunkText, level) => {
    for (const line of chunkText.split(/\r?\n/)) {
      if (!line.trim()) continue;
      onEvent({ level, message: line.slice(0, 500) });
    }
    outputTail = (outputTail + chunkText).slice(-OUTPUT_TAIL_LIMIT);
  };
  child.stdout.on("data", (chunk) => emitLines(chunk.toString("utf8"), "info"));
  child.stderr.on("data", (chunk) => emitLines(chunk.toString("utf8"), "warn"));
  child.on("error", (error) => {
    spawnError = error;
  });

  const stop = () => {
    // Ask the runtime to stop the container (the CLI process alone may detach),
    // then make sure the CLI child itself goes away.
    try {
      spawn(descriptor.runtime, ["kill", name], { stdio: "ignore" }).on("error", () => undefined);
    } catch {
      /* runtime gone */
    }
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    setTimeout(() => {
      try {
        if (child.exitCode === null) child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, CANCEL_GRACE_MS).unref?.();
  };

  const timeoutTimer = setTimeout(() => {
    if (child.exitCode !== null || cancelled) return;
    timedOut = true;
    stop();
  }, descriptor.limits.timeoutMs);

  const cancelTimer = setInterval(() => {
    if (cancelled || timedOut || !shouldCancel()) return;
    cancelled = true;
    stop();
  }, 250);

  const exitCode = await new Promise((resolveExit) => child.on("close", resolveExit));
  clearTimeout(timeoutTimer);
  clearInterval(cancelTimer);

  const output = outputTail.trim();
  if (spawnError) {
    return { status: "failed", summary: `Container runtime could not start: ${spawnError.message}`, result: null };
  }
  if (timedOut) {
    return { status: "timed_out", summary: "Container run exceeded its configured timeout.", result: { output } };
  }
  if (cancelled) {
    return { status: "cancelled", summary: "Container run was cancelled.", result: { output } };
  }
  if (exitCode === 0) {
    const lastLine = output.split("\n").filter(Boolean).at(-1) ?? "";
    return {
      status: "succeeded",
      summary: lastLine.slice(0, 200) || "Container run completed.",
      result: { image: descriptor.image, output },
    };
  }
  return { status: "failed", summary: `Container exited with code ${exitCode}.`, result: { output } };
}

/** Health probe: the configured runtime binary must answer --version. Also
 *  surfaces the digest-pinning stance so unpinned images are visible. */
export function probeContainerRuntime(adapter) {
  const probe = spawnSync(adapter.runtime, ["--version"], { encoding: "utf8", timeout: 5_000 });
  if (probe.error || probe.status !== 0) {
    return {
      ok: false,
      message: `Container runtime "${adapter.runtime}" is not available: ${probe.error?.message ?? `exit ${probe.status}`}.`,
      nextAction: `Install ${adapter.runtime} on this device or switch the agent's runtime.`,
    };
  }
  const version = String(probe.stdout ?? "").split("\n")[0]?.trim();
  const pinNote = adapter.pinned ? "image digest-pinned" : "image not digest-pinned (tag may drift)";
  return { ok: true, message: `${version}; ${pinNote}.` };
}
