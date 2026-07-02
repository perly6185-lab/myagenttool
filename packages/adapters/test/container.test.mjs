/*
 * Unit tests for the container adapter slice. The governance guards are the
 * point: privileged rejected, resource ceilings clamped, network isolated by
 * default, digest pinning surfaced, task delivered via env (not argv).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONTAINER_ADAPTER_CONTRACT,
  describeContainerRun,
  normalizeContainerAdapterConfig,
} from "../src/container.mjs";

test("contract: container supports success/failure/cancellation/log streaming", () => {
  assert.equal(CONTAINER_ADAPTER_CONTRACT.kind, "container");
  assert.equal(CONTAINER_ADAPTER_CONTRACT.cancellation, "supported");
  assert.equal(CONTAINER_ADAPTER_CONTRACT.streamsEvents, true);
});

test("normalize: image required + validated, privileged rejected, network isolated by default", () => {
  const c = normalizeContainerAdapterConfig({ image: "ghcr.io/acme/agent:1.2.3" });
  assert.equal(c.image, "ghcr.io/acme/agent:1.2.3");
  assert.equal(c.pinned, false, "tag-only images are not pinned");
  assert.equal(c.network, "none");
  assert.equal(c.runtime, "docker");
  assert.throws(() => normalizeContainerAdapterConfig({}), /valid image/);
  assert.throws(() => normalizeContainerAdapterConfig({ image: "x; rm -rf /" }), /valid image/);
  assert.throws(() => normalizeContainerAdapterConfig({ image: "acme/agent:1", privileged: true }), /not allowed/);
  assert.throws(() => normalizeContainerAdapterConfig({ image: "acme/agent:1", runtime: "lxc" }), /runtime must be/);
});

test("normalize: digest-pinned image is flagged; limits clamped to safe ceilings", () => {
  const digest = "a".repeat(64);
  const c = normalizeContainerAdapterConfig({
    image: `acme/agent@sha256:${digest}`,
    cpuLimit: 999,
    memoryLimitMb: 999_999,
    timeoutMs: 1,
  });
  assert.equal(c.pinned, true);
  assert.equal(c.cpuLimit, 8, "cpu clamped to the ceiling");
  assert.equal(c.memoryLimitMb, 16_384, "memory clamped to the ceiling");
  assert.equal(c.timeoutMs, 1_000, "timeout clamped to the floor");
});

test("describeContainerRun: task travels as the TASK env var, limits carried, one-shot", () => {
  const cfg = normalizeContainerAdapterConfig({ image: "acme/agent:1", env: { MODE: "safe" } });
  const run = describeContainerRun(cfg, "Do the thing");
  assert.equal(run.env.TASK, "Do the thing");
  assert.equal(run.env.MODE, "safe");
  assert.equal(run.network, "none");
  assert.equal(run.remove, true);
  assert.deepEqual(run.limits, { cpu: 1, memoryMb: 1024, timeoutMs: 300_000 });
  assert.throws(() => describeContainerRun(cfg, "  "), /requires task text/);
});
