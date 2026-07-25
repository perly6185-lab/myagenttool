import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVisibleInterval } from "./use-visible-interval";

describe("useVisibleInterval", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("pauses in the background and catches up when visible again", () => {
    const callback = vi.fn();
    let visibilityState: DocumentVisibilityState = "hidden";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibilityState);
    renderHook(() => useVisibleInterval(callback, 1_000));

    act(() => vi.advanceTimersByTime(2_000));
    expect(callback).not.toHaveBeenCalled();

    visibilityState = "visible";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(callback).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(1_000));
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
