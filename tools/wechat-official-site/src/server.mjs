import { resolveConfig } from "./config.mjs";
import { syncWechatOfficialDraft } from "./draft-sync.mjs";
import { probeWechatOfficialSession } from "./session.mjs";

export const TOOL_NAMES = Object.freeze(["wechat_official_probe", "wechat_official_draft_sync"]);

const tools = [
  {
    name: "wechat_official_probe",
    description: "Check the locally persisted WeChat Official Account browser session without changing remote content.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "wechat_official_draft_sync",
    description: "Save one review-confirmed, digest-bound article package to the connected WeChat Official Account draft box. It never publishes publicly.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["articlePackage"],
      properties: {
        articlePackage: {
          type: "object",
          additionalProperties: false,
          required: ["title", "contentHtml", "packageDigest"],
          properties: {
            title: { type: "string", minLength: 1, maxLength: 64 },
            author: { type: "string", maxLength: 32 },
            digest: { type: "string", maxLength: 240 },
            contentHtml: { type: "string", minLength: 1, maxLength: 262144 },
            packageDigest: { type: "string", pattern: "^sha256:[a-fA-F0-9]{64}$" },
            sourceUrl: { type: ["string", "null"], maxLength: 2048 },
            cover: { type: ["object", "null"] },
            bodyImages: { type: "array", maxItems: 100 },
          },
        },
      },
    },
  },
];

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try { void handle(JSON.parse(line)); } catch { /* invalid JSON-RPC is ignored */ }
  }
});

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message) {
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params?.protocolVersion ?? "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "myagenttool-wechat-official", version: "0.1.0" } } });
    return;
  }
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools } });
    return;
  }
  if (message.method !== "tools/call") return;
  try {
    const name = message.params?.name;
    if (!TOOL_NAMES.includes(name)) throw publicError("wechat_tool_unknown");
    const args = message.params?.arguments ?? {};
    const config = resolveConfig();
    const result = name === "wechat_official_probe"
      ? await probeWechatOfficialSession({ config })
      : await syncWechatOfficialDraft({ config, articlePackage: args.articlePackage });
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        ...(name === "wechat_official_draft_sync" && result.status !== "succeeded" ? { isError: true } : {}),
        content: [{ type: "text", text: JSON.stringify(result) }],
      },
    });
  } catch (error) {
    send({ jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: safeError(error) }] } });
  }
}

function publicError(code) {
  return Object.assign(new Error(code), { code });
}

function safeError(error) {
  const code = String(error?.code ?? error?.message ?? error);
  const messages = {
    session_browser_unavailable: "未找到可用的 Chrome 或 Edge，请安装后重试。",
    session_profile_in_use: "公众号登录窗口已在其他进程中打开，请关闭旧窗口后重试。",
    wechat_login_timeout: "公众号扫码登录已超时，请重新发起登录。",
  };
  return `wechat_official_unavailable: ${String(messages[code] ?? code).replace(/(token|secret|cookie)\s*[:=]\s*\S+/gi, "$1=[redacted]").slice(0, 300)}`;
}
