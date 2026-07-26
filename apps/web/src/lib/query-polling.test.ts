import { describe, expect, it } from "vitest";
import { QUERY_POLLING, visiblePolling } from "./query-polling";

describe("query polling policy", () => {
  it("stops inactive queries and uses the shared vocabulary", () => {
    expect(visiblePolling(QUERY_POLLING.activeOperation, false)).toBe(false);
    expect(QUERY_POLLING.fastProgress).toBeLessThan(QUERY_POLLING.sharedStateFallback);
    expect(QUERY_POLLING.sharedStateFallback).toBeLessThan(QUERY_POLLING.health);
  });
});
