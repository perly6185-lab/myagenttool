import { useEffect, useState } from "react";
import { KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type CredentialStatus = {
  secureStorage: boolean;
  stored: boolean;
  ready: boolean;
  reference: string | null;
};

type ReferencedCredentialFieldProps = {
  zh: boolean;
  reference: string;
  onReference: (reference: string) => void;
};

function CredentialSettingField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">{label}{hint ? <KeyRound className="size-3" /> : null}</span>{children}{hint ? <span className="block text-[11px] leading-relaxed text-muted-foreground">{hint}</span> : null}</label>;
}

export function CloudflareCredentialField({ zh, reference, onReference }: ReferencedCredentialFieldProps) {
  const bridge = window.myagenttoolDesktop;
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [accountId, setAccountId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!bridge?.getCloudflareSiteCredentialStatus) return;
    void bridge.getCloudflareSiteCredentialStatus().then((next) => {
      if (!active) return;
      setStatus(next);
      if (next.ready && next.reference) onReference(next.reference);
      else if (next.stored && !next.ready) onReference("");
    }).catch(() => { if (active) setError(zh ? "无法读取本机安全存储。" : "Could not read secure storage."); });
    return () => { active = false; };
  }, [bridge, onReference, zh]);

  async function save() {
    if (!bridge?.saveCloudflareSiteCredential) return;
    setPending(true); setError(null);
    const result = await bridge.saveCloudflareSiteCredential({ accountId, apiToken }).catch(() => ({ ok: false as const, error: "save_failed" as const }));
    setPending(false);
    if (!result.ok) {
      setError(result.error === "secure_storage_unavailable" ? (zh ? "系统安全存储不可用，未保存任何凭据。" : "OS secure storage is unavailable; nothing was saved.") : (zh ? "Account ID 或 API Token 格式不正确，或保存失败。" : "The Account ID or API Token is invalid, or could not be saved."));
      return;
    }
    onReference(result.reference);
    setStatus({ secureStorage: true, stored: true, ready: true, reference: result.reference });
    setAccountId(""); setApiToken("");
  }

  async function remove() {
    if (!bridge?.removeCloudflareSiteCredential) return;
    setPending(true); setError(null);
    const result = await bridge.removeCloudflareSiteCredential().catch(() => ({ ok: false as const, error: "remove_failed" as const }));
    setPending(false);
    if (!result.ok) { setError(zh ? "暂时无法移除安全连接。" : "The secure connection could not be removed."); return; }
    onReference("");
    setStatus({ secureStorage: true, stored: false, ready: false, reference: null });
  }

  if (!bridge?.getCloudflareSiteCredentialStatus) return <CredentialSettingField label={zh ? "安全连接引用" : "Secure connection reference"} hint={zh ? "桌面端可安全保存 API Token；浏览器模式只填写已有引用。" : "The desktop app can store the API Token securely. Browser mode accepts an existing reference only."}><Input value={reference} placeholder="credential://cloudflare/main" onChange={(event) => onReference(event.target.value)} /></CredentialSettingField>;
  if (status?.ready) return <div className="rounded-lg border border-success/30 bg-success/5 p-3"><div className="flex items-center gap-2 text-sm font-medium text-success"><ShieldCheck className="size-4" />{zh ? "Cloudflare API Token 已安全保存在本机" : "Cloudflare API Token secured on this device"}</div><p className="mt-1 font-mono text-xs text-muted-foreground">{status.reference}</p><Button className="mt-3" size="sm" variant="ghost" disabled={pending} onClick={() => void remove()}><Trash2 />{zh ? "移除连接" : "Remove connection"}</Button></div>;
  return <div className="space-y-2 rounded-lg border border-border p-3"><div><p className="text-sm font-medium">{zh ? "1. 安全连接 Cloudflare" : "1. Securely connect Cloudflare"}</p><p className="mt-1 text-xs text-muted-foreground">{zh ? "请使用仅授予 Cloudflare Pages 编辑权限的 API Token。数据经系统安全存储加密，页面和站点状态只保留引用。" : "Use an API Token limited to Cloudflare Pages edit access. It is encrypted by OS secure storage; pages and site state retain only a reference."}</p></div>{status?.stored && !status.ready ? <p role="alert" className="text-xs text-warning">{zh ? "已保存的连接当前无法使用，请重新填写并保存。" : "The saved connection is unavailable. Enter it again to reconnect."}</p> : null}{status && !status.secureStorage ? <p role="alert" className="text-xs text-destructive">{zh ? "当前系统没有可用的安全存储。" : "Secure OS storage is unavailable."}</p> : <><Input aria-label="Cloudflare Account ID" autoComplete="off" value={accountId} placeholder="32-character Account ID" onChange={(event) => setAccountId(event.target.value)} /><Input aria-label="Cloudflare API Token" type="password" autoComplete="new-password" value={apiToken} placeholder="API Token" onChange={(event) => setApiToken(event.target.value)} /><Button size="sm" disabled={pending || !accountId.trim() || !apiToken.trim()} onClick={() => void save()}>{pending ? <Loader2 className="animate-spin" /> : <KeyRound />}{zh ? "安全保存连接" : "Save secure connection"}</Button></>}{error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}</div>;
}

