import { normalizeStringArray } from "../agents.mjs";
import { adapterFromArtifact } from "./helpers.mjs";

export function createIntegrationProbeRuntime({
  state,
  now,
  nextId,
  appendEvent,
  findIntegrationArtifact,
}) {
  function createIntegrationProbeRun(artifact) {
    if (artifact.artifactType !== "adapter_config") {
      throw new Error("Only adapter config artifacts can be probed.");
    }
    if (artifact.reviewState !== "approved" && artifact.reviewState !== "tested") {
      throw new Error("Approve the adapter config before probing.");
    }
    const adapter = adapterFromArtifact(artifact);
    if (adapter.type === "cli" && (state.device.status !== "online" || state.device.unlinkState !== "linked")) {
      throw new Error("Desktop Bridge must be online before CLI probe.");
    }
    const createdAt = now();
    const probeRun = {
      id: nextId("lco_demo"),
      artifactId: artifact.id,
      deviceId: adapter.type === "cli" ? state.device.id : null,
      requestedBy: "usr_local",
      status: adapter.type === "cli" ? "queued" : "running",
      adapter,
      summary: "Probe requested after explicit review action.",
      details: [
        "No install scripts are run.",
        "Probe uses the reviewed adapter config only.",
        "Passing probe marks the artifact tested but does not enable an agent.",
      ],
      createdAt,
      completedAt: null,
    };
    state.integrationProbeRuns.unshift(probeRun);
    state.integrationProbeRuns = state.integrationProbeRuns.slice(0, 100);
    appendEvent({
      invocationId: null,
      type: "integration_tested",
      level: "info",
      message: `Probe queued for ${artifact.summary}.`,
      data: { probeRunId: probeRun.id, artifactId: artifact.id },
    });
    if (adapter.type === "http") {
      queueMicrotask(() => runHttpIntegrationProbe(probeRun).catch((error) => {
        completeIntegrationProbeRun(probeRun, {
          status: "failed",
          summary: `HTTP probe failed: ${error instanceof Error ? error.message : String(error)}`,
          details: ["HTTP probe failed before completion."],
        });
      }));
    }
    return probeRun;
  }

  function nextBridgeProbeRun() {
    return state.integrationProbeRuns.find((item) => item.status === "queued" && item.adapter?.type === "cli");
  }

  function markIntegrationProbeStarted(probeRun) {
    if (probeRun.status !== "queued") {
      return;
    }
    probeRun.status = "running";
    probeRun.summary = "Desktop Bridge is running a restricted adapter probe.";
    probeRun.updatedAt = now();
    appendEvent({
      invocationId: null,
      type: "integration_tested",
      level: "info",
      message: probeRun.summary,
      data: { probeRunId: probeRun.id, artifactId: probeRun.artifactId },
    });
  }

  function completeIntegrationProbeRun(probeRun, body = {}) {
    const succeeded = ["ok", "healthy", "succeeded"].includes(body.status) || body.status === true;
    probeRun.status = body.status === "failed" || !succeeded ? "failed" : "succeeded";
    probeRun.summary = String(body.summary ?? body.message ?? (succeeded ? "Probe passed." : "Probe failed."));
    probeRun.details = normalizeStringArray(body.details).length > 0 ? normalizeStringArray(body.details) : probeRun.details;
    probeRun.completedAt = now();
    probeRun.updatedAt = probeRun.completedAt;
    const artifact = findIntegrationArtifact(probeRun.artifactId);
    if (artifact && probeRun.status === "succeeded") {
      artifact.reviewState = "tested";
      artifact.updatedAt = now();
    }
    appendEvent({
      invocationId: null,
      type: "integration_tested",
      level: probeRun.status === "succeeded" ? "info" : "warn",
      message: `${probeRun.summary} Registration remains explicit.`,
      data: { probeRunId: probeRun.id, artifactId: probeRun.artifactId, status: probeRun.status },
    });
  }

  function findIntegrationProbeRun(id) {
    return state.integrationProbeRuns.find((item) => item.id === id);
  }

  async function runHttpIntegrationProbe(probeRun) {
    const adapter = probeRun.adapter;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(adapter.timeoutSeconds ?? 30) * 1000);
    try {
      const url = new URL(adapter.healthPath ?? "/health", adapter.baseUrl);
      const response = await fetch(url, { method: "GET", signal: controller.signal });
      const text = await response.text();
      completeIntegrationProbeRun(probeRun, {
        status: response.ok ? "succeeded" : "failed",
        summary: response.ok ? "HTTP probe passed." : `HTTP probe returned ${response.status}.`,
        details: [
          `Checked ${url.toString()}`,
          text ? `Response: ${text.slice(0, 160)}` : "No response body recorded.",
        ],
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    completeIntegrationProbeRun,
    createIntegrationProbeRun,
    findIntegrationProbeRun,
    markIntegrationProbeStarted,
    nextBridgeProbeRun,
  };
}
