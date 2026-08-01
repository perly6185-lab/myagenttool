import { describe, expect, it, vi } from "vitest";
import { inspectorContent } from "@/components/layout/inspector";

const t = vi.fn((key: string) => key) as never;

describe("Inspector section ownership", () => {
  it("lets Home use the full content width while retaining history on Invocations", () => {
    expect(inspectorContent("dashboard", t)).toBeNull();
    expect(inspectorContent("invocations", t)).not.toBeNull();
  });
});
