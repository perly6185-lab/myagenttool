import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, CheckCircle2, Cloud, Copy, ExternalLink, HardDrive, Image, KeyRound, Languages, Link2, Loader2, Server, ShieldCheck, Trash2 } from "lucide-react";
import { SectionHeading } from "@/components/common/section-heading";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { ApiError } from "@/lib/api/request";
import { useUiStore } from "@/store/ui-store";
import { hostApi } from "../my-hosts/host-api";
import { siteApi } from "./site-api";
import { AliDnsCredentialField, AliyunOssCredentialField, CloudflareCredentialField } from "./site-credential-fields";
import { clearGoLiveHandoff, readGoLiveHandoff, recommendedDeploymentKind, type GoLiveHandoff } from "./site-experience-model";
import type { Site, SiteDeploymentKind, SiteDeploymentProvider, SiteDomainTlsAccessMode, SitePilotCampaign, SitePilotScenario, SitePilotSummary, SitePublication } from "./site-types";

function message(error: unknown, zh: boolean) {
  if (error instanceof ApiError && error.code === "site_deployment_busy") return zh ? "网站正在发布或检查连接，请等待当前操作完成后再修改设置。" : "A publication or connection check is running. Wait for it to finish before changing settings.";
  if (error instanceof ApiError && error.code === "site_deployment_ssh_scope_not_ready") return zh ? "所选发布范围当前不可用，请到“我的主机”重新验证范围和上传、下载权限。" : "The selected publishing range is not ready. Reverify its range and upload/download permissions in My hosts.";
  if (error instanceof ApiError && error.code === "site_deployment_ssh_host_not_ready") return zh ? "所选主机当前未通过连接检查，请到“我的主机”重新验证连接。" : "The selected host is not ready. Reverify its connection in My hosts.";
  if (error instanceof ApiError && error.code === "site_deployment_ssh_atomic_capability_required") return zh ? "这台主机不支持安全的原子切换，不能用于官网发布。" : "This host cannot perform the atomic switch required for safe site publishing.";
  if (error instanceof ApiError && error.code === "site_deployment_healthcheck_failed") return zh ? "服务器文件已处理，但 HTTPS 访问检查失败；系统已恢复原来的线上版本。请检查域名和 Web 服务。" : "The server files were processed, but the HTTPS check failed. The previous live version was restored. Check the domain and web server.";
  if (error instanceof ApiError && error.code === "site_deployment_content_mismatch") return zh ? "线上首页与本次发布内容不一致，系统没有保留错误版本为线上版本。" : "The public homepage did not match this release, so the incorrect version was not kept live.";
  if (error instanceof ApiError && error.code === "site_domain_private_network_not_allowed") return zh ? "这台主机尚未允许私网访问，请先到“我的主机”确认私网连接风险。" : "Private-network access is not enabled for this host. Confirm the private-network risk in My hosts first.";
  if (error instanceof ApiError && error.code === "site_domain_private_address_required") return zh ? "当前发布范围没有经过固定私网地址验证，请到“我的主机”重新验证该目录。" : "The publishing range has no verified fixed private address. Reverify the directory in My hosts.";
  if (error instanceof ApiError && error.code === "site_domain_target_hostname_mismatch") return zh ? "网站域名与当前发布目标不一致，请先保存发布目标后再继续。" : "The website domain does not match the current publishing target. Save the target before continuing.";
  if (error instanceof ApiError && error.code === "site_domain_ssh_target_not_ready") return zh ? "当前服务器或站点目录尚未通过连接检查。" : "The current server or site directory has not passed its connection checks.";
  if (error instanceof ApiError && error.code === "site_domain_dns_credential_unavailable") return zh ? "AliDNS 安全连接不可用，请重新保存 AccessKey。" : "The secure AliDNS connection is unavailable. Save the AccessKey again.";
  if (error instanceof ApiError && error.code === "site_domain_dns_permission_denied") return zh ? "AliDNS AccessKey 没有该域名所需的读取或记录管理权限。" : "The AliDNS AccessKey lacks the required read or record-management permission for this domain.";
  if (error instanceof ApiError && error.code === "site_domain_dns_auth_failed") return zh ? "AliDNS 拒绝了当前 AccessKey，请检查或重新保存。" : "AliDNS rejected this AccessKey. Check it or save it again.";
  if (error instanceof ApiError && error.code === "site_domain_dns_zone_not_managed") return zh ? "当前阿里云 DNS 账号没有托管这个域名。" : "This domain is not managed by the connected Alibaba Cloud DNS account.";
  if (error instanceof ApiError && error.code === "site_domain_caa_not_allowed") return zh ? "域名的 CAA 策略尚未允许 Let's Encrypt 签发证书。" : "The domain's CAA policy does not currently allow Let's Encrypt.";
  if (error instanceof ApiError && error.code === "site_domain_dns_propagation_timeout") return zh ? "测试 TXT 记录暂未传播完成，系统已尝试清理，请稍后重试。" : "The test TXT record did not propagate in time. Cleanup was attempted; try again later.";
  if (error instanceof ApiError && error.code === "site_domain_acme_contact_required") return zh ? "请先在站点资料中填写联系邮箱。" : "Add a contact email to the site profile first.";
  if (error instanceof ApiError && error.code === "site_domain_dns_verification_required") return zh ? "请先完成 AliDNS 只读验证。" : "Complete the read-only AliDNS verification first.";
  if (error instanceof ApiError && error.code === "site_domain_tls_busy") return zh ? "域名或证书检查正在进行，请等待完成。" : "A domain or certificate check is already running.";
  if (error instanceof ApiError && error.code === "site_tls_staging_ca_required") return zh ? "服务端尚未配置 Let's Encrypt staging 根证书，不能执行完整可信校验。" : "The server has no explicit Let's Encrypt staging trust anchor, so full verification cannot run.";
  if (error instanceof ApiError && error.code === "site_domain_staging_artifact_unavailable") return zh ? "测试证书只保存在当前进程内，请重新申请后再部署。" : "The test certificate existed only in the previous process. Request it again before deployment.";
  if (error instanceof ApiError && error.code === "site_tls_recovery_failed") return zh ? "测试证书激活失败，且旧证书恢复未能确认；请停止后续操作并检查服务器。" : "Test certificate activation failed and recovery could not be confirmed. Stop and inspect the server.";
  if (error instanceof ApiError && error.code.startsWith("site_tls_")) return zh ? "证书部署未完成；系统已尝试保留或恢复原证书，请检查证书范围和固定 Nginx 配置。" : "Certificate deployment did not complete. The previous certificate was kept or restored where possible; check the certificate range and fixed Nginx profile.";
  if (error instanceof ApiError && error.status === 409) return zh ? "设置已发生变化，请刷新后重试。" : "Settings changed elsewhere. Refresh and try again.";
  return error instanceof Error ? error.message : (zh ? "设置未能保存。" : "Settings could not be saved.");
}

