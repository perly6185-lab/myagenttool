export type AdapterKind = "cli" | "http";
export type AdapterCancellationSupport = "supported" | "unsupported" | "unknown";

export interface AdapterContractRequirement {
  kind: AdapterKind;
  success: boolean;
  failure: boolean;
  cancellation: AdapterCancellationSupport;
  streamsEvents: boolean;
}

export const m0AdapterContracts: AdapterContractRequirement[] = [
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
