import { describe, expect, it } from "vitest";
import { gitStatusMarker } from "@/features/projects/project-tree";

describe("gitStatusMarker", () => {
  it("maps git statuses to a marker + tone", () => {
    expect(gitStatusMarker("modified")).toEqual({ label: "M", tone: "warning" });
    expect(gitStatusMarker("added")).toEqual({ label: "A", tone: "success" });
    expect(gitStatusMarker("deleted")).toEqual({ label: "D", tone: "danger" });
    expect(gitStatusMarker("untracked")?.label).toBe("U");
    expect(gitStatusMarker("ignored")?.label).toBe("I");
  });

  it("returns null for clean/unknown entries (no marker shown)", () => {
    expect(gitStatusMarker("clean")).toBeNull();
    expect(gitStatusMarker("")).toBeNull();
    expect(gitStatusMarker("whatever")).toBeNull();
  });
});
