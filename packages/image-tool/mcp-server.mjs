#!/usr/bin/env node
// MCP stdio server — what claude calls via the worktree's .mcp.json.
// Exposes a single `edit_image` tool that delegates to the shared core, so the
// capability logic is written once and reused by both agents.
//
// Implements the MCP stdio transport (newline-delimited JSON-RPC 2.0) directly,
// keeping this package dependency-free.

import { editImage } from "./core.mjs";

const DEFAULT_PROTOCOL = "2024-11-05";

const TOOL = {
  name: "edit_image",
  description: "Edit an existing image or generate a new one from a text prompt. Provide an explicit output path.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Instruction describing the desired image" },
      output: { type: "string", description: "Path to write the resulting image" },
      input: { type: "string", description: "Optional reference image to edit; omit to generate from scratch" },
      size: { type: "string", description: "Optional size hint, e.g. 1024x1024" }
    },
    required: ["prompt", "output"]
  }
};

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    reply(id, {
      protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: "image-tool", version: "0.0.0" }
    });
    return;
  }
  if (method === "notifications/initialized") return; // no response for notifications
  if (method === "tools/list") {
    reply(id, { tools: [TOOL] });
    return;
  }
  if (method === "tools/call") {
    const args = params?.arguments ?? {};
    if (params?.name !== TOOL.name) {
      replyError(id, -32602, `Unknown tool: ${params?.name}`);
      return;
    }
    try {
      const result = await editImage({ inputPath: args.input, prompt: args.prompt, outputPath: args.output, size: args.size });
      reply(id, { content: [{ type: "text", text: `OK [${result.provider}] wrote ${result.bytes} bytes -> ${result.outputPath}` }] });
    } catch (error) {
      reply(id, { isError: true, content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }] });
    }
    return;
  }
  if (id !== undefined) replyError(id, -32601, `Method not found: ${method}`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handle(msg).catch((error) => {
      if (msg?.id !== undefined) replyError(msg.id, -32603, error instanceof Error ? error.message : String(error));
    });
  }
});
process.stdin.on("end", () => process.exit(0));
