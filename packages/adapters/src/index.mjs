import { A2A_ADAPTER_CONTRACT, normalizeA2aAdapterConfig } from "./a2a.mjs";
import { CONTAINER_ADAPTER_CONTRACT, normalizeContainerAdapterConfig } from "./container.mjs";
import { MCP_ADAPTER_CONTRACT, normalizeMcpAdapterConfig } from "./mcp.mjs";

export { MCP_ADAPTER_CONTRACT, describeMcpToolCall, normalizeMcpAdapterConfig } from "./mcp.mjs";
export { A2A_ADAPTER_CONTRACT, describeA2aTaskCancel, describeA2aTaskSend, normalizeA2aAdapterConfig } from "./a2a.mjs";
export { CONTAINER_ADAPTER_CONTRACT, describeContainerRun, normalizeContainerAdapterConfig } from "./container.mjs";

export const m0AdapterContracts = [
  {
    kind: "cli",
    success: true,
    failure: true,
    cancellation: "supported",
    streamsEvents: true,
  },
  {
    kind: "http",
    success: true,
    failure: true,
    cancellation: "supported",
    streamsEvents: false,
  },
];

const mode = process.argv.includes("--check") ? "check" : "dev";

if (mode === "check") {
  runAdapterContractCheck();
  console.log("[adapters:check] M0 adapter contracts OK");
} else {
  console.log("[adapters:dev] M0 adapter contracts loaded");
}

function runAdapterContractCheck() {
  const cli = m0AdapterContracts.find((item) => item.kind === "cli");
  const http = m0AdapterContracts.find((item) => item.kind === "http");
  assert(cli?.success && cli.failure && cli.cancellation === "supported" && cli.streamsEvents, "CLI contract should cover success, failure, cancellation, and event streaming");
  assert(http?.success && http.failure && http.cancellation === "supported", "HTTP contract should cover success, failure, and cancellation");
  // MCP adapter slice: contract + config normalization must be sound.
  assert(MCP_ADAPTER_CONTRACT.kind === "mcp" && MCP_ADAPTER_CONTRACT.cancellation === "supported" && MCP_ADAPTER_CONTRACT.streamsEvents, "MCP contract should cover cancellation and event streaming");
  const stdio = normalizeMcpAdapterConfig({ transport: "stdio", command: "mcp-server" });
  assert(stdio.transport === "stdio" && stdio.command === "mcp-server", "MCP stdio config should normalize");
  // A2A adapter slice.
  assert(A2A_ADAPTER_CONTRACT.kind === "a2a" && A2A_ADAPTER_CONTRACT.cancellation === "supported" && A2A_ADAPTER_CONTRACT.streamsEvents, "A2A contract should cover cancellation and event streaming");
  const a2a = normalizeA2aAdapterConfig({ agentUrl: "https://agent.example" });
  assert(a2a.agentUrl === "https://agent.example" && a2a.agentCardPath === "/.well-known/agent.json", "A2A config should normalize with the default agent card path");
  // Container adapter slice.
  assert(CONTAINER_ADAPTER_CONTRACT.kind === "container" && CONTAINER_ADAPTER_CONTRACT.cancellation === "supported", "Container contract should cover cancellation");
  const container = normalizeContainerAdapterConfig({ image: "acme/agent:1.0" });
  assert(container.image === "acme/agent:1.0" && container.network === "none", "Container config should normalize with network isolation by default");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
