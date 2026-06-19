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
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
