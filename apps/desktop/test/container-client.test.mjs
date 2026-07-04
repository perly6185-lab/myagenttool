/*
 * Tests for the bridge's live container client against a fake runtime binary
 * that emulates the docker/podman CLI surface. Covers the governed args
 * mapping, the happy path (task via TASK env, output streamed + captured),
 * failure exit codes, cancellation, timeout, and the runtime health probe.
 */

import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { before, test } from "node:test";

import { normalizeContainerAdapterConfig, describeContainerRun } from "@myagenttool/adapters/container";
import { containerDescriptorRefusal, containerRunArgs, probeContainerRuntime, runContainerAgent } from "../src/container-client.mjs";

const fakeRuntime = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/fake-container-runtime.mjs");

before(() => {
  chmodSync(fakeRuntime, 0o755);
});

// The normalizer only admits docker/podman; tests swap in the fake binary after
// normalization so everything else (limits, network, env) is the real config.
function adapterFor(image, extra = {}) {
  return { ...normalizeContainerAdapterConfig({ image, ...extra }), runtime: fakeRuntime };
}

test("containerRunArgs: governed config maps to the expected runtime flags", () => {
  const config = normalizeContainerAdapterConfig({ image: "acme/agent:1", env: { MODE: "safe" }, cpuLimit: 2, memoryLimitMb: 512 });
  const descriptor = describeContainerRun(config, "do it");
  const args = containerRunArgs(descriptor, "run-name");
  assert.deepEqual(args.slice(0, 5), ["run", "--rm", "--name", "run-name", "--network"]);
  assert.ok(args.includes("none"), "network isolation flag present");
  assert.ok(args.includes("--cpus") && args.includes("2"), "cpu ceiling present");
  assert.ok(args.includes("512m"), "memory ceiling present");
  assert.ok(args.includes("TASK=do it"), "task travels as the TASK env var");
  assert.equal(args.at(-1), "acme/agent:1", "image last (no command)");
});

test("happy path: output streams as events and the echo lands in the result", async () => {
  const events = [];
  const outcome = await runContainerAgent({ adapter: adapterFor("acme/agent:1"), task: "hello ctr", onEvent: (e) => events.push(e), allowTestRuntime: true });
  assert.equal(outcome.status, "succeeded");
  assert.match(outcome.result.output, /echo: hello ctr/);
  assert.ok(events.some((e) => e.message.includes("container working")), "stdout lines stream as events");
});

test("failure: a non-zero container exit is a failed outcome with stderr captured", async () => {
  const outcome = await runContainerAgent({ adapter: adapterFor("fail/agent:1"), task: "x", allowTestRuntime: true });
  assert.equal(outcome.status, "failed");
  assert.match(outcome.summary, /exited with code 3/);
  assert.match(outcome.result.output, /boom/);
});

test("cancellation: a hung container is stopped when shouldCancel flips", async () => {
  let cancel = false;
  setTimeout(() => (cancel = true), 300);
  const outcome = await runContainerAgent({ adapter: adapterFor("hang/agent:1"), task: "x", shouldCancel: () => cancel, allowTestRuntime: true });
  assert.equal(outcome.status, "cancelled");
});

test("timeout: a hung container times out at the configured limit", async () => {
  const outcome = await runContainerAgent({ adapter: adapterFor("hang/agent:1", { timeoutMs: 1_000 }), task: "x", allowTestRuntime: true });
  assert.equal(outcome.status, "timed_out");
});

test("probeContainerRuntime: fake runtime is healthy and pinning stance is surfaced", () => {
  const ok = probeContainerRuntime(adapterFor("acme/agent:1"));
  assert.equal(ok.ok, true);
  assert.match(ok.message, /not digest-pinned/);
  const bad = probeContainerRuntime({ runtime: "/nonexistent/containerd-xyz", pinned: false });
  assert.equal(bad.ok, false);
});

test("containerDescriptorRefusal: a governed descriptor is allowed", () => {
  const descriptor = describeContainerRun(
    normalizeContainerAdapterConfig({ runtime: "docker", image: "acme/agent:1", network: "bridge", cpuLimit: 2, memoryLimitMb: 512 }),
    "do work",
  );
  assert.equal(containerDescriptorRefusal(descriptor), null);
});

test("containerDescriptorRefusal: catches host network, bad runtime/image, and oversized ceilings", () => {
  const base = { runtime: "docker", image: "acme/agent:1", network: "none", limits: { cpu: 1, memoryMb: 512, timeoutMs: 1000 } };
  assert.match(containerDescriptorRefusal({ ...base, network: "host" }), /network "host" is not allowlisted/);
  assert.match(containerDescriptorRefusal({ ...base, runtime: "nerdctl" }), /runtime "nerdctl" is not allowlisted/);
  assert.match(containerDescriptorRefusal({ ...base, image: "Bad Image!" }), /is not a valid reference/);
  assert.match(containerDescriptorRefusal({ ...base, limits: { cpu: 999, memoryMb: 512 } }), /cpu limit 999 is out of bounds/);
  assert.match(containerDescriptorRefusal({ ...base, limits: { cpu: 1, memoryMb: 999999 } }), /memory limit 999999 is out of bounds/);
});

test("runContainerAgent: refuses a host-network descriptor before spawning", async () => {
  const events = [];
  // A raw (un-normalized) config that would escape isolation; the bridge refuses
  // it independently, without trusting server normalization and without spawning.
  const outcome = await runContainerAgent({
    adapter: { runtime: "docker", image: "acme/agent:1", network: "host", command: [], env: {}, cpuLimit: 1, memoryLimitMb: 512, timeoutMs: 5000 },
    task: "escape",
    onEvent: (e) => events.push(e),
  });
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.result.policyDecision, "local_execution_refused");
  assert.equal(outcome.result.refusal.gate, "container_descriptor");
  assert.match(outcome.summary, /network "host" is not allowlisted/);
  assert.ok(events.some((e) => e.level === "error" && /refused by the local trust boundary/.test(e.message)));
});
