import { describe, it, expect } from "vitest";
import { shortRemote } from "./workspace-view";

describe("shortRemote (Agent Workspace header)", () => {
  it("shortens GitHub https/ssh/.git remotes to owner/repo", () => {
    expect(shortRemote("https://github.com/perly6185-lab/myagenttool.git")).toBe("perly6185-lab/myagenttool");
    expect(shortRemote("git@github.com:o/r.git")).toBe("o/r");
    expect(shortRemote("https://github.com/o/r")).toBe("o/r");
  });
  it("keeps dotted repo names (strips only a trailing .git) (review C)", () => {
    expect(shortRemote("https://github.com/o/bar.js.git")).toBe("o/bar.js");
    expect(shortRemote("https://github.com/o/o.github.io")).toBe("o/o.github.io");
    expect(shortRemote("git@github.com:acme/docs.example.com.git")).toBe("acme/docs.example.com");
  });
  it("falls back to a trimmed host/path for non-github remotes", () => {
    expect(shortRemote("https://gitlab.com/o/r.git")).toBe("gitlab.com/o/r");
  });
});