export function SiteSettingsView() {
  const { i18n } = useAppTranslation();
  const zh = i18n.language.startsWith("zh");
  const navigate = usePageNavigation();
  const professional = useUiStore((state) => state.experienceMode) === "professional";
  const setExperienceMode = useUiStore((state) => state.setExperienceMode);
  const list = useQuery({ queryKey: ["my-site"], queryFn: siteApi.list });
  const siteId = list.data?.sites[0]?.id ?? null;
  const goLiveHandoff = useMemo(() => siteId ? readGoLiveHandoff(siteId) : null, [siteId]);
  const site = useQuery({ queryKey: ["my-site-professional", siteId], queryFn: () => siteApi.get(siteId!, true), enabled: Boolean(siteId && professional) });
  const providers = useQuery({ queryKey: ["site-deployment-providers"], queryFn: siteApi.providers, enabled: professional });
  const publications = useQuery({ queryKey: ["my-site-publications-professional", siteId], queryFn: () => siteApi.publications(siteId!, true), enabled: Boolean(siteId && professional) });
  const assets = useQuery({ queryKey: ["my-site-assets-professional", siteId], queryFn: () => siteApi.assets(siteId!, true), enabled: Boolean(siteId && professional) });
  const pilotSummary = useQuery({ queryKey: ["site-pilot-summary"], queryFn: siteApi.pilotSummary, enabled: professional, retry: false });
  const pilotCampaigns = useQuery({ queryKey: ["site-pilot-campaigns"], queryFn: siteApi.pilotCampaigns, enabled: professional, retry: false });
  const copy = zh ? {
    eyebrow: "我的设置 · 专业能力", title: "站点专业设置", description: "配置托管平台、域名和发布边界。日常内容维护仍在“我的站点”完成。",
    modeTitle: "此页面属于专业模式", modeHint: "开启后会显示部署平台、连接引用和发布记录；普通视图不会改变。", enable: "开启专业模式",
    noSite: "请先创建站点", noSiteHint: "回到“我的站点”完成首次设置后，再配置发布平台。", back: "前往我的站点",
    loading: "正在读取站点部署设置…", failed: "暂时无法读取部署设置", target: "发布目标", targetHint: "选择静态网站发布到哪里。只有标记为可用的平台才会执行真实发布。",
    provider: "托管方式", name: "显示名称", credential: "安全连接引用", credentialHint: "这里只保存由凭据管理器生成的引用，不保存访问令牌或密码。",
    project: "远端项目标识", bucket: "OSS Bucket", region: "区域", domain: "自定义域名", save: "保存目标", saving: "正在保存…", saved: "发布目标已保存。", verify: "测试连接", verifying: "正在测试…", connectionReady: "连接验证通过，可以从“我的站点”发布。",
    available: "可用", planned: "规划中", professionalOnly: "仅专业模式", capabilities: "平台能力", releases: "发布记录", noReleases: "尚无发布记录。", assets: "素材诊断", noAssets: "尚未上传图片素材。", storage: "存储用量",
    live: "当前线上", verified: "验证通过", localNote: "本地发布会写入服务端管理的版本目录，适合预览、备份和自托管接入。",
  } : {
    eyebrow: "My settings · Professional", title: "Site professional settings", description: "Configure hosting, domains, and deployment boundaries. Daily editing stays in My site.",
    modeTitle: "This page belongs to Professional mode", modeHint: "Enable it to see deployment providers, connection references, and release records. Ordinary views stay unchanged.", enable: "Enable Professional mode",
    noSite: "Create your site first", noSiteHint: "Complete initial setup in My site before choosing a deployment platform.", back: "Go to My site",
    loading: "Loading deployment settings…", failed: "Deployment settings are temporarily unavailable", target: "Deployment target", targetHint: "Choose where the static website is published. Only providers marked available perform a real deployment.",
    provider: "Hosting method", name: "Display name", credential: "Secure connection reference", credentialHint: "Only a reference created by the credential manager is stored here—never an access token or password.",
    project: "Remote project reference", bucket: "OSS Bucket", region: "Region", domain: "Custom domain", save: "Save target", saving: "Saving…", saved: "Deployment target saved.", verify: "Test connection", verifying: "Testing…", connectionReady: "Connection verified. You can publish from My site.",
    available: "Available", planned: "Planned", professionalOnly: "Professional only", capabilities: "Provider capabilities", releases: "Release history", noReleases: "No releases yet.", assets: "Asset diagnostics", noAssets: "No image assets uploaded.", storage: "Storage usage",
    live: "Current live", verified: "Verified", localNote: "Local publishing writes immutable releases to a server-managed directory, suitable for preview, backup, and self-hosted integrations.",
  };

  if (!professional) return <div className="space-y-5"><SectionHeading eyebrow={copy.eyebrow} title={copy.title} description={copy.description} /><Card><CardContent className="flex min-h-52 flex-col items-center justify-center gap-3 p-6 text-center"><ShieldCheck className="size-8 text-muted-foreground" /><h3 className="font-semibold">{copy.modeTitle}</h3><p className="max-w-lg text-sm text-muted-foreground">{copy.modeHint}</p><Button onClick={() => setExperienceMode("professional")}>{copy.enable}</Button></CardContent></Card></div>;
  if (list.isLoading) return <SettingsNotice title={copy.loading} />;
  if (!siteId) return <div className="space-y-5"><SectionHeading eyebrow={copy.eyebrow} title={copy.title} description={copy.description} /><SettingsNotice title={copy.noSite} detail={copy.noSiteHint} action={<Button onClick={() => navigate("mySite")}>{copy.back}</Button>} /></div>;
  if (site.isLoading || providers.isLoading) return <SettingsNotice title={copy.loading} />;
  if (site.error || providers.error || !site.data) return <SettingsNotice title={copy.failed} detail={message(site.error ?? providers.error, zh)} />;

  return <div className="space-y-5">
    <SectionHeading eyebrow={copy.eyebrow} title={copy.title} description={copy.description} actions={<Button variant="secondary" onClick={() => navigate("mySite")}><ExternalLink />{copy.back}</Button>} />
    {goLiveHandoff ? <GoLiveHandoffSummary handoff={goLiveHandoff} zh={zh} /> : null}
    <LanguageSettingsCard site={site.data.site} zh={zh} />
    <PilotCampaignManager campaigns={pilotCampaigns.data?.campaigns ?? []} loading={pilotCampaigns.isLoading} failed={Boolean(pilotCampaigns.error)} zh={zh} />
    <PilotMetricsCard summary={pilotSummary.data?.summary ?? null} loading={pilotSummary.isLoading} failed={Boolean(pilotSummary.error)} zh={zh} />
    <DeploymentTargetEditor site={site.data.site} providers={providers.data?.providers ?? []} zh={zh} copy={copy} handoff={goLiveHandoff} />
    {site.data.site.deploymentTarget?.kind === "ssh_static" ? <DomainTlsSettingsCard site={site.data.site} zh={zh} /> : null}
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>{copy.capabilities}</CardTitle></CardHeader><CardContent className="space-y-3">{(providers.data?.providers ?? []).map((provider) => <ProviderRow key={provider.kind} provider={provider} copy={copy} />)}</CardContent></Card>
      <Card><CardHeader><CardTitle>{copy.releases}</CardTitle></CardHeader><CardContent>{publications.data?.publications.length ? <div className="divide-y divide-border">{publications.data.publications.map((release) => <ReleaseRow key={release.id} release={release} active={release.id === site.data.site.activePublicationId} zh={zh} liveLabel={copy.live} />)}</div> : <p className="text-sm text-muted-foreground">{copy.noReleases}</p>}</CardContent></Card>
      <Card className="lg:col-span-2"><CardHeader><CardTitle>{copy.assets}</CardTitle><p className="text-sm text-muted-foreground">{copy.storage}: {formatBytes(assets.data?.usage.bytes ?? 0)} / {formatBytes(assets.data?.usage.limitBytes ?? 0)}</p></CardHeader><CardContent>{assets.data?.assets.length ? <div className="divide-y divide-border">{assets.data.assets.map((asset) => <div key={asset.id} className="flex items-center gap-3 py-3"><span className="grid size-9 place-items-center rounded-lg bg-muted"><Image className="size-4 text-muted-foreground" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{asset.name}</span><span className="block truncate font-mono text-xs text-muted-foreground">{asset.mimeType} · {formatBytes(asset.size)} · {asset.sha256?.slice(0, 16) ?? "—"}</span></span><StatusBadge tone={asset.status === "ready" ? "success" : "warning"}>{asset.status}</StatusBadge></div>)}</div> : <p className="text-sm text-muted-foreground">{copy.noAssets}</p>}</CardContent></Card>
    </div>
  </div>;
}

