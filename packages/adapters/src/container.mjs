/*
 * Container adapter — first slice.
 *
 * Same declarative shape as the MCP/A2A slices: a capability contract, config
 * normalization/validation, and the run descriptor an invocation maps to. The
 * live runtime (docker/podman create, log streaming, kill-on-cancel) belongs in
 * the Desktop Bridge and is the documented next step.
 *
 * Governance stance (docs/vision/POLICY_AND_RISK.md): a containerized agent
 * must stay auditable and bounded — the config rejects privileged mode, pins
 * resource ceilings with safe defaults, and prefers digest-pinned images so a
 * reviewed recipe can't silently change underneath its tag.
 */

/** Capabilities the container adapter path commits to. Cancellation maps to
 *  stopping the container; logs stream from the container's stdio. */
export const CONTAINER_ADAPTER_CONTRACT = Object.freeze({
  kind: "container",
  success: true,
  failure: true,
  cancellation: "supported",
  streamsEvents: true,
  runtimes: Object.freeze(["docker", "podman"]),
});

const RUNTIMES = new Set(["docker", "podman"]);
const DEFAULT_TIMEOUT_MS = 300_000;
const MIN_TIMEOUT_MS = 1_000;
const DEFAULT_CPU_LIMIT = 1;
const MAX_CPU_LIMIT = 8;
const DEFAULT_MEMORY_MB = 1_024;
const MAX_MEMORY_MB = 16_384;

// e.g. "ghcr.io/acme/agent:1.2.3" or "acme/agent@sha256:<64 hex>"
const IMAGE_PATTERN = /^[a-z0-9]+([._\-/:][a-z0-9]+)*(@sha256:[0-9a-f]{64})?$/i;

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Validate + canonicalize a user-supplied container agent config. An image is
 * required; `privileged` is rejected outright; cpu/memory are clamped to safe
 * ceilings; `network` defaults to "none" (an agent that needs egress must say
 * so explicitly). `pinned` reports whether the image is digest-pinned.
 */
export function normalizeContainerAdapterConfig(input = {}) {
  const runtime = String(input.runtime ?? "docker").trim();
  if (!RUNTIMES.has(runtime)) {
    throw new Error(`Container runtime must be one of: ${[...RUNTIMES].join(", ")}.`);
  }
  const image = String(input.image ?? "").trim();
  if (!image || !IMAGE_PATTERN.test(image)) {
    throw new Error("Container adapter requires a valid image reference.");
  }
  if (input.privileged) {
    throw new Error("Privileged containers are not allowed for managed agents.");
  }
  const command = Array.isArray(input.command)
    ? input.command.map((c) => String(c)).filter(Boolean)
    : [];
  const env =
    input.env && typeof input.env === "object" && !Array.isArray(input.env)
      ? Object.fromEntries(Object.entries(input.env).map(([k, v]) => [String(k), String(v)]))
      : {};
  const network = ["none", "bridge"].includes(input.network) ? input.network : "none";
  const timeoutMs = Number.isFinite(Number(input.timeoutMs))
    ? Math.max(MIN_TIMEOUT_MS, Math.floor(Number(input.timeoutMs)))
    : DEFAULT_TIMEOUT_MS;
  return Object.freeze({
    kind: "container",
    runtime,
    image,
    pinned: image.includes("@sha256:"),
    command,
    env,
    network,
    cpuLimit: clampNumber(input.cpuLimit, DEFAULT_CPU_LIMIT, 0.1, MAX_CPU_LIMIT),
    memoryLimitMb: Math.floor(clampNumber(input.memoryLimitMb, DEFAULT_MEMORY_MB, 64, MAX_MEMORY_MB)),
    timeoutMs,
  });
}

/**
 * Map an invocation to the run descriptor the bridge would execute. The task
 * reaches the container as the TASK env var (never argv, so it can't be
 * shell-mangled); the descriptor carries the enforced limits.
 */
export function describeContainerRun(config, task) {
  const text = String(task ?? "").trim();
  if (!text) {
    throw new Error("A container run requires task text.");
  }
  return {
    runtime: config.runtime,
    image: config.image,
    command: [...(config.command ?? [])],
    env: { ...(config.env ?? {}), TASK: text },
    network: config.network,
    limits: { cpu: config.cpuLimit, memoryMb: config.memoryLimitMb, timeoutMs: config.timeoutMs },
    remove: true, // one-shot: the bridge removes the container after the run
  };
}
