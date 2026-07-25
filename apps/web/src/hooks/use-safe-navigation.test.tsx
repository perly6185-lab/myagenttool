import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSafeNavigation } from "./use-safe-navigation";

describe("useSafeNavigation", () => {
  it("runs immediately when clean and defers navigation when dirty", () => {
    const cleanAction = vi.fn();
    const dirtyAction = vi.fn();
    const { result, rerender } = renderHook(
      ({ dirty }) => useSafeNavigation(dirty),
      { initialProps: { dirty: false } },
    );

    act(() => result.current.requestNavigation(cleanAction));
    expect(cleanAction).toHaveBeenCalledOnce();

    rerender({ dirty: true });
    act(() => result.current.requestNavigation(dirtyAction));
    expect(dirtyAction).not.toHaveBeenCalled();
    expect(result.current.pendingNavigation).toBe(true);

    act(() => result.current.discardAndContinue());
    expect(dirtyAction).toHaveBeenCalledOnce();
    expect(result.current.pendingNavigation).toBe(false);
  });

  it("continues only after the save callback succeeds", () => {
    const action = vi.fn();
    let completeSave: (() => void) | undefined;
    const save = vi.fn((onSaved: () => void) => { completeSave = onSaved; });
    const { result } = renderHook(() => useSafeNavigation(true));

    act(() => result.current.requestNavigation(action));
    act(() => result.current.saveAndContinue(save));
    expect(action).not.toHaveBeenCalled();

    act(() => completeSave?.());
    expect(action).toHaveBeenCalledOnce();
  });
});
