import { siteDeploymentProviderCapabilities } from "@myagenttool/protocol/site";

export class SiteDeploymentAdapterError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = "SiteDeploymentAdapterError";
    this.code = code;
    this.retryable = retryable;
    // Allows narrowly-scoped adapter failures to cross the SFTP callback
    // boundary without exposing arbitrary transport errors or credentials.
    this.safeForSftpBoundary = true;
  }
}

/**
 * Provider metadata is intentionally separate from credentials and network IO.
 * An adapter is production-ready only after it implements upload, atomic
 * activation, verification, and rollback under the same publication contract.
 */
export const siteDeploymentAdapters = Object.freeze({
  local_directory: Object.freeze({
    kind: "local_directory",
    ordinaryLabel: "导出网站文件",
    productionReady: true,
    professionalOnly: false,
    connectionKind: "none",
    setupFlow: ["选择服务端管理目录", "生成不可变版本", "原子切换当前版本", "验证关键页面"],
    capabilities: siteDeploymentProviderCapabilities.local_directory,
  }),
  cloudflare_pages: Object.freeze({
    kind: "cloudflare_pages",
    ordinaryLabel: "全球云托管",
    productionReady: true,
    professionalOnly: false,
    connectionKind: "credential_reference",
    setupFlow: ["连接 Cloudflare 账号", "选择或创建 Pages 项目", "上传静态版本", "验证预览域名", "确认后绑定自定义域名"],
    capabilities: siteDeploymentProviderCapabilities.cloudflare_pages,
  }),
  aliyun_oss_cdn: Object.freeze({
    kind: "aliyun_oss_cdn",
    ordinaryLabel: "中国大陆云托管",
    productionReady: true,
    professionalOnly: false,
    connectionKind: "credential_reference",
    setupFlow: ["连接阿里云账号", "选择 OSS Bucket 和区域", "上传版本前缀", "刷新 CDN", "验证域名和 HTTPS"],
    capabilities: siteDeploymentProviderCapabilities.aliyun_oss_cdn,
  }),
  ssh_static: Object.freeze({
    kind: "ssh_static",
    ordinaryLabel: "我的服务器",
    productionReady: true,
    professionalOnly: true,
    connectionKind: "host_file_scope_reference",
    setupFlow: ["选择已验证的站点发布范围", "检查目录归属和原子切换能力", "上传并回读不可变版本", "原子切换当前版本", "验证 HTTPS 首页"],
    capabilities: siteDeploymentProviderCapabilities.ssh_static,
  }),
});

export function listSiteDeploymentAdapters() {
  return Object.values(siteDeploymentAdapters).map((adapter) => ({ ...adapter, setupFlow: [...adapter.setupFlow] }));
}

export function normalizeCredentialReference(value) {
  if (value == null || value === "") return null;
  const reference = String(value).trim();
  // Explicit scheme prevents an access token pasted into this field from being
  // persisted accidentally. Secret material belongs to the credential manager.
  return reference.length <= 300 && /^(credential|secretref):\/\/[A-Za-z0-9._~:/-]+$/.test(reference)
    ? reference
    : undefined;
}

export function normalizeCustomDomain(value) {
  const domain = String(value ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!domain) return "";
  if (domain.length > 253 || domain.includes("://") || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) return undefined;
  return domain;
}
