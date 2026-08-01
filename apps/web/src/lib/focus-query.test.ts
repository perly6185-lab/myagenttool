import { describe, expect, it } from "vitest";
import { focusQueryTarget } from "@/lib/focus-query";

describe("focusQueryTarget", () => {
  it("reads the target and preserves unrelated location state", () => {
    expect(focusQueryTarget(
      "https://console.example/work?section=evidence&refusal=ref%2F42&keep=yes#details",
      "refusal",
    )).toEqual({
      id: "ref/42",
      nextLocation: "/work?section=evidence&keep=yes#details",
    });
  });

  it("removes every copy of a consumed parameter", () => {
    expect(focusQueryTarget(
      "https://console.example/?autoRun=first&autoRun=stale",
      "autoRun",
    )).toEqual({
      id: "first",
      nextLocation: "/",
    });
  });

  it("ignores missing and empty targets", () => {
    expect(focusQueryTarget("https://console.example/?keep=yes", "refusal")).toBeNull();
    expect(focusQueryTarget("https://console.example/?refusal=", "refusal")).toBeNull();
  });
});