export function AliyunOssCredentialField({ zh, reference, onReference }: ReferencedCredentialFieldProps) {
  const bridge = window.myagenttoolDesktop;
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [accessKeyId, setAccessKeyId] = useState("");
  const [accessKeySecret, setAccessKeySecret] = useState("");
  const [securityToken, setSecurityToken] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!bridge?.getAliyunOssCredentialStatus) return;
    void bridge.getAliyunOssCredentialStatus().then((next) => {
      if (!active) return;
      setStatus(next);
      if (next.ready && next.reference) onReference(next.reference);
      else if (next.stored && !next.ready) onReference("");
    }).catch(() => { if (active) setError(zh ? "无法读取本机安全存储。" : "Could not read secure storage."); });
    return () => { active = false; };
  }, [bridge, onReference, zh]);

  async function save() {
    if (!bridge?.saveAliyunOssCredential) return;
    setPending(true); setError(null);
    const result = await bridge.saveAliyunOssCredential({ accessKeyId, accessKeySecret, ...(securityToken ? { securityToken } : {}) }).catch(() => ({ ok: false as const, error: "save_failed" as const }));
    setPending(false);
    if (!result.ok) {
      setError(result.error === "secure_storage_unavailable" ? (zh ? "系统安全存储不可用，未保存任何凭据。" : "OS secure storage is unavailable; nothing was saved.") : (zh ? "AccessKey 格式不正确或保存失败。" : "The AccessKey is invalid or could not be saved."));
      return;
    }
    onReference(result.reference);
    setStatus({ secureStorage: true, stored: true, ready: true, reference: result.reference });
    setAccessKeyId(""); setAccessKeySecret(""); setSecurityToken("");
  }

  async function remove() {
    if (!bridge?.removeAliyunOssCredential) return;
    setPending(true); setError(null);
    const result = await bridge.removeAliyunOssCredential().catch(() => ({ ok: false as const, error: "remove_failed" as const }));
    setPending(false);
    if (!result.ok) { setError(zh ? "暂时无法移除安全连接。" : "The secure connection could not be removed."); return; }
    onReference("");
    setStatus({ secureStorage: true, stored: false, ready: false, reference: null });
  }

  if (!bridge?.getAliyunOssCredentialStatus) return <CredentialSettingField label={zh ? "安全连接引用" : "Secure connection reference"} hint={zh ? "桌面端可安全保存 AccessKey；浏览器模式只填写已有引用。" : "The desktop app can store the AccessKey securely. Browser mode accepts an existing reference only."}><Input value={reference} placeholder="credential://aliyun/main" onChange={(event) => onReference(event.target.value)} /></CredentialSettingField>;
  if (status?.ready) return <div className="rounded-lg border border-success/30 bg-success/5 p-3"><div className="flex items-center gap-2 text-sm font-medium text-success"><ShieldCheck className="size-4" />{zh ? "AccessKey 已安全保存在本机" : "AccessKey secured on this device"}</div><p className="mt-1 font-mono text-xs text-muted-foreground">{status.reference}</p><Button className="mt-3" size="sm" variant="ghost" disabled={pending} onClick={() => void remove()}><Trash2 />{zh ? "移除连接" : "Remove connection"}</Button></div>;
  return <div className="space-y-2 rounded-lg border border-border p-3"><div><p className="text-sm font-medium">{zh ? "1. 安全连接阿里云" : "1. Securely connect Alibaba Cloud"}</p><p className="mt-1 text-xs text-muted-foreground">{zh ? "数据经系统安全存储加密；页面、日志和站点状态只保留引用。可以稍后再填写。" : "Protected by OS secure storage; pages, logs, and site state retain only a reference. You can fill this later."}</p></div>{status?.stored && !status.ready ? <p role="alert" className="text-xs text-warning">{zh ? "已保存的 OSS 连接当前无法使用，请重新填写并保存。" : "The saved OSS connection is unavailable. Enter it again to reconnect."}</p> : null}{status && !status.secureStorage ? <p role="alert" className="text-xs text-destructive">{zh ? "当前系统没有可用的安全存储。" : "Secure OS storage is unavailable."}</p> : <><Input aria-label="AccessKey ID" autoComplete="off" value={accessKeyId} placeholder="AccessKey ID" onChange={(event) => setAccessKeyId(event.target.value)} /><Input aria-label="AccessKey Secret" type="password" autoComplete="new-password" value={accessKeySecret} placeholder="AccessKey Secret" onChange={(event) => setAccessKeySecret(event.target.value)} /><Input aria-label={zh ? "STS SecurityToken（可选）" : "STS SecurityToken (optional)"} type="password" autoComplete="new-password" value={securityToken} placeholder={zh ? "STS SecurityToken（可选）" : "STS SecurityToken (optional)"} onChange={(event) => setSecurityToken(event.target.value)} /><Button size="sm" disabled={pending || !accessKeyId.trim() || !accessKeySecret.trim()} onClick={() => void save()}>{pending ? <Loader2 className="animate-spin" /> : <KeyRound />}{zh ? "安全保存连接" : "Save secure connection"}</Button></>}{error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}</div>;
}