function DomainTlsSettingsCard({ site, zh }: { site: Site; zh: boolean }) {
  const queryClient = useQueryClient();
  const binding = site.domainTlsBinding ?? null;
  const hostname = site.deploymentTarget?.customDomain ?? "";
  const [accessMode, setAccessMode] = useState<SiteDomainTlsAccessMode>(binding?.accessMode ?? "public");
  const publishScopes = useQuery({ queryKey: ["host-publish-scopes"], queryFn: hostApi.publishScopes, retry: false });
  const publishingScope = publishScopes.data?.scopes.find((scope) => scope.id === site.deploymentTarget?.remoteProjectRef) ?? null;
  const certificateScopes = useQuery({ queryKey: ["host-certificate-scopes"], queryFn: hostApi.certificateScopes, retry: false });
  const availableCertificateScopes = certificateScopes.data?.scopes.filter((scope) => scope.sshTargetId === publishingScope?.sshTargetId && scope.status === "ready") ?? [];
  const [certificateScopeId, setCertificateScopeId] = useState(binding?.certificateScopeId ?? "");
  const selectedCertificateScope = availableCertificateScopes.find((scope) => scope.id === certificateScopeId) ?? null;
  const profileHostId = selectedCertificateScope?.sshTargetId ?? publishingScope?.sshTargetId ?? "";
  const profiles = useQuery({
    queryKey: ["host-tls-profiles", profileHostId, certificateScopeId],
    queryFn: () => hostApi.tlsProfiles(profileHostId),
    enabled: Boolean(profileHostId && certificateScopeId),
    retry: false
  });
  const availableProfiles = profiles.data?.profiles.filter((profile) => profile.certificateScopeId === certificateScopeId && profile.status === "ready") ?? [];
  const [activationProfileId, setActivationProfileId] = useState(binding?.activationProfileId ?? "");
  useEffect(() => setAccessMode(binding?.accessMode ?? "public"), [binding?.accessMode]);
  useEffect(() => setCertificateScopeId(binding?.certificateScopeId ?? ""), [binding?.certificateScopeId]);
  useEffect(() => setActivationProfileId(binding?.activationProfileId ?? ""), [binding?.activationProfileId]);
  const mutation = useMutation({
    mutationFn: () => siteApi.configureDomainTls(site.id, { expectedRevision: binding?.revision ?? 0, hostname, accessMode }),
    onSuccess: (data) => {
      queryClient.setQueryData(["my-site-professional", site.id], { site: data.site });
      void queryClient.invalidateQueries({ queryKey: ["my-site"] });
    },
  });
  const applyResult = (data: { site: Site }) => {
    queryClient.setQueryData(["my-site-professional", site.id], { site: data.site });
    void queryClient.invalidateQueries({ queryKey: ["my-site"] });
  };
  const verifyDns = useMutation({
    mutationFn: () => siteApi.verifyDomainDns(site.id, binding?.revision ?? 0),
    onSuccess: applyResult,
  });
  const issueStaging = useMutation({
    mutationFn: () => siteApi.issueDomainTlsStaging(site.id, binding?.revision ?? 0),
    onSuccess: applyResult,
  });
  const configureDeployment = useMutation({
    mutationFn: () => siteApi.configureDomainTlsDeployment(site.id, { expectedRevision: binding?.revision ?? 0, certificateScopeId, activationProfileId }),
    onSuccess: applyResult,
  });
  const deployStaging = useMutation({
    mutationFn: () => siteApi.deployDomainTlsStaging(site.id, binding?.revision ?? 0),
    onSuccess: applyResult,
  });
  const statusLabel = binding?.status === "active"
    ? (zh ? "HTTPS 已启用" : "HTTPS active")
    : binding?.status === "staging_deployed"
      ? (zh ? "测试证书已部署并验证" : "Test certificate deployed and verified")
    : binding?.status === "staging_ready"
      ? (zh ? "测试证书已签发，尚未部署" : "Test certificate issued; not deployed")
      : binding?.status === "dns_ready"
        ? (zh ? "AliDNS 已验证" : "AliDNS verified")
        : binding?.status === "issuing"
          ? (zh ? "正在申请测试证书" : "Requesting test certificate")
    : binding?.status === "renewal_due"
      ? (zh ? "证书即将到期" : "Certificate renewal due")
      : binding?.status === "needs_attention"
        ? (zh ? "需要重新检查" : "Needs attention")
        : (zh ? "等待证书配置" : "Certificate setup pending");
  const tone = binding?.status === "active" ? "success" : binding?.status === "needs_attention" || binding?.status === "renewal_due" ? "warning" : "neutral";
  return <Card>
    <CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /><CardTitle>{zh ? "域名与 HTTPS" : "Domain and HTTPS"}</CardTitle></div><StatusBadge tone={tone}>{statusLabel}</StatusBadge></div><p className="text-sm text-muted-foreground">{zh ? "先登记网站的访问方式。证书签发和服务器部署将在后续步骤中单独确认，不会因保存设置自动改动服务器。" : "Register how visitors reach the site first. Certificate issuance and server deployment are confirmed separately and saving this form does not change the server."}</p></CardHeader>
    <CardContent className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2"><SettingField label={zh ? "网站域名" : "Website domain"}><Input readOnly value={hostname} /></SettingField><SettingField label={zh ? "访问范围" : "Access scope"}><Select aria-label={zh ? "访问范围" : "Access scope"} value={accessMode} onChange={(event) => setAccessMode(event.target.value as SiteDomainTlsAccessMode)}><option value="public">{zh ? "公网访问" : "Public internet"}</option><option value="private_lan">{zh ? "仅当前局域网" : "Private LAN only"}</option></Select></SettingField></div>
      <div className="grid gap-2 rounded-lg border border-border p-3 text-sm sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">{zh ? "DNS 服务" : "DNS provider"}</p><p className="mt-1 font-medium">AliDNS</p></div><div><p className="text-xs text-muted-foreground">{zh ? "验证方式" : "Validation"}</p><p className="mt-1 font-medium">DNS-01</p></div><div><p className="text-xs text-muted-foreground">{zh ? "证书续期" : "Renewal"}</p><p className="mt-1 font-medium">{zh ? "尚未启用" : "Not enabled yet"}</p></div></div>
      {binding?.certificateEnvironment === "staging" ? <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">{binding.status === "staging_deployed" ? (zh ? "测试证书已通过受控流程部署和校验，但浏览器仍不会信任它，网站不能据此标记为正式 HTTPS。" : "The staging certificate passed controlled deployment and verification, but browsers still do not trust it and the site is not production HTTPS.") : (zh ? "当前是 Let's Encrypt 测试证书，只用于验证 DNS-01 流程，浏览器不会将它视为正式可信证书，也尚未部署到服务器。" : "This is a Let's Encrypt staging certificate used only to validate the DNS-01 flow. Browsers do not trust it as a production certificate, and it has not been deployed to the server.")}</p> : null}
      {binding?.status === "staging_ready" ? <div className="space-y-3 rounded-lg border p-3"><p className="text-sm font-medium">{zh ? "受控测试部署" : "Controlled test deployment"}</p><p className="text-xs text-muted-foreground">{zh ? "先在“我的主机”创建证书专用范围和固定 Docker Nginx profile。部署会原子切换证书、固定重载、使用域名 SNI 和显式 staging CA 校验；失败会恢复旧指针。" : "First create a certificate-only range and fixed Docker Nginx profile in My hosts. Deployment atomically switches the certificate, performs a fixed reload, and verifies with hostname SNI and an explicit staging CA; failures restore the old pointer."}</p><div className="grid gap-3 md:grid-cols-2"><SettingField label={zh ? "证书专用范围" : "Certificate-only range"}><Select aria-label={zh ? "证书专用范围" : "Certificate-only range"} value={certificateScopeId} onChange={(event) => { setCertificateScopeId(event.target.value); setActivationProfileId(""); }}><option value="">{zh ? "请选择" : "Select"}</option>{availableCertificateScopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.label}</option>)}</Select></SettingField><SettingField label={zh ? "固定激活配置" : "Fixed activation profile"}><Select aria-label={zh ? "固定激活配置" : "Fixed activation profile"} value={activationProfileId} onChange={(event) => setActivationProfileId(event.target.value)}><option value="">{zh ? "请选择" : "Select"}</option>{availableProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</Select></SettingField></div><div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" disabled={!certificateScopeId || !activationProfileId || configureDeployment.isPending} onClick={() => configureDeployment.mutate()}>{configureDeployment.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}{zh ? "保存部署位置" : "Save deployment target"}</Button><Button disabled={!binding.certificateScopeId || !binding.activationProfileId || deployStaging.isPending} onClick={() => deployStaging.mutate()}>{deployStaging.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}{zh ? "部署并验证测试证书" : "Deploy and verify test certificate"}</Button></div></div> : null}
      {binding?.status === "dns_ready" ? <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{zh ? "申请测试证书会联系 Let's Encrypt staging，并在 AliDNS 创建临时 TXT；无论签发成功或失败，系统都会按本次 RecordId 尝试删除该记录。" : "Requesting a test certificate contacts Let's Encrypt staging and creates a temporary AliDNS TXT record. Whether issuance succeeds or fails, the system attempts to delete that exact RecordId."}</p> : null}
      {accessMode === "private_lan" ? <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{zh ? "局域网模式不要求公网 A/AAAA 记录，但仍会使用该域名完成完整 HTTPS 证书校验。主机必须已明确允许私网访问。" : "LAN mode does not require public A/AAAA records, but full HTTPS certificate validation still uses this hostname. The host must explicitly allow private-network access."}</p> : null}
      {binding?.lastFailure ? <p role="alert" className="rounded-lg bg-warning/10 p-3 text-sm text-warning">{zh ? "域名或服务器配置发生变化，请重新完成后续 HTTPS 检查。" : "The domain or server target changed. Complete the HTTPS checks again."}</p> : null}
      {mutation.error || verifyDns.error || issueStaging.error || configureDeployment.error || deployStaging.error ? <p role="alert" className="text-sm text-destructive">{message(mutation.error ?? verifyDns.error ?? issueStaging.error ?? configureDeployment.error ?? deployStaging.error, zh)}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" disabled={!hostname || mutation.isPending || verifyDns.isPending || issueStaging.isPending || deployStaging.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}{binding ? (zh ? "更新域名设置" : "Update domain setup") : (zh ? "保存域名设置" : "Save domain setup")}</Button>
        {binding && !["active", "staging_ready", "staging_deployed", "deploying"].includes(binding.status) ? <Button variant="secondary" disabled={!binding.revision || verifyDns.isPending || issueStaging.isPending} onClick={() => verifyDns.mutate()}>{verifyDns.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}{zh ? "验证 AliDNS 权限" : "Verify AliDNS access"}</Button> : null}
        {binding?.status === "dns_ready" ? <Button disabled={!binding.revision || issueStaging.isPending || verifyDns.isPending} onClick={() => issueStaging.mutate()}>{issueStaging.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}{zh ? "申请测试证书" : "Request test certificate"}</Button> : null}
      </div>
    </CardContent>
  </Card>;
}

function ReleaseRow({ release, active, zh, liveLabel }: { release: SitePublication; active: boolean; zh: boolean; liveLabel: string }) {
  const remote = release.remoteDeployment;
  return <div className="flex items-start gap-3 py-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted"><CheckCircle2 className="size-4 text-muted-foreground" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">v{release.version}</span><span className="block truncate text-xs text-muted-foreground">{release.bundleHash.slice(0, 12)} · {new Intl.DateTimeFormat(zh ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(release.activatedAt))}</span>{remote?.provider === "ssh_static" ? <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">{remote.remoteReleasePath} · {remote.fileCount ?? 0} {zh ? "个文件" : "files"}</span> : null}</span>{active ? <StatusBadge tone="success">{liveLabel}</StatusBadge> : <StatusBadge>{release.status}</StatusBadge>}</div>;
}

function LanguageSettingsCard({ site, zh }: { site: Site; zh: boolean }) {
  const queryClient = useQueryClient();
  const bilingual = (site.settings.supportedLocales ?? [site.defaultLocale]).length > 1;
  const mutation = useMutation({
    mutationFn: () => siteApi.update(site.id, {
      expectedRevision: site.revision,
      settings: { ...site.settings, supportedLocales: ["zh-CN", "en-US"] },
    }),
    onSuccess: (data) => {
      queryClient.setQueryData(["my-site-professional", site.id], data);
      void queryClient.invalidateQueries({ queryKey: ["my-site"] });
    },
  });
  return <Card>
    <CardHeader><div className="flex items-center gap-2"><Languages className="size-5 text-primary" /><CardTitle>{zh ? "内容语言" : "Content languages"}</CardTitle></div><p className="text-sm text-muted-foreground">{zh ? "语言能力在这里开启；翻译正文仍回到“我的站点”按页面维护。" : "Enable languages here, then maintain translated page content in My site."}</p></CardHeader>
    <CardContent className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-sm font-medium">{bilingual ? (zh ? "中文和英文" : "Chinese and English") : site.defaultLocale === "zh-CN" ? (zh ? "仅中文" : "Chinese only") : (zh ? "仅英文" : "English only")}</p><p className="mt-1 text-xs text-muted-foreground">{zh ? `默认语言：${site.defaultLocale === "zh-CN" ? "中文" : "英文"}；第二语言页面使用独立 URL，不会覆盖默认页面。` : `Default: ${site.defaultLocale === "zh-CN" ? "Chinese" : "English"}. Secondary-language pages use separate URLs.`}</p></div>
      <Button variant={bilingual ? "secondary" : "primary"} disabled={bilingual || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? <Loader2 className="animate-spin" /> : <Languages />}{bilingual ? (zh ? "双语已启用" : "Bilingual enabled") : (zh ? "启用中英双语" : "Enable Chinese and English")}</Button>
      {mutation.error ? <p role="alert" className="w-full text-sm text-destructive">{message(mutation.error, zh)}</p> : null}
    </CardContent>
  </Card>;
}

function PilotCampaignManager({ campaigns, loading, failed, zh }: { campaigns: SitePilotCampaign[]; loading: boolean; failed: boolean; zh: boolean }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState<SitePilotScenario | null>(null);
  const [generated, setGenerated] = useState<Partial<Record<SitePilotScenario, string>>>({});
  const campaign = campaigns[0] ?? null;
  const create = useMutation({
    mutationFn: () => siteApi.createPilotCampaign({ label: zh ? `真实用户试用 ${new Date().toISOString().slice(0, 10)}` : `Real-user pilot ${new Date().toISOString().slice(0, 10)}` }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["site-pilot-campaigns"] }); },
  });
  const close = useMutation({
    mutationFn: () => siteApi.updatePilotCampaign(campaign!.id, { expectedRevision: campaign!.revision, action: "close" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["site-pilot-campaigns"] }); },
  });
  const remove = useMutation({
    mutationFn: () => siteApi.deletePilotCampaign(campaign!.id),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["site-pilot-campaigns"] }); void queryClient.invalidateQueries({ queryKey: ["site-pilot-summary"] }); },
  });
  const invitation = useMutation({
    mutationFn: (scenario: SitePilotScenario) => siteApi.createPilotInvitation(campaign!.id, scenario),
    onSuccess: (data) => {
      setGenerated((current) => ({ ...current, [data.invitation.scenario]: data.invitation.inviteCode }));
      setCopied(null);
      void queryClient.invalidateQueries({ queryKey: ["site-pilot-campaigns"] });
    },
  });
  const scenarios = zh ? [
    ["first_setup", "首次建站"], ["content_maintenance", "独立维护"], ["status_understanding", "状态理解"],
  ] as const : [
    ["first_setup", "First setup"], ["content_maintenance", "Independent maintenance"], ["status_understanding", "Status understanding"],
  ] as const;
  function inviteUrl(scenario: SitePilotScenario) {
    const inviteCode = generated[scenario];
    if (!inviteCode) return "";
    const url = new URL(window.location.href);
    url.searchParams.set("section", "mySite");
    url.searchParams.set("sitePilot", inviteCode);
    url.searchParams.set("pilotTask", scenario);
    url.searchParams.delete("api");
    return url.toString();
  }
  async function copyInvite(scenario: SitePilotScenario) {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(inviteUrl(scenario));
    setCopied(scenario);
  }
  if (loading) return <Card><CardContent className="p-4 text-sm text-muted-foreground">{zh ? "正在读取试用批次…" : "Loading pilot rounds…"}</CardContent></Card>;
  if (failed) return <Card><CardContent className="p-4 text-sm text-destructive">{zh ? "试用批次暂时不可用。" : "Pilot rounds are temporarily unavailable."}</CardContent></Card>;
  if (!campaign) return <Card><CardHeader><div className="flex items-center gap-2"><Link2 className="size-5 text-primary" /><CardTitle>{zh ? "开始小范围试用" : "Start a small pilot"}</CardTitle></div><p className="text-sm text-muted-foreground">{zh ? "一键创建匿名试用批次。默认每类任务收集 5 个已结束样本，通过门槛为 80%；不需要现在填写参与者资料。" : "Create an anonymous pilot round with one click. Defaults are 5 ended samples per task and an 80% threshold; no participant details are needed now."}</p></CardHeader><CardContent><Button disabled={create.isPending} onClick={() => create.mutate()}>{create.isPending ? <Loader2 className="animate-spin" /> : <Link2 />}{zh ? "创建默认试用批次" : "Create default pilot round"}</Button>{create.error ? <p role="alert" className="mt-2 text-sm text-destructive">{message(create.error, zh)}</p> : null}</CardContent></Card>;
  const decision = campaign.decision === "collecting" ? (zh ? "继续采集样本" : "Keep collecting samples") : campaign.decision === "meets_thresholds" ? (zh ? "本轮达到门槛" : "Round meets thresholds") : (zh ? "进入体验改进" : "Move to experience improvements");
  return <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Link2 className="size-5 text-primary" /><CardTitle>{campaign.label}</CardTitle></div><StatusBadge tone={campaign.status === "active" ? "success" : "neutral"}>{campaign.status === "active" ? (zh ? "采集中" : "Collecting") : (zh ? "已结束" : "Closed")}</StatusBadge></div><p className="text-sm text-muted-foreground">{zh ? "每个匿名任务链接只开放一个独立临时站点，有效期 72 小时；不能访问正式官网或真实云配置，也不记录参与者身份。" : "Each anonymous task link opens one isolated temporary site for 72 hours. It cannot access the production site or real cloud configuration, and no participant identity is recorded."}</p></CardHeader><CardContent className="space-y-4">
    <div className={`rounded-lg border p-3 text-sm ${campaign.decision === "meets_thresholds" ? "border-success/30 bg-success/5" : campaign.decision === "needs_improvement" ? "border-warning/30 bg-warning/5" : "border-border bg-muted/40"}`}><p className="font-medium">{decision}</p><p className="mt-1 text-xs text-muted-foreground">{zh ? "只有三类任务都达到样本目标后，系统才判断是否达到指标门槛。" : "A threshold decision is made only after all three tasks reach their sample targets."}</p></div>
    <div className="grid gap-3 sm:grid-cols-3">{scenarios.map(([scenario, label]) => { const metricKey = scenario === "first_setup" ? "setupCompletion" : scenario === "content_maintenance" ? "independentMaintenance" : "statusUnderstanding"; const item = campaign.summary.metrics[metricKey]; const readiness = campaign.readiness[metricKey]; const invites = campaign.invitationCounts[scenario]; const link = inviteUrl(scenario); return <div key={scenario} className="rounded-lg border border-border p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{label}</p>{readiness.sampleReady ? <StatusBadge tone={readiness.thresholdMet ? "success" : "warning"}>{readiness.thresholdMet ? (zh ? "达标" : "Met") : (zh ? "待改进" : "Improve")}</StatusBadge> : null}</div><p className="mt-2 text-xl font-semibold">{item.rate == null ? "—" : `${Math.round(item.rate * 100)}%`}</p><p className="mt-1 text-xs text-muted-foreground">{zh ? `样本 ${item.denominator}/${campaign.quotas[scenario]} · 门槛 ${Math.round(campaign.thresholds[metricKey] * 100)}%` : `Samples ${item.denominator}/${campaign.quotas[scenario]} · threshold ${Math.round(campaign.thresholds[metricKey] * 100)}%`}</p><p className="mt-1 text-xs text-muted-foreground">{zh ? `邀请 ${invites.generated} · 已开始 ${invites.active + invites.completed + invites.abandoned} · 已结束 ${invites.completed + invites.abandoned} · 已过期 ${invites.expired ?? 0}` : `Invites ${invites.generated} · started ${invites.active + invites.completed + invites.abandoned} · ended ${invites.completed + invites.abandoned} · expired ${invites.expired ?? 0}`}</p>{campaign.status === "active" ? <>{link ? <><Input className="mt-3 text-xs" aria-label={zh ? `${label}邀请链接` : `${label} invite link`} readOnly value={link} onFocus={(event) => event.currentTarget.select()} /><Button className="mt-2 w-full" size="sm" variant="secondary" disabled={!navigator.clipboard} onClick={() => void copyInvite(scenario)}><Copy />{copied === scenario ? (zh ? "已复制" : "Copied") : (zh ? "复制邀请链接" : "Copy invite link")}</Button></> : null}<Button className="mt-2 w-full" size="sm" variant={link ? "ghost" : "secondary"} disabled={invitation.isPending} onClick={() => invitation.mutate(scenario)}><Link2 />{link ? (zh ? "再生成一个一次性链接" : "Generate another one-time link") : (zh ? "生成一次性邀请链接" : "Generate one-time invite")}</Button></> : null}</div>; })}</div>
    <div className="flex flex-wrap justify-end gap-2">{campaign.status === "active" ? <Button variant="secondary" disabled={close.isPending} onClick={() => close.mutate()}>{zh ? "结束本轮" : "Close round"}</Button> : <Button disabled={create.isPending} onClick={() => create.mutate()}>{zh ? "开始新一轮" : "Start new round"}</Button>}<Button variant="ghost" disabled={remove.isPending} onClick={() => { if (window.confirm(zh ? "删除本轮及其全部匿名试用记录？此操作无法恢复。" : "Delete this round and all of its anonymous pilot records? This cannot be undone.")) remove.mutate(); }}><Trash2 />{zh ? "删除本轮" : "Delete round"}</Button></div>
    {close.error || remove.error || create.error || invitation.error ? <p role="alert" className="text-sm text-destructive">{message(close.error ?? remove.error ?? create.error ?? invitation.error, zh)}</p> : null}
  </CardContent></Card>;
}

function PilotMetricsCard({ summary, loading, failed, zh }: { summary: SitePilotSummary | null; loading: boolean; failed: boolean; zh: boolean }) {
  const rows = summary ? [
    [zh ? "建站完成率" : "Setup completion", summary.metrics.setupCompletion],
    [zh ? "独立维护成功率" : "Independent maintenance", summary.metrics.independentMaintenance],
    [zh ? "上线状态理解率" : "Go-live status understanding", summary.metrics.statusUnderstanding],
  ] as const : [];
  return <Card><CardHeader><div className="flex items-center gap-2"><BarChart3 className="size-5 text-primary" /><CardTitle>{zh ? "真实试用指标" : "Real-user pilot metrics"}</CardTitle></div><p className="text-sm text-muted-foreground">{zh ? "仅汇总明确同意后的已结束任务；进行中的任务不进入分母。" : "Only ended tasks with explicit consent are aggregated. Active tasks are excluded from denominators."}</p></CardHeader><CardContent>
    {loading ? <p className="text-sm text-muted-foreground">{zh ? "正在读取试用数据…" : "Loading pilot data…"}</p>
      : failed ? <p className="text-sm text-destructive">{zh ? "试用指标暂时不可用。" : "Pilot metrics are temporarily unavailable."}</p>
        : !summary?.sampleCount ? <p className="text-sm text-muted-foreground">{zh ? "还没有真实用户样本。请在上方创建批次并生成一次性邀请链接；不会用自动化测试数据代替。" : "No real-user samples yet. Create a round above and generate one-time invitation links; automated test data is never presented as real usage."}</p>
          : <><div className="grid gap-3 sm:grid-cols-3">{rows.map(([label, item]) => <div key={label} className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{item.rate == null ? "—" : `${Math.round(item.rate * 100)}%`}</p><p className="mt-1 text-xs text-muted-foreground">{item.numerator}/{item.denominator} {zh ? "个已结束任务" : "ended tasks"}</p></div>)}</div><p className="mt-3 text-xs text-muted-foreground">{zh ? `样本 ${summary.sampleCount} · 进行中 ${summary.activeCount} · 已完成 ${summary.completedCount} · 未完成 ${summary.abandonedCount}。未采集参与者身份、正文、自由文本或云凭据。` : `Samples ${summary.sampleCount} · Active ${summary.activeCount} · Completed ${summary.completedCount} · Incomplete ${summary.abandonedCount}. No participant identity, content, free text, or cloud credentials collected.`}</p></>}
  </CardContent></Card>;
}

function GoLiveHandoffSummary({ handoff, zh }: { handoff: GoLiveHandoff; zh: boolean }) {
  const hosting = handoff.audience === "mainland" ? (zh ? "中国大陆云托管（阿里云 OSS + CDN）" : "Mainland China hosting (Alibaba Cloud OSS + CDN)") : (zh ? "全球云托管" : "Global cloud hosting");
  const address = handoff.address === "custom" ? (zh ? "使用自己的域名" : "Use a custom domain") : (zh ? "先使用平台网址" : "Start with a platform address");
  const owner = handoff.assistance === "technical" ? (zh ? "由技术人员完成" : "Completed by a technical person") : (zh ? "由我自己完成" : "Completed by me");
  return <Card><CardContent className="p-4"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" /><div><p className="font-medium">{zh ? "已从上线向导带入选择" : "Choices carried over from the go-live guide"}</p><p className="mt-1 text-sm text-muted-foreground">{hosting} · {address} · {owner}</p><p className="mt-1 text-xs text-muted-foreground">{zh ? "这里只带入推荐方式，没有保存任何账号、AccessKey、Bucket 或域名。请在下方按清单填写。" : "Only the recommended setup was carried over. No account, AccessKey, Bucket, or domain was saved. Complete the checklist below."}</p></div></div></CardContent></Card>;
}

function DeploymentTargetEditor({ site, providers, zh, copy, handoff }: { site: Site; providers: SiteDeploymentProvider[]; zh: boolean; copy: Record<string, string>; handoff: GoLiveHandoff | null }) {
  const queryClient = useQueryClient();
  const target = site.deploymentTarget;
  const recommendedKind = target?.kind === "local_directory" ? recommendedDeploymentKind(handoff) : null;
  const initialKind = recommendedKind ?? target?.kind ?? "local_directory";
  const [form, setForm] = useState({
    kind: initialKind as SiteDeploymentKind,
    displayName: providers.find((provider) => provider.kind === initialKind)?.ordinaryLabel ?? target?.displayName ?? (zh ? "本地发布" : "Local publishing"),
    credentialRef: target?.credentialRef ?? "", remoteProjectRef: target?.remoteProjectRef ?? "", region: target?.region ?? "", customDomain: target?.customDomain ?? "",
  });
  const [saved, setSaved] = useState(false);
  const ssh = form.kind === "ssh_static";
  const publishScopes = useQuery({ queryKey: ["site-publish-host-scopes"], queryFn: hostApi.publishScopes, enabled: ssh, retry: false });
  const updateCredentialReference = useCallback((credentialRef: string) => {
    setSaved(false);
    setForm((current) => ({ ...current, credentialRef }));
  }, []);
  useEffect(() => {
    const preferredKind = target?.kind === "local_directory" ? recommendedDeploymentKind(handoff) ?? target.kind : target?.kind ?? "local_directory";
    setForm({ kind: preferredKind, displayName: providers.find((provider) => provider.kind === preferredKind)?.ordinaryLabel ?? target?.displayName ?? "", credentialRef: target?.kind === preferredKind ? target?.credentialRef ?? "" : "", remoteProjectRef: target?.kind === preferredKind ? target?.remoteProjectRef ?? "" : "", region: target?.kind === preferredKind ? target?.region ?? "" : "", customDomain: target?.kind === preferredKind ? target?.customDomain ?? "" : "" });
  }, [handoff, providers, target]);
  const selected = providers.find((provider) => provider.kind === form.kind);
  const mutation = useMutation({
    mutationFn: () => siteApi.configureTarget(site.id, { expectedRevision: target?.revision ?? 1, ...form, credentialRef: form.credentialRef || null, remoteProjectRef: form.remoteProjectRef || null, region: form.region || null }),
    onSuccess: (data) => { clearGoLiveHandoff(); setSaved(true); queryClient.setQueryData(["my-site-professional", site.id], data); void queryClient.invalidateQueries({ queryKey: ["my-site"] }); },
  });
  const verify = useMutation({
    mutationFn: () => siteApi.verifyTarget(site.id),
    onSuccess: (data) => { queryClient.setQueryData(["my-site-professional", site.id], data); void queryClient.invalidateQueries({ queryKey: ["my-site"] }); },
  });
  const aliyun = form.kind === "aliyun_oss_cdn";
  const cloudflare = form.kind === "cloudflare_pages";
  const selectedScope = publishScopes.data?.scopes.find((scope) => scope.id === form.remoteProjectRef) ?? null;
  const scopeReady = Boolean(selectedScope
    && selectedScope.status === "ready"
    && selectedScope.permissions.includes("upload")
    && selectedScope.permissions.includes("download")
    && selectedScope.host.connectionStatus === "ready"
    && selectedScope.host.capabilities?.sftp
    && selectedScope.host.capabilities?.posixRename
    && selectedScope.host.capabilities?.symlink);
  const missingRequired = form.kind !== "local_directory" && (ssh
    ? !form.remoteProjectRef.trim() || !form.customDomain.trim() || !scopeReady
    : !form.credentialRef.trim() || !form.remoteProjectRef.trim() || (aliyun && (!form.region.trim() || !form.customDomain.trim())));
  const savedTargetMatches = Boolean(target
    && target.kind === form.kind
    && target.displayName === form.displayName
    && (target.credentialRef ?? "") === form.credentialRef
    && (target.remoteProjectRef ?? "") === form.remoteProjectRef
    && (target.region ?? "") === form.region
    && (target.customDomain ?? "") === form.customDomain);
  return <Card><CardHeader><CardTitle>{copy.target}</CardTitle><p className="text-sm text-muted-foreground">{copy.targetHint}</p></CardHeader><CardContent className="space-y-4">
    <div className="grid gap-4 md:grid-cols-2"><SettingField label={copy.provider}><Select value={form.kind} onChange={(event) => { const kind = event.target.value as SiteDeploymentKind; setSaved(false); setForm({ ...form, kind, displayName: providers.find((item) => item.kind === kind)?.ordinaryLabel ?? form.displayName, credentialRef: "", remoteProjectRef: "", region: "", customDomain: "" }); }}>{providers.map((provider) => <option key={provider.kind} value={provider.kind}>{provider.ordinaryLabel} · {provider.productionReady ? copy.available : copy.planned}</option>)}</Select></SettingField><SettingField label={copy.name}><Input value={form.displayName} onChange={(event) => { setSaved(false); setForm({ ...form, displayName: event.target.value }); }} /></SettingField></div>
    {form.kind !== "local_directory" ? ssh ? <div className="space-y-3"><div className="grid gap-4 md:grid-cols-2"><SettingField label={zh ? "站点发布范围" : "Site publishing range"}><Select aria-label={zh ? "站点发布范围" : "Site publishing range"} value={form.remoteProjectRef} onChange={(event) => { setSaved(false); setForm({ ...form, remoteProjectRef: event.target.value }); }}><option value="">{publishScopes.isLoading ? (zh ? "正在读取…" : "Loading…") : (zh ? "请选择已验证范围" : "Select a verified range")}</option>{publishScopes.data?.scopes.map((scope) => { const ready = scope.status === "ready" && scope.host.connectionStatus === "ready" && scope.permissions.includes("upload") && scope.permissions.includes("download") && Boolean(scope.host.capabilities?.sftp && scope.host.capabilities?.posixRename && scope.host.capabilities?.symlink); return <option key={scope.id} value={scope.id} disabled={!ready}>{scope.host.name} · {scope.label}{ready ? "" : (zh ? "（不可用）" : " (unavailable)")}</option>; })}</Select></SettingField><SettingField label={copy.domain}><Input value={form.customDomain} placeholder="www.example.com" onChange={(event) => { setSaved(false); setForm({ ...form, customDomain: event.target.value }); }} /></SettingField></div>{publishScopes.error ? <p role="alert" className="text-sm text-destructive">{zh ? "暂时无法读取主机发布范围。" : "Host publishing ranges are temporarily unavailable."}</p> : null}{!publishScopes.isLoading && !publishScopes.error && !publishScopes.data?.scopes.length ? <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-muted-foreground">{zh ? "还没有站点发布范围。请先到“我的设置 → 我的主机”添加并验证主机和专用目录。" : "No site publishing range exists yet. Add and verify a host and dedicated directory in My settings → My hosts first."}</p> : null}{selectedScope ? <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">{zh ? `将发布到 ${selectedScope.host.name} 的 ${selectedScope.resolvedRootPath}；Web 服务应把站点根目录指向该范围内的 current。` : `Publishing to ${selectedScope.resolvedRootPath} on ${selectedScope.host.name}. Point the web root to current inside this range.`}</p> : null}<AliDnsCredentialField zh={zh} /></div> : <><div className="grid gap-4 md:grid-cols-2">{aliyun ? <AliyunOssCredentialField zh={zh} reference={form.credentialRef} onReference={updateCredentialReference} /> : <CloudflareCredentialField zh={zh} reference={form.credentialRef} onReference={updateCredentialReference} />}<SettingField label={aliyun ? copy.bucket : copy.project}><Input value={form.remoteProjectRef} placeholder={aliyun ? "my-site-bucket" : "my-pages-project"} onChange={(event) => { setSaved(false); setForm({ ...form, remoteProjectRef: event.target.value }); }} /></SettingField></div>{aliyun ? <div className="grid gap-4 md:grid-cols-2"><SettingField label={copy.region}><Input value={form.region} placeholder="oss-cn-hangzhou" onChange={(event) => { setSaved(false); setForm({ ...form, region: event.target.value }); }} /></SettingField><SettingField label={copy.domain}><Input value={form.customDomain} placeholder="www.example.com" onChange={(event) => { setSaved(false); setForm({ ...form, customDomain: event.target.value }); }} /></SettingField></div> : <SettingField label={copy.domain}><Input value={form.customDomain} placeholder="www.example.com" onChange={(event) => { setSaved(false); setForm({ ...form, customDomain: event.target.value }); }} /></SettingField>}</> : <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{copy.localNote}</p>}
    {aliyun ? <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">{zh ? "发布前请在阿里云启用 OSS 版本控制和静态网站（首页 index.html、错误页 404.html），并确保 CDN 域名已启用 HTTPS、源站指向此 Bucket。中国内地域名还需完成 ICP 备案。" : "Before publishing, enable OSS versioning and static website hosting (index.html and 404.html), then ensure the CDN domain uses HTTPS and points to this Bucket. Mainland China domains also require ICP filing."}</div> : null}
    {aliyun ? <AliyunSetupChecklist zh={zh} credentialReady={Boolean(form.credentialRef.trim())} locationReady={Boolean(form.remoteProjectRef.trim() && form.region.trim() && form.customDomain.trim())} verified={target?.kind === "aliyun_oss_cdn" && target.status === "ready"} /> : null}
    {cloudflare ? <CloudflareSetupChecklist zh={zh} credentialReady={Boolean(form.credentialRef.trim())} projectReady={Boolean(form.remoteProjectRef.trim())} verified={target?.kind === "cloudflare_pages" && target.status === "ready"} /> : null}
    {ssh ? <SshSetupChecklist zh={zh} scopeReady={scopeReady} domainReady={Boolean(form.customDomain.trim())} verified={target?.kind === "ssh_static" && target.status === "ready"} /> : null}
    {selected && !selected.productionReady ? <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">{zh ? "此适配器边界已经定义，但当前版本不会向外部平台上传文件。你可以先保存规划信息，实际发布仍使用本地版本目录。" : "This adapter boundary is defined, but this version does not upload files to the external platform. You can save planning metadata while real publishing continues to use local releases."}</div> : null}
    {selected ? <div className="rounded-lg border border-border p-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{zh ? "连接与验证流程" : "Connection and verification flow"}</p><ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{selected.setupFlow.map((step, index) => <li key={step} className="flex gap-2 text-xs"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted font-semibold">{index + 1}</span><span className="pt-0.5 text-muted-foreground">{step}</span></li>)}</ol></div> : null}
    {mutation.error || verify.error ? <p role="alert" className="text-sm text-destructive">{message(mutation.error ?? verify.error, zh)}</p> : null}{saved ? <p role="status" className="text-sm text-success">{copy.saved}</p> : null}
    {target?.status === "ready" && target.lastVerifiedAt ? <p role="status" className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4" />{copy.connectionReady}</p> : null}
    <div className="flex justify-end gap-2"><Button variant="secondary" disabled={verify.isPending || mutation.isPending || missingRequired || !savedTargetMatches} title={!savedTargetMatches ? (zh ? "请先保存当前发布目标" : "Save the current deployment target first") : undefined} onClick={() => verify.mutate()}>{verify.isPending ? copy.verifying : copy.verify}</Button><Button disabled={mutation.isPending || missingRequired} onClick={() => mutation.mutate()}>{mutation.isPending ? copy.saving : copy.save}</Button></div>
  </CardContent></Card>;
}

function SshSetupChecklist({ zh, scopeReady, domainReady, verified }: { zh: boolean; scopeReady: boolean; domainReady: boolean; verified: boolean }) {
  const steps = zh ? [
    ["发布范围", "选择已验证且允许上传、回读的站点专用目录", scopeReady],
    ["域名和 Web 服务", "填写 HTTPS 域名，并让 Web 根目录指向范围内的 current", domainReady],
    ["安全检查", "保存后测试连接；首次检查会创建受管标记和版本目录，并核对原子切换能力", verified],
  ] as const : [
    ["Publishing range", "Select a verified site directory that permits upload and verification reads", scopeReady],
    ["Domain and web server", "Enter the HTTPS domain and point the web root to current inside the range", domainReady],
    ["Safety checks", "Save and test. The first check creates managed markers and release folders, then verifies atomic switching", verified],
  ] as const;
  return <ol className="grid gap-2 md:grid-cols-3">{steps.map(([title, detail, done], index) => <li key={title} className={`rounded-lg border p-3 ${done ? "border-success/30 bg-success/5" : "border-border"}`}><div className="flex items-center gap-2 text-sm font-medium">{done ? <CheckCircle2 className="size-4 text-success" /> : <span className="grid size-5 place-items-center rounded-full bg-muted text-xs">{index + 1}</span>}{title}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p></li>)}</ol>;
}

function AliyunSetupChecklist({ zh, credentialReady, locationReady, verified }: { zh: boolean; credentialReady: boolean; locationReady: boolean; verified: boolean }) {
  const steps = zh ? [
    ["安全连接", "保存 AccessKey 或填写已有凭据引用", credentialReady],
    ["发布位置", "填写 OSS Bucket、区域和 CDN 域名", locationReady],
    ["上线检查", "保存后运行“测试连接”，自动核对版本控制、HTTPS 和源站", verified],
  ] as const : [
    ["Secure connection", "Store an AccessKey or enter an existing credential reference", credentialReady],
    ["Publishing location", "Enter the OSS Bucket, region, and CDN domain", locationReady],
    ["Go-live checks", "Save, then Test connection to verify versioning, HTTPS, and origin", verified],
  ] as const;
  return <ol className="grid gap-2 md:grid-cols-3">{steps.map(([title, detail, done], index) => <li key={title} className={`rounded-lg border p-3 ${done ? "border-success/30 bg-success/5" : "border-border"}`}><div className="flex items-center gap-2 text-sm font-medium">{done ? <CheckCircle2 className="size-4 text-success" /> : <span className="grid size-5 place-items-center rounded-full bg-muted text-xs">{index + 1}</span>}{title}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p></li>)}</ol>;
}

function CloudflareSetupChecklist({ zh, credentialReady, projectReady, verified }: { zh: boolean; credentialReady: boolean; projectReady: boolean; verified: boolean }) {
  const steps = zh ? [
    ["安全连接", "在本机加密保存 Account ID 和 Pages API Token", credentialReady],
    ["Pages 项目", "填写已经存在的 Direct Upload 项目名称", projectReady],
    ["连接检查", "保存后运行“测试连接”，核对 Token 权限和项目", verified],
  ] as const : [
    ["Secure connection", "Encrypt the Account ID and Pages API Token on this device", credentialReady],
    ["Pages project", "Enter the name of an existing Direct Upload project", projectReady],
    ["Connection check", "Save, then Test connection to verify token access and the project", verified],
  ] as const;
  return <ol className="grid gap-2 md:grid-cols-3">{steps.map(([title, detail, done], index) => <li key={title} className={`rounded-lg border p-3 ${done ? "border-success/30 bg-success/5" : "border-border"}`}><div className="flex items-center gap-2 text-sm font-medium">{done ? <CheckCircle2 className="size-4 text-success" /> : <span className="grid size-5 place-items-center rounded-full bg-muted text-xs">{index + 1}</span>}{title}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p></li>)}</ol>;
}

function ProviderRow({ provider, copy }: { provider: SiteDeploymentProvider; copy: Record<string, string> }) {
  const Icon = provider.kind === "local_directory" ? HardDrive : provider.kind === "ssh_static" ? Server : Cloud;
  const enabled = Object.entries(provider.capabilities).filter(([, value]) => value).map(([key]) => key.replace(/([A-Z])/g, " $1").toLowerCase());
  return <div className="flex items-start gap-3 rounded-lg border border-border p-3"><Icon className="mt-0.5 size-5 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{provider.ordinaryLabel}</p><StatusBadge tone={provider.productionReady ? "success" : "neutral"}>{provider.productionReady ? copy.available : copy.planned}</StatusBadge>{provider.professionalOnly ? <StatusBadge tone="warning">{copy.professionalOnly}</StatusBadge> : null}</div><p className="mt-1 text-xs text-muted-foreground">{enabled.length ? enabled.join(" · ") : "—"}</p></div></div>;
}

function SettingField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="block space-y-1.5"><span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">{label}{hint ? <KeyRound className="size-3" /> : null}</span>{children}{hint ? <span className="block text-[11px] leading-relaxed text-muted-foreground">{hint}</span> : null}</label>; }
function formatBytes(value: number) { return value >= 1024 * 1024 ? `${(value / (1024 * 1024)).toFixed(1)} MB` : value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${value} B`; }
function SettingsNotice({ title, detail, action }: { title: string; detail?: string; action?: React.ReactNode }) { return <Card><CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-center"><p className="font-medium">{title}</p>{detail ? <p className="max-w-lg text-sm text-muted-foreground">{detail}</p> : null}{action}</CardContent></Card>; }
