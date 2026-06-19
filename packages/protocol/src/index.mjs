export const invocationStatuses = [
  "created",
  "authorized",
  "rejected",
  "queued",
  "dispatching",
  "waiting_for_local_approval",
  "running",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "expired",
];

export const deliveryStates = [
  "not_required",
  "queued",
  "dispatching",
  "delivered",
  "acknowledged",
  "redelivering",
  "delivery_failed",
  "expired",
];

export const cancellationStates = [
  "none",
  "requested",
  "queued_cancelled",
  "dispatched",
  "acknowledged",
  "applied",
  "failed",
  "not_supported",
];

export const m0RequiredEventTypes = [
  "invocation_created",
  "invocation_authorized",
  "delivery_queued",
  "delivery_dispatched",
  "delivery_acknowledged",
  "delivery_redelivered",
  "trace_created",
  "span_started",
  "span_completed",
  "invocation_started",
  "invocation_succeeded",
  "invocation_failed",
  "cancel_requested",
  "cancel_applied",
];

const m0RequiredInvocationStatuses = [
  "created",
  "authorized",
  "queued",
  "dispatching",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "expired",
];

const m0RequiredDeliveryStates = [
  "queued",
  "dispatching",
  "acknowledged",
  "redelivering",
  "delivery_failed",
  "expired",
];

const m0RequiredCancellationStates = [
  "none",
  "requested",
  "queued_cancelled",
  "dispatched",
  "applied",
  "failed",
  "not_supported",
];

const mode = process.argv.includes("--check") ? "check" : "dev";

if (mode === "check") {
  runM0ProtocolCheck();
  console.log("[protocol:check] M0 protocol vocabulary OK");
} else {
  console.log("[protocol:dev] M0 protocol vocabulary loaded");
}

function runM0ProtocolCheck() {
  assertIncludes(invocationStatuses, m0RequiredInvocationStatuses, "invocation status");
  assertIncludes(deliveryStates, m0RequiredDeliveryStates, "delivery state");
  assertIncludes(cancellationStates, m0RequiredCancellationStates, "cancellation state");
  assertIncludes(m0RequiredEventTypes, [
    "invocation_created",
    "delivery_dispatched",
    "delivery_acknowledged",
    "delivery_redelivered",
    "trace_created",
    "span_completed",
    "cancel_applied",
  ], "event type");
}

function assertIncludes(actual, required, label) {
  for (const value of required) {
    if (!actual.includes(value)) {
      throw new Error(`Missing M0 ${label}: ${value}`);
    }
  }
}
