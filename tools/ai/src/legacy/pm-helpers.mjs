export function inferRiskFlags(text) {
  const flags = [];
  const lower = text.toLowerCase();
  if (/billing|cost|charge|payment|settlement|revenue|费用|计费|收入/.test(lower)) flags.push("Cost, billing, or revenue impact");
  if (/security|permission|credential|token|secret|安全|权限|密钥/.test(lower)) flags.push("Security or permission impact");
  if (/local|desktop|execute|command|agent|电脑|本地|执行/.test(lower)) flags.push("Local execution or agent operation impact");
  if (/delete|retention|privacy|data|audit|删除|隐私|数据|审计/.test(lower)) flags.push("Data, privacy, retention, or audit impact");
  if (/release|deploy|publish|发布|部署/.test(lower)) flags.push("Release or deployment impact");
  return flags;
}

export function inferArea(text) {
  const lower = text.toLowerCase();
  if (/ui|ux|web|console|页面|界面/.test(lower)) return "web";
  if (/server|api|queue|auth|gateway|服务/.test(lower)) return "server";
  if (/desktop|bridge|local|电脑|本地/.test(lower)) return "desktop";
  if (/billing|cost|revenue|费用|计费|收入/.test(lower)) return "billing";
  if (/security|permission|安全|权限/.test(lower)) return "security";
  if (/release|deploy|publish|发布|部署/.test(lower)) return "platform";
  return "cross-cutting";
}

export function inferPlatform(text) {
  const lower = text.toLowerCase();
  if (/web|console|页面/.test(lower)) return "web";
  if (/server|api|cloud|服务|云/.test(lower)) return "server";
  if (/mac|windows|linux|desktop|bridge|电脑|本地/.test(lower)) return "all";
  return "all";
}

export function targetToType(target) {
  const normalized = target.toLowerCase().trim();
  if (normalized === "bug") return "bug";
  if (normalized === "risk") return "risk";
  return "task";
}

export function labelsFromProjectFields(fields) {
  return [
    `type/${normalizeLabelValue(fields.type)}`,
    `status/${normalizeLabelValue(fields.status)}`,
    `area/${normalizeLabelValue(fields.area)}`,
    `risk/${normalizeLabelValue(fields.risk)}`,
    `acceptance/${normalizeLabelValue(fields.acceptance)}`,
    `platform/${normalizeLabelValue(fields.platform)}`,
    `agent/${normalizeLabelValue(fields.agentTarget)}`,
    `priority/${normalizeLabelValue(fields.priority)}`,
  ];
}

export function normalizeLabelValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

export function buildBranchName(issue, title, kind) {
  const slug = slugify(title).slice(0, 48).replace(/-+$/g, "");
  return sanitizeBranch(`${kind}/issue-${issue}-${slug}`);
}

export function sanitizeBranch(branch) {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+$/g, "")
    .slice(0, 96);
}

function slugify(text) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "work"
  );
}
