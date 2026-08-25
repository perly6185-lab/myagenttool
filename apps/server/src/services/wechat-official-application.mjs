export const WECHAT_OFFICIAL_APPLICATION_ID = "app_wechat_official";
export const WECHAT_OFFICIAL_AGENT_ID = "agt_mcp_wechat_official";

export function createWechatOfficialAgentRegistration({ serverScriptPath } = {}) {
  if (!serverScriptPath) throw new Error("The WeChat Official Agent requires its bundled MCP server path.");
  return {
    id: WECHAT_OFFICIAL_AGENT_ID,
    name: "微信公众号（本地浏览器）",
    type: "mcp",
    transport: "stdio",
    command: process.execPath,
    args: [serverScriptPath],
    allowedTools: ["wechat_official_probe", "wechat_official_draft_sync"],
    timeoutMs: 330_000,
    provider: "wechat_official",
    capabilityName: "wechat_official.draft",
    riskLevel: "medium",
    riskTags: ["wechat_official", "external_draft_write", "local_browser"],
  };
}

export function createWechatOfficialApplicationRegistration({ agentId = WECHAT_OFFICIAL_AGENT_ID, autoOnline = false } = {}) {
  if (!agentId) throw new Error("A WeChat Official Application requires a registered local site agent.");
  return {
    id: WECHAT_OFFICIAL_APPLICATION_ID,
    name: "微信公众号",
    kind: "external",
    autoOnline,
    source: {
      type: "manual",
      manifest: {
        description: "Uses a dedicated local browser profile to check the WeChat Official Account session and save reviewed article packages as drafts.",
        sitePlugin: "wechat_official",
        executionMode: "browser_assisted",
        publicPublish: false,
      },
    },
    capabilityFacades: [
      {
        id: "probe",
        agentId,
        agentToolName: "wechat_official_probe",
        displayName: "检查公众号登录状态",
        description: "Check the dedicated local publisher session without changing content.",
        riskLevel: "low",
        requiresApproval: false,
        directInvocation: true,
        riskTags: ["wechat_official", "session_read", "local_browser"],
        inputSchema: { type: "object", additionalProperties: false, properties: {} },
        outputCollection: "invocations",
        siteOperationContract: { platformId: "wechat_official", operation: "probe", inputArtifactKinds: [], outputArtifactKinds: [] },
      },
      {
        id: "draft_sync",
        agentId,
        agentToolName: "wechat_official_draft_sync",
        displayName: "保存公众号草稿",
        description: "Save one reviewed article package to the connected WeChat Official Account draft box before publish. Never performs public publish.",
        riskLevel: "medium",
        requiresApproval: true,
        directInvocation: true,
        riskTags: ["wechat_official", "draft_sync", "external_draft_write", "local_browser"],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["articlePackage"],
          properties: { articlePackage: { type: "object" } },
        },
        outputCollection: "applicationResults",
        resultImport: { source: "wechat_official_draft", kind: "draft_receipt" },
        siteOperationContract: {
          platformId: "wechat_official",
          operation: "draft_sync",
          inputArtifactKinds: ["wechat_article_package"],
          outputArtifactKinds: ["wechat_draft_receipt"],
        },
      },
    ],
  };
}
