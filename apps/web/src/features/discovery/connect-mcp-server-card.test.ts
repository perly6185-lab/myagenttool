import { describe, expect, it } from "vitest";
import { buildMcpProbePayload } from "@/features/discovery/connect-mcp-server-card";

// The connect flow (#137) sends the SAME payload to the dry-probe and to
// registration, so its transport-specific shape must be exact: a stdio config
// carries command+args (never url), an http config carries url (never command),
// and the allowlist is parsed consistently for both.
describe("buildMcpProbePayload", () => {
  it("builds a stdio config with trimmed command and parsed args", () => {
    const payload = buildMcpProbePayload({
      transport: "stdio",
      command: "  npx ",
      argsText: "-y, @modelcontextprotocol/server-filesystem, /path",
      url: "ignored",
      allowedToolsText: "",
    });
    expect(payload).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
      allowedTools: [],
    });
    expect(payload).not.toHaveProperty("url");
  });

  it("builds an http config with url and no command/args", () => {
    const payload = buildMcpProbePayload({
      transport: "http",
      command: "ignored",
      argsText: "ignored",
      url: "  https://mcp.example/rpc ",
      allowedToolsText: "read_file, list_dir",
    });
    expect(payload).toEqual({
      transport: "http",
      url: "https://mcp.example/rpc",
      allowedTools: ["read_file", "list_dir"],
    });
    expect(payload).not.toHaveProperty("command");
    expect(payload).not.toHaveProperty("args");
  });

  it("parses the allowlist from commas and newlines, dropping blanks", () => {
    const payload = buildMcpProbePayload({
      transport: "stdio",
      command: "mcp-fs",
      argsText: "",
      url: "",
      allowedToolsText: "read_file,\n list_dir , ",
    });
    expect(payload.allowedTools).toEqual(["read_file", "list_dir"]);
  });
});