export function AliDnsCredentialField({ zh }: { zh: boolean }) {
  const bridge = window.myagenttoolDesktop;
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [accessKeyId, setAccessKeyId] = useState("");
  const [accessKeySecret, setAccessKeySecret] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!bridge?.getAliDnsCredentialStatus) return;
    void bridge.getAliDnsCredentialStatus().then((next) => {
      if (active) setStatus(next);
    }).catch(() => { if (active) setError(zh ? "无法读取 AliDNS 安全连接。" : "Could not read the secure AliDNS connection."); });
    return () => { active = false; };
  }, [bridge, zh]);

  async function save() {
    if (!bridge?.saveAliDnsCredential) return;
    setPending(true); setError(null);
    const result = await bridge.saveAliDnsCredential({ accessKeyId, accessKeySecret }).catch(() => ({ ok: false as const, error: "save_failed" as const }));
    setPending(false);
    if (!result.ok) {
      setError(result.error === "secure_storage_unavailable" ? (zh ? "系统安全存储不可用，未保存任何凭据。" : "OS secure storage is unavailable; nothing was saved.") : (zh ? "AliDNS AccessKey 格式不正确或保存失败。" : "The AliDNS AccessKey is invalid or could not be saved."));
      return;
    }
    setStatus({ secureStorage: true, stored: true, ready: true, reference: result.reference });
    setAccessKeyId(""); setAccessKeySecret("");
  }

  async function remove() {
    if (!bridge?.removeAliDnsCredential) return;
    setPending(true); setError(null);
    const result = await bridge.removeAliDnsCredential().catch(() => ({ ok: false as const, error: "remove_failed" as const }));
    setPending(false);
    if (!result.ok) { setError(zh ? "暂时无法移除 AliDNS 安全连接。" : "The secure AliDNS connection could not be removed."); return; }
    setStatus({ secureStorage: true, stored: false, ready: false, reference: null });
  }

  if (!bridge?.getAliDnsCredentialStatus) return <div className="space-y-2 rounded-lg border border-border p-3"><div><p className="text-sm font-medium">{zh ? "域名与 HTTPS · 阿里云 DNS" : "Domain and HTTPS · Alibaba Cloud DNS"}</p><p className="mt-1 text-xs text-muted-foreground">{zh ? "浏览器模式由运行环境提供最小权限凭据；项目只使用固定引用。" : "In browser mode, the runtime supplies the least-privilege credential and the project uses only its fixed reference."}</p></div><CredentialSettingField label={zh ? "AliDNS 凭据引用" : "AliDNS credential reference"}><Input readOnly value="credential://alidns/main" /></CredentialSettingField></div>;
  if (status?.ready) return <div className="rounded-lg border border-success/30 bg-success/5 p-3"><div className="flex items-center gap-2 text-sm font-medium text-success"><ShieldCheck className="size-4" />{zh ? "AliDNS AccessKey 已安全保存在本机" : "AliDNS AccessKey secured on this device"}</div><p className="mt-1 font-mono text-xs text-muted-foreground">{status.reference}</p><p className="mt-2 text-xs text-muted-foreground">{zh ? "本阶段只完成安全保存；权限测试和证书签发将在下一阶段启用。" : "This stage only stores the credential securely. Permission testing and certificate issuance follow in the next stage."}</p><Button className="mt-3" size="sm" variant="ghost" disabled={pending} onClick={() => void remove()}><Trash2 />{zh ? "移除 AliDNS 连接" : "Remove AliDNS connection"}</Button></div>;
  return <div className="space-y-2 rounded-lg border border-border p-3"><div><p className="text-sm font-medium">{zh ? "域名与 HTTPS · 安全连接阿里云 DNS" : "Domain and HTTPS · Securely connect Alibaba Cloud DNS"}</p><p className="mt-1 text-xs text-muted-foreground">{zh ? "请使用仅允许管理目标域名 DNS 记录的 RAM AccessKey。凭据由系统安全存储加密，不会进入站点目标或日志。" : "Use a RAM AccessKey limited to DNS records for the target domain. OS secure storage encrypts it; it is not copied into the deployment target or logs."}</p></div>{status?.stored && !status.ready ? <p role="alert" className="text-xs text-warning">{zh ? "已保存的 AliDNS 连接当前无法注入服务，请重新填写。" : "The saved AliDNS connection cannot currently be injected into the service. Enter it again."}</p> : null}{status && !status.secureStorage ? <p role="alert" className="text-xs text-destructive">{zh ? "当前系统没有可用的安全存储。" : "Secure OS storage is unavailable."}</p> : <><Input aria-label="AliDNS AccessKey ID" autoComplete="off" value={accessKeyId} placeholder="AccessKey ID" onChange={(event) => setAccessKeyId(event.target.value)} /><Input aria-label="AliDNS AccessKey Secret" type="password" autoComplete="new-password" value={accessKeySecret} placeholder="AccessKey Secret" onChange={(event) => setAccessKeySecret(event.target.value)} /><Button size="sm" disabled={pending || !accessKeyId.trim() || !accessKeySecret.trim()} onClick={() => void save()}>{pending ? <Loader2 className="animate-spin" /> : <KeyRound />}{zh ? "安全保存 AliDNS 连接" : "Save AliDNS connection"}</Button></>}{error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}</div>;
}
