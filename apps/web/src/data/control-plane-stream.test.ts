import { describe, expect, it, vi } from "vitest";
import {
  isControlPlaneStreamConnected,
  setControlPlaneStreamConnected,
  subscribeControlPlaneStream,
} from "./control-plane-stream";

describe("control-plane stream state", () => {
  it("notifies only when connection state changes", () => {
    setControlPlaneStreamConnected(false);
    const listener = vi.fn();
    const unsubscribe = subscribeControlPlaneStream(listener);
    setControlPlaneStreamConnected(true);
    setControlPlaneStreamConnected(true);
    setControlPlaneStreamConnected(false);
    unsubscribe();
    expect(listener.mock.calls).toEqual([[true], [false]]);
    expect(isControlPlaneStreamConnected()).toBe(false);
  });
});
