import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  ChevronRight,
  File,
  Folder,
  FolderLock,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { SectionHeading } from "@/components/common/section-heading";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { ApiError } from "@/lib/api/request";
import { useUiStore } from "@/store/ui-store";
import { MAX_HOST_DOWNLOAD_BYTES, MAX_HOST_UPLOAD_BYTES, hostApi } from "./host-api";
import type { HostAuthMethod, HostFileConflictPolicy, HostFileEntry, HostFileScope, HostFileScopePurpose, HostFileTransfer, SshHost } from "./host-types";

type DetailTab = "overview" | "files" | "transfers" | "settings";

function errorText(error: unknown, zh: boolean) {
  const code = error instanceof ApiError ? error.code : "";
  const messages: Record<string, [string, string]> = {
    secure_storage_unavailable: ["当前系统安全存储不可用，不能保存主机凭据。", "OS secure storage is unavailable, so this credential cannot be saved."],
    ssh_host_private_network_blocked: ["这是私网地址，请返回连接资料并明确允许私网访问。", "This is a private address. Return to connection details and explicitly allow private-network access."],
    ssh_host_fingerprint_changed: ["主机指纹已变化。为保护文件，连接已阻断。", "The host fingerprint changed. The connection was blocked to protect remote files."],
    ssh_authentication_failed: ["凭据未获主机接受，请重新保存正确的私钥或密码。", "The host did not accept the credential. Save the correct private key or password and retry."],
    ssh_credential_unavailable: ["此电脑尚未准备好该主机的安全凭据。", "This computer has not prepared a secure credential for this host."],
    host_file_scope_symlink_forbidden: ["目录路径经过符号链接，请选择真实的专用目录。", "The directory passes through a symbolic link. Choose a dedicated real directory."],
    host_file_scope_escape_blocked: ["远程目录已偏离批准范围，浏览已停止。", "The remote directory moved outside its approved range, so browsing stopped."],
    host_file_listing_too_large: ["该目录项目过多，请先在主机上整理为更小的子目录。", "This directory has too many items. Organize it into smaller subdirectories first."],
    host_file_conflict: ["远端已有同名文件，请选择保留两份或明确确认覆盖。", "A remote file has the same name. Keep both or explicitly confirm replacement."],
    host_file_upload_size_invalid: ["文件为空或超过 10 MB 上传上限。", "The file is empty or exceeds the 10 MB upload limit."],
    host_file_download_size_invalid: ["该文件超过 25 MB 浏览器安全下载上限。", "The file exceeds the 25 MB safe browser download limit."],
    host_file_download_sensitive_blocked: ["该文件可能包含密钥或环境凭据，禁止通过浏览器下载。", "This file may contain keys or environment credentials and cannot be downloaded in the browser."],
    host_file_atomic_replace_unavailable: ["此主机不支持安全的原子覆盖，请改为“保留两份”。", "This host cannot replace files atomically. Choose Keep both."],
    host_file_transfer_retry_limit: ["该任务已达到最多 3 次尝试，请检查主机后重新发起。", "This task reached the three-attempt limit. Check the host and start a new transfer."],
  };
  if (messages[code]) return messages[code][zh ? 0 : 1];
  return error instanceof Error ? error.message : (zh ? "操作未能完成。" : "The operation could not be completed.");
}

function hostStatus(host: SshHost, zh: boolean) {
  if (host.connectionStatus === "ready") return { tone: "success" as const, label: zh ? "连接正常" : "Ready" };
  if (host.connectionStatus === "fingerprint_pending") return { tone: "warning" as const, label: zh ? "等待确认指纹" : "Confirm fingerprint" };
  if (host.connectionStatus === "error") return { tone: "danger" as const, label: zh ? "需要检查" : "Needs attention" };
  return { tone: "neutral" as const, label: zh ? "尚未完成设置" : "Setup incomplete" };
}

export function MyHostsView() {
  const { i18n } = useAppTranslation();
  const zh = i18n.language.startsWith("zh");
  const professional = useUiStore((state) => state.experienceMode) === "professional";
  const setExperienceMode = useUiStore((state) => state.setExperienceMode);
  const queryClient = useQueryClient();
  const hosts = useQuery({ queryKey: ["my-hosts"], queryFn: hostApi.list, enabled: professional });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [setupOpen, setSetupOpen] = useState(false);
  const selected = hosts.data?.hosts.find((host) => host.id === selectedId) ?? hosts.data?.hosts[0] ?? null;

  useEffect(() => {
    if (!selectedId && hosts.data?.hosts[0]) setSelectedId(hosts.data.hosts[0].id);
  }, [hosts.data?.hosts, selectedId]);

  const refresh = async () => queryClient.invalidateQueries({ queryKey: ["my-hosts"] });
  const copy = zh ? {
    eyebrow: "我的设置 · 专业能力", title: "我的主机", description: "安全连接自有主机，并把远程文件限制在经过验证的专用目录内。",
    add: "添加主机", empty: "尚未添加主机", emptyHint: "添加后会依次保存安全凭据、确认主机指纹，并配置受控文件范围。",
  } : {
    eyebrow: "My settings · Professional", title: "My hosts", description: "Connect self-hosted servers and keep remote access inside verified dedicated directories.",
    add: "Add host", empty: "No hosts yet", emptyHint: "Add one to save a secure credential, confirm its fingerprint, and configure a governed file range.",
  };

  if (!professional) return <div className="space-y-5"><SectionHeading eyebrow={copy.eyebrow} title={copy.title} description={copy.description} /><Notice title={zh ? "此页面属于专业模式" : "This page belongs to Professional mode"} detail={zh ? "主机、SSH、远程目录和指纹等技术配置不会出现在普通视图。" : "Technical host, SSH, remote-directory, and fingerprint settings stay out of Ordinary views."} action={<Button onClick={() => setExperienceMode("professional")}><ShieldCheck />{zh ? "开启专业模式" : "Enable Professional mode"}</Button>} /></div>;

  if (hosts.isLoading) return <Notice title={zh ? "正在读取主机…" : "Loading hosts…"} loading />;
  if (hosts.error) return <Notice title={zh ? "暂时无法读取主机" : "Hosts are temporarily unavailable"} detail={errorText(hosts.error, zh)} action={<Button variant="secondary" onClick={() => void hosts.refetch()}><RefreshCw />{zh ? "重试" : "Retry"}</Button>} />;

  return <div className="space-y-5">
    <SectionHeading eyebrow={copy.eyebrow} title={copy.title} description={copy.description} actions={<Button onClick={() => { setSelectedId(null); setSetupOpen(true); }}><Plus />{copy.add}</Button>} />
    {!hosts.data?.hosts.length ? <Notice title={copy.empty} detail={copy.emptyHint} action={<Button onClick={() => setSetupOpen(true)}><Plus />{copy.add}</Button>} /> : (
      <div className="grid min-h-[480px] gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
        <Card className="h-fit"><CardContent className="p-2">{hosts.data.hosts.map((host) => {
          const status = hostStatus(host, zh);
          return <button key={host.id} type="button" onClick={() => { setSelectedId(host.id); setTab("overview"); }} className={`w-full rounded-lg p-3 text-left transition-colors ${selected?.id === host.id ? "bg-primary/10" : "hover:bg-muted"}`}>
            <span className="flex items-center gap-2"><Server className="size-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-sm font-medium">{host.name}</span></span>
            <span className="mt-2 flex items-center justify-between gap-2"><StatusBadge tone={status.tone}>{status.label}</StatusBadge><span className="truncate font-mono text-[11px] text-muted-foreground">{host.host}</span></span>
          </button>;
        })}</CardContent></Card>
        {selected ? <HostDetail host={selected} tab={tab} setTab={setTab} zh={zh} onContinue={() => setSetupOpen(true)} /> : null}
      </div>
    )}
    <HostSetupDialog open={setupOpen} initialHost={selectedId ? selected : null} zh={zh} onClose={() => setSetupOpen(false)} onChanged={refresh} />
  </div>;
}

function HostDetail({ host, tab, setTab, zh, onContinue }: { host: SshHost; tab: DetailTab; setTab: (tab: DetailTab) => void; zh: boolean; onContinue: () => void }) {
  const scopes = useQuery({ queryKey: ["my-host-scopes", host.id], queryFn: () => hostApi.scopes(host.id) });
  const labels: Record<DetailTab, string> = zh
    ? { overview: "概览", files: "远程文件", transfers: "传输任务", settings: "设置" }
    : { overview: "Overview", files: "Remote files", transfers: "Transfers", settings: "Settings" };
  const status = hostStatus(host, zh);
  return <Card className="min-w-0"><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{host.name}</CardTitle><p className="mt-1 font-mono text-xs text-muted-foreground">{host.user}@{host.host}:{host.port}</p></div><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div><div className="mt-3 flex flex-wrap gap-1 border-b">{(Object.keys(labels) as DetailTab[]).map((key) => <button key={key} type="button" onClick={() => setTab(key)} className={`border-b-2 px-3 py-2 text-sm ${tab === key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{labels[key]}</button>)}</div></CardHeader>
    <CardContent>
      {tab === "overview" ? <HostOverview host={host} scopeCount={scopes.data?.count ?? 0} zh={zh} onContinue={onContinue} /> : null}
      {tab === "files" ? <RemoteFiles host={host} scopes={scopes.data?.scopes ?? []} loading={scopes.isLoading} error={scopes.error} zh={zh} onAdd={onContinue} /> : null}
      {tab === "transfers" ? <TransferHistory host={host} scopes={scopes.data?.scopes ?? []} zh={zh} /> : null}
      {tab === "settings" ? <HostTechnicalSettings host={host} zh={zh} /> : null}
    </CardContent>
  </Card>;
}

function HostOverview({ host, scopeCount, zh, onContinue }: { host: SshHost; scopeCount: number; zh: boolean; onContinue: () => void }) {
  const ready = host.connectionStatus === "ready";
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3">
      <Summary icon={ready ? CheckCircle2 : TriangleAlert} label={zh ? "连接" : "Connection"} value={ready ? (zh ? "已验证" : "Verified") : (zh ? "未完成" : "Incomplete")} />
      <Summary icon={FolderLock} label={zh ? "文件范围" : "File ranges"} value={zh ? `${scopeCount} 个` : String(scopeCount)} />
      <Summary icon={ShieldCheck} label={zh ? "访问方式" : "Access"} value={zh ? "范围内受控传输" : "Governed transfers"} />
    </div>
    {!ready || !scopeCount ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4"><div><p className="text-sm font-medium">{!ready ? (zh ? "继续完成安全连接" : "Complete secure connection") : (zh ? "添加一个文件范围" : "Add a file range")}</p><p className="mt-1 text-xs text-muted-foreground">{!ready ? (zh ? "保存凭据、确认指纹并验证 SFTP。" : "Save a credential, confirm the fingerprint, and verify SFTP.") : (zh ? "只有批准目录内的文件可以被查看。" : "Only files inside an approved directory can be viewed.")}</p></div><Button onClick={onContinue}>{zh ? "继续设置" : "Continue setup"}<ChevronRight /></Button></div> : null}
    {host.lastConnectionError ? <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{zh ? "上次连接未完成：" : "Last connection did not complete: "}{host.lastConnectionError.code}</p> : null}
  </div>;
}

function Summary({ icon: Icon, label, value }: { icon: typeof Server; label: string; value: string }) {
  return <div className="rounded-lg border p-3"><Icon className="size-5 text-primary" /><p className="mt-3 text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>;
}

function RemoteFiles({ host, scopes, loading, error, zh, onAdd }: { host: SshHost; scopes: HostFileScope[]; loading: boolean; error: unknown; zh: boolean; onAdd: () => void }) {
  const [scopeId, setScopeId] = useState<string>("");
  useEffect(() => { if (!scopeId && scopes[0]) setScopeId(scopes[0].id); }, [scopeId, scopes]);
  if (loading) return <Notice title={zh ? "正在读取文件范围…" : "Loading file ranges…"} loading />;
  if (error) return <Notice title={zh ? "无法读取文件范围" : "File ranges unavailable"} detail={errorText(error, zh)} />;
  if (!scopes.length) return <Notice title={zh ? "尚未配置文件范围" : "No file range configured"} detail={zh ? "请选择主机管理员准备好的专用目录。系统不会允许浏览主目录或系统目录。" : "Choose a dedicated directory prepared by the host administrator. Home and system directories are not allowed."} action={<Button disabled={host.connectionStatus !== "ready"} onClick={onAdd}><Plus />{zh ? "添加文件范围" : "Add file range"}</Button>} />;
  const scope = scopes.find((item) => item.id === scopeId) ?? scopes[0];
  const transferEnabled = scope.permissions.includes("upload") || scope.permissions.includes("download");
  const certificateOnly = scope.purpose === "tls_certificate";
  return <div className="space-y-3"><div className="flex flex-wrap items-center gap-2"><Select aria-label={zh ? "选择文件范围" : "Select file range"} value={scope.id} onChange={(event) => setScopeId(event.target.value)} className="max-w-xs">{scopes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select><StatusBadge tone={scope.status === "ready" ? "success" : "warning"}>{scope.status === "ready" ? (certificateOnly ? (zh ? "证书专用" : "Certificate only") : transferEnabled ? (zh ? "受控传输" : "Governed transfer") : (zh ? "只读范围" : "Read-only range")) : (zh ? "已停用" : "Disabled")}</StatusBadge><ScopeEditButton host={host} scope={scope} zh={zh} /><Button size="sm" variant="secondary" onClick={onAdd}><Plus />{zh ? "添加范围" : "Add range"}</Button></div>{scope.status === "ready" ? certificateOnly ? <TlsActivationProfiles host={host} scope={scope} zh={zh} /> : <FileBrowser key={scope.id} scope={scope} zh={zh} /> : <Notice title={zh ? "此文件范围已停用" : "This file range is disabled"} detail={zh ? "在“范围设置”中重新启用后才能浏览。" : "Enable it again in Range settings before browsing."} />}</div>;
}

function TlsActivationProfiles({ host, scope, zh }: { host: SshHost; scope: HostFileScope; zh: boolean }) {
  const queryClient = useQueryClient();
  const [containerName, setContainerName] = useState("");
  const profiles = useQuery({ queryKey: ["host-tls-profiles", host.id], queryFn: () => hostApi.tlsProfiles(host.id), retry: false });
  const create = useMutation({
    mutationFn: () => hostApi.createTlsProfile(host.id, { label: `${scope.label} · Nginx`, certificateScopeId: scope.id, containerName }),
    onSuccess: async () => { setContainerName(""); await queryClient.invalidateQueries({ queryKey: ["host-tls-profiles", host.id] }); },
  });
  const matching = profiles.data?.profiles.filter((profile) => profile.certificateScopeId === scope.id) ?? [];
  return <div className="space-y-4 rounded-lg border p-4"><div><p className="text-sm font-medium">{zh ? "证书专用范围不可浏览或下载" : "Certificate-only range cannot be browsed or downloaded"}</p><p className="mt-1 text-xs text-muted-foreground">{zh ? "只有证书管理器能写入固定文件名。先由主机管理员准备专用 Docker Nginx 容器，再登记容器名称；系统不会接受 Shell 或 Nginx 配置片段。" : "Only the certificate manager can write fixed filenames. Have the host administrator prepare a dedicated Docker Nginx container, then register its name. Shell commands and Nginx snippets are not accepted."}</p></div>{matching.map((profile) => <div key={profile.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3"><span><span className="block text-sm font-medium">{profile.label}</span><code className="text-xs text-muted-foreground">{profile.containerName}</code></span><StatusBadge tone={profile.status === "ready" ? "success" : "warning"}>{profile.status === "ready" ? (zh ? "已验证" : "Verified") : profile.status}</StatusBadge></div>)}<div className="flex flex-wrap items-end gap-2"><Field label={zh ? "Docker Nginx 容器名称" : "Docker Nginx container name"}><Input value={containerName} placeholder="myagenttool-site-nginx" onChange={(event) => setContainerName(event.target.value)} /></Field><Button disabled={!containerName.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}{zh ? "验证固定激活配置" : "Verify fixed activation"}</Button></div>{profiles.error || create.error ? <p role="alert" className="text-sm text-destructive">{errorText(profiles.error ?? create.error, zh)}</p> : null}</div>;
}

function ScopeEditButton({ host, scope, zh }: { host: SshHost; scope: HostFileScope; zh: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ label: scope.label, rootPath: scope.rootPath, purpose: scope.purpose, disabled: scope.status === "disabled", upload: scope.permissions.includes("upload"), download: scope.permissions.includes("download") });
  useEffect(() => setForm({ label: scope.label, rootPath: scope.rootPath, purpose: scope.purpose, disabled: scope.status === "disabled", upload: scope.permissions.includes("upload"), download: scope.permissions.includes("download") }), [scope]);
  const mutation = useMutation({
    mutationFn: () => hostApi.updateScope(host.id, scope.id, { expectedRevision: scope.revision, label: form.label, rootPath: form.rootPath, purpose: form.purpose, status: form.disabled ? "disabled" : "ready", permissions: ["list", ...(form.upload ? ["upload" as const] : []), ...(form.download ? ["download" as const] : [])] }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["my-host-scopes", host.id] }); await queryClient.invalidateQueries({ queryKey: ["host-file-entries", scope.id] }); setOpen(false); },
  });
  return <><Button size="sm" variant="ghost" onClick={() => setOpen(true)}>{zh ? "范围设置" : "Range settings"}</Button><Modal open={open} onClose={() => setOpen(false)} title={zh ? "文件范围设置" : "File range settings"} description={zh ? "更改目录会重新连接主机，并再次验证完整路径边界。传输权限可随时单独关闭。" : "Changing the directory reconnects and verifies the path boundary again. Transfer permissions can be disabled independently."} footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>{zh ? "取消" : "Cancel"}</Button><Button disabled={!form.label.trim() || !form.rootPath.trim() || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}{zh ? "验证并保存" : "Verify and save"}</Button></div>}><div className="space-y-3"><Field label={zh ? "范围名称" : "Range name"}><Input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} /></Field><Field label={zh ? "远程目录" : "Remote directory"}><Input className="font-mono" value={form.rootPath} onChange={(event) => setForm({ ...form, rootPath: event.target.value })} /></Field><Field label={zh ? "用途" : "Purpose"}><Select value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value as HostFileScopePurpose })}><option value="site_publish">{zh ? "站点发布" : "Site publishing"}</option><option value="tls_certificate">{zh ? "HTTPS 证书专用" : "HTTPS certificates only"}</option><option value="general_files">{zh ? "普通文件" : "General files"}</option><option value="backup">{zh ? "备份" : "Backup"}</option></Select></Field>{form.purpose === "tls_certificate" ? <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{zh ? "此范围不开放浏览、上传或下载，只供证书管理器写入。" : "This range does not allow browsing, uploads, or downloads. Only the certificate manager can write to it."}</p> : <div className="rounded-lg border p-3"><p className="mb-2 text-sm font-medium">{zh ? "允许的操作" : "Allowed operations"}</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.upload} onChange={(event) => setForm({ ...form, upload: event.target.checked })} />{zh ? "允许确认后上传（单文件最大 10 MB）" : "Allow confirmed uploads (10 MB per file)"}</label><label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.download} onChange={(event) => setForm({ ...form, download: event.target.checked })} />{zh ? "允许确认后下载（单文件最大 25 MB）" : "Allow confirmed downloads (25 MB per file)"}</label></div>}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.disabled} onChange={(event) => setForm({ ...form, disabled: event.target.checked })} />{zh ? "暂时停用此范围" : "Temporarily disable this range"}</label>{mutation.error ? <p role="alert" className="text-sm text-destructive">{errorText(mutation.error, zh)}</p> : null}</div></Modal></>;
}

function FileBrowser({ scope, zh }: { scope: HostFileScope; zh: boolean }) {
  const [path, setPath] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [downloadEntry, setDownloadEntry] = useState<HostFileEntry | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const query = useQuery({ queryKey: ["host-file-entries", scope.id, path], queryFn: () => hostApi.entries(scope.id, path), retry: false });
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const refresh = () => query.refetch();
  return <><div className="overflow-hidden rounded-lg border"><div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2"><FolderLock className="size-4 text-muted-foreground" /><span className="text-xs font-medium">{scope.label}</span><code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">/{path}</code>{scope.permissions.includes("upload") ? <><input ref={uploadInput} className="hidden" type="file" onChange={(event) => { const file = event.target.files?.[0] ?? null; event.target.value = ""; setUploadFile(file); }} /><Button size="sm" variant="secondary" onClick={() => uploadInput.current?.click()}><ArrowUpFromLine />{zh ? "上传" : "Upload"}</Button></> : null}{path ? <Button size="sm" variant="ghost" onClick={() => setPath(parent)}><ArrowLeft />{zh ? "上一级" : "Up"}</Button> : null}</div>
    {query.isLoading ? <div className="p-6 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 size-5 animate-spin" />{zh ? "正在安全读取目录…" : "Reading directory safely…"}</div> : query.error ? <Notice title={zh ? "目录未能打开" : "Directory could not be opened"} detail={errorText(query.error, zh)} action={<Button size="sm" variant="secondary" onClick={() => void query.refetch()}><RefreshCw />{zh ? "重试" : "Retry"}</Button>} /> : !query.data?.entries.length ? <div className="p-6 text-center text-sm text-muted-foreground">{zh ? "此目录为空。" : "This directory is empty."}</div> : null}
    {query.data?.entries?.length ? <div className="divide-y">{query.data.entries.map((entry) => <FileRow key={entry.path} entry={entry} zh={zh} canDownload={scope.permissions.includes("download")} onDownload={() => setDownloadEntry(entry)} onOpen={() => entry.type === "directory" && entry.accessible ? setPath(entry.path) : undefined} />)}</div> : null}
  </div><TransferConfirmDialog scope={scope} directory={path} uploadFile={uploadFile} downloadEntry={downloadEntry} zh={zh} onClose={() => { setUploadFile(null); setDownloadEntry(null); }} onCompleted={refresh} /></>;
}

function FileRow({ entry, zh, canDownload, onDownload, onOpen }: { entry: HostFileEntry; zh: boolean; canDownload: boolean; onDownload: () => void; onOpen: () => void }) {
  const directory = entry.type === "directory";
  const blocked = !entry.accessible;
  return <div className="flex w-full items-center gap-3 px-3 py-2.5"><span className="grid size-8 place-items-center rounded-md bg-muted">{directory ? <Folder className="size-4 text-primary" /> : blocked ? <FolderLock className="size-4 text-muted-foreground" /> : <File className="size-4 text-muted-foreground" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{entry.name}</span><span className="block text-xs text-muted-foreground">{blocked ? (zh ? "安全限制：不可打开" : "Restricted: cannot open") : directory ? (zh ? "文件夹" : "Folder") : formatBytes(entry.size ?? 0)}</span></span>{directory && !blocked ? <Button size="sm" variant="ghost" onClick={onOpen}>{zh ? "打开" : "Open"}<ChevronRight /></Button> : !directory && !blocked && canDownload ? <Button size="sm" variant="ghost" onClick={onDownload}><ArrowDownToLine />{zh ? "下载" : "Download"}</Button> : null}</div>;
}

function TransferConfirmDialog({ scope, directory, uploadFile, downloadEntry, retryOf = null, zh, onClose, onCompleted }: { scope: HostFileScope; directory: string; uploadFile: File | null; downloadEntry: HostFileEntry | null; retryOf?: string | null; zh: boolean; onClose: () => void; onCompleted: () => Promise<unknown> }) {
  const queryClient = useQueryClient();
  const [policy, setPolicy] = useState<HostFileConflictPolicy>("rename");
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [progress, setProgress] = useState(0);
  const mode = uploadFile ? "upload" : downloadEntry ? "download" : null;
  useEffect(() => { setPolicy("rename"); setReplaceConfirmed(false); setProgress(0); }, [uploadFile, downloadEntry]);
  const mutation = useMutation({
    mutationFn: async () => {
      if (uploadFile) return hostApi.upload(scope.id, uploadFile, { directory, conflictPolicy: policy, overwriteConfirmed: policy === "replace" && replaceConfirmed, retryOf, onProgress: setProgress });
      if (downloadEntry) {
        const result = await hostApi.download(scope.id, { path: downloadEntry.path, retryOf, onProgress: setProgress });
        saveDownload(result.blob, result.fileName);
        return result;
      }
      throw new Error("transfer_missing");
    },
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["host-file-transfers", scope.sshTargetId] }), onCompleted()]);
      onClose();
    },
  });
  const size = uploadFile?.size ?? downloadEntry?.size ?? 0;
  const tooLarge = mode === "upload" ? size < 1 || size > MAX_HOST_UPLOAD_BYTES : size > MAX_HOST_DOWNLOAD_BYTES;
  return <Modal open={Boolean(mode)} onClose={() => !mutation.isPending && onClose()} title={mode === "upload" ? (zh ? "确认上传" : "Confirm upload") : (zh ? "确认下载" : "Confirm download")} description={zh ? "请核对文件和远程位置。确认后才会连接主机。" : "Review the file and remote location. The host is contacted only after confirmation."} footer={<div className="flex justify-end gap-2"><Button variant="secondary" disabled={mutation.isPending} onClick={onClose}>{zh ? "取消" : "Cancel"}</Button><Button disabled={mutation.isPending || tooLarge || (policy === "replace" && !replaceConfirmed)} onClick={() => mutation.mutate()}>{mutation.isPending ? <Loader2 className="animate-spin" /> : mode === "upload" ? <ArrowUpFromLine /> : <ArrowDownToLine />}{zh ? "确认并开始" : "Confirm and start"}</Button></div>}><div className="space-y-4"><div className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-[100px_1fr]"><span className="text-muted-foreground">{zh ? "文件" : "File"}</span><strong className="break-all">{uploadFile?.name ?? downloadEntry?.name}</strong><span className="text-muted-foreground">{zh ? "大小" : "Size"}</span><span>{formatBytes(size)}</span><span className="text-muted-foreground">{zh ? "远程位置" : "Remote path"}</span><code className="break-all">{scope.rootPath}/{mode === "upload" ? [directory, uploadFile?.name].filter(Boolean).join("/") : downloadEntry?.path}</code></div>{mode === "upload" ? <Field label={zh ? "遇到同名文件" : "If the file exists"}><Select value={policy} onChange={(event) => { setPolicy(event.target.value as HostFileConflictPolicy); setReplaceConfirmed(false); }}><option value="rename">{zh ? "保留两份（推荐）" : "Keep both (recommended)"}</option><option value="deny">{zh ? "停止上传，不做改动" : "Stop without changes"}</option><option value="replace">{zh ? "安全覆盖原文件" : "Safely replace existing file"}</option></Select></Field> : <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{zh ? "下载始终作为附件保存，不会在页面中执行。密钥、环境凭据及超过 25 MB 的文件会被阻止。" : "Downloads are always saved as attachments and never executed in the page. Keys, environment credentials, and files over 25 MB are blocked."}</p>}{policy === "replace" && mode === "upload" ? <label className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm"><input className="mt-1" type="checkbox" checked={replaceConfirmed} onChange={(event) => setReplaceConfirmed(event.target.checked)} /><span>{zh ? "我确认覆盖同名普通文件；若主机不支持原子替换，系统会安全停止。" : "I confirm replacement of a same-named regular file. The operation stops safely if atomic replacement is unavailable."}</span></label> : null}{tooLarge ? <p role="alert" className="text-sm text-destructive">{mode === "upload" ? (zh ? "请选择 10 MB 以内的非空文件。" : "Choose a non-empty file no larger than 10 MB.") : (zh ? "该文件超过 25 MB 下载上限。" : "This file exceeds the 25 MB download limit.")}</p> : null}{mutation.isPending ? <TransferProgress value={progress} label={zh ? (progress < 80 ? "正在传输…" : "正在远端安全落盘…") : (progress < 80 ? "Transferring…" : "Finalizing safely on the host…")} /> : null}{mutation.error ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{errorText(mutation.error, zh)}</p> : null}</div></Modal>;
}

function TransferProgress({ value, label }: { value: number; label: string }) {
  return <div className="space-y-2" role="status"><div className="flex justify-between text-xs"><span>{label}</span><span>{value}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${value}%` }} /></div></div>;
}

function saveDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function TransferHistory({ host, scopes, zh }: { host: SshHost; scopes: HostFileScope[]; zh: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["host-file-transfers", host.id], queryFn: () => hostApi.transfers(host.id), refetchInterval: (current) => current.state.data?.transfers.some((item) => item.status === "running") ? 1_000 : false });
  const retryInput = useRef<HTMLInputElement>(null);
  const [retryTask, setRetryTask] = useState<HostFileTransfer | null>(null);
  const [retryFile, setRetryFile] = useState<File | null>(null);
  const scope = retryTask ? scopes.find((item) => item.id === retryTask.scopeId) ?? null : null;
  const closeRetry = () => { setRetryTask(null); setRetryFile(null); };
  const beginRetry = (task: HostFileTransfer) => {
    setRetryTask(task);
    if (task.direction === "upload") retryInput.current?.click();
  };
  if (query.isLoading) return <Notice title={zh ? "正在读取传输记录…" : "Loading transfer history…"} loading />;
  if (query.error) return <Notice title={zh ? "传输记录暂时不可用" : "Transfer history unavailable"} detail={errorText(query.error, zh)} action={<Button variant="secondary" onClick={() => void query.refetch()}><RefreshCw />{zh ? "重试" : "Retry"}</Button>} />;
  const tasks = query.data?.transfers ?? [];
  return <div className="space-y-3"><input ref={retryInput} className="hidden" type="file" onChange={(event) => { setRetryFile(event.target.files?.[0] ?? null); event.target.value = ""; }} />{!tasks.length ? <Notice title={zh ? "尚无传输任务" : "No transfer jobs yet"} detail={zh ? "请在“远程文件”中选择上传，或在文件右侧选择下载。每次操作都会先显示确认信息。" : "Use Upload or Download in Remote files. Every operation shows a confirmation first."} /> : <div className="divide-y rounded-lg border">{tasks.map((task) => {
    const tone = task.status === "completed" ? "success" : task.status === "failed" ? "danger" : "warning";
    const status = task.status === "completed" ? (zh ? "已完成" : "Completed") : task.status === "failed" ? (zh ? "失败" : "Failed") : (zh ? "进行中" : "In progress");
    return <div key={task.id} className="space-y-2 p-3"><div className="flex flex-wrap items-center gap-2"><span className="grid size-8 place-items-center rounded-md bg-muted">{task.direction === "upload" ? <ArrowUpFromLine className="size-4" /> : <ArrowDownToLine className="size-4" />}</span><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{task.fileName}</strong><code className="block truncate text-xs text-muted-foreground">/{task.remotePath}</code></span><StatusBadge tone={tone}>{status}</StatusBadge>{task.status === "failed" && task.attempt < task.maxAttempts && scopes.some((item) => item.id === task.scopeId && item.status === "ready" && item.permissions.includes(task.direction)) ? <Button size="sm" variant="secondary" onClick={() => beginRetry(task)}><RotateCcw />{zh ? "重试" : "Retry"}</Button> : null}</div>{task.status === "running" ? <TransferProgress value={task.progress} label={zh ? "正在处理" : "Processing"} /> : <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{formatBytes(task.bytesTransferred)} / {formatBytes(task.bytesTotal)}</span><span>{zh ? `第 ${task.attempt}/${task.maxAttempts} 次` : `Attempt ${task.attempt}/${task.maxAttempts}`}{task.errorCode ? ` · ${task.errorCode}` : ""}</span></div>}</div>;
  })}</div>}{retryTask && !scope ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{zh ? "原文件范围已不存在，不能重试。" : "The original file range no longer exists, so this transfer cannot be retried."}</p> : null}{retryTask?.direction === "upload" && !retryFile ? <Modal open onClose={closeRetry} title={zh ? "重新选择本地文件" : "Select the local file again"} description={zh ? "为避免保存本地文件内容，失败后需要重新选择文件。" : "Local file contents are not retained, so select the file again after a failure."} footer={<Button variant="secondary" onClick={closeRetry}>{zh ? "取消" : "Cancel"}</Button>}><Button onClick={() => retryInput.current?.click()}><ArrowUpFromLine />{zh ? "选择文件" : "Choose file"}</Button></Modal> : null}{retryTask && scope && (retryTask.direction === "download" || retryFile) ? <TransferConfirmDialog scope={scope} directory={retryTask.remoteDirectory} uploadFile={retryTask.direction === "upload" ? retryFile : null} downloadEntry={retryTask.direction === "download" ? { name: retryTask.fileName, path: retryTask.remotePath, type: "file", accessible: true, size: retryTask.bytesTotal, modifiedAt: null } : null} retryOf={retryTask.id} zh={zh} onClose={closeRetry} onCompleted={async () => queryClient.invalidateQueries({ queryKey: ["host-file-transfers", host.id] })} /> : null}</div>;
}

function HostTechnicalSettings({ host, zh }: { host: SshHost; zh: boolean }) {
  const rows = [
    [zh ? "用途" : "Purposes", host.purposes.join(", ")],
    [zh ? "网络策略" : "Network policy", host.networkPolicy],
    [zh ? "认证方式" : "Authentication", host.authMethod],
    [zh ? "凭据引用" : "Credential reference", host.credentialRef],
    [zh ? "固定指纹" : "Pinned fingerprint", host.knownHostFingerprint ?? "—"],
    [zh ? "SFTP 版本" : "SFTP version", String(host.capabilities?.sftpVersion ?? "—")],
    [zh ? "原子重命名" : "Atomic rename", host.capabilities?.posixRename ? (zh ? "支持" : "Supported") : (zh ? "未声明" : "Not advertised")],
  ];
  return <div className="divide-y rounded-lg border">{rows.map(([label, value]) => <div key={label} className="grid gap-1 px-3 py-3 sm:grid-cols-[140px_1fr]"><span className="text-xs text-muted-foreground">{label}</span><code className="break-all text-xs">{value}</code></div>)}</div>;
}

function HostSetupDialog({ open, initialHost, zh, onClose, onChanged }: { open: boolean; initialHost: SshHost | null; zh: boolean; onClose: () => void; onChanged: () => Promise<unknown> }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [host, setHost] = useState<SshHost | null>(null);
  const [form, setForm] = useState({ name: "", host: "", port: "22", user: "deploy", authMethod: "private_key_ref" as HostAuthMethod, allowPrivate: false, sitePublish: true });
  const [secret, setSecret] = useState({ privateKey: "", passphrase: "", password: "" });
  const [fingerprintAccepted, setFingerprintAccepted] = useState(false);
  const [scope, setScope] = useState({ label: zh ? "网站文件" : "Website files", rootPath: "/srv/www/site", purpose: "site_publish" as HostFileScopePurpose, upload: true, download: true });
  const bridge = typeof window !== "undefined" ? window.myagenttoolDesktop : undefined;

  useEffect(() => {
    if (!open) return;
    setHost(initialHost);
    setStep(!initialHost ? 0 : initialHost.connectionStatus === "ready" ? 3 : initialHost.connectionStatus === "fingerprint_pending" ? 2 : 1);
    setFingerprintAccepted(false);
    if (initialHost) {
      setForm((current) => ({ ...current, authMethod: initialHost.authMethod }));
      setScope((current) => ({ ...current, purpose: initialHost.purposes.includes("site_publish") ? "site_publish" : "general_files" }));
      void bridge?.getSshHostCredentialStatus?.({ hostId: initialHost.id });
    }
  }, [bridge, initialHost, open]);

  const create = useMutation({ mutationFn: () => hostApi.create({ name: form.name || `${form.user}@${form.host}`, host: form.host, port: Number(form.port), user: form.user, authMethod: form.authMethod, purposes: form.sitePublish ? ["file_transfer", "site_publish", "tls_certificate"] : ["file_transfer"], networkPolicy: form.allowPrivate ? "allow_private_network" : "public_only" }), onSuccess: (data) => { setHost(data.target); setStep(1); void onChanged(); } });
  const saveCredential = useMutation({
    mutationFn: async () => {
      if (!host || !bridge?.saveSshHostCredential) throw new Error(zh ? "请使用桌面版安全保存主机凭据。" : "Use the desktop app to save host credentials securely.");
      const result = await bridge.saveSshHostCredential({ hostId: host.id, authMethod: form.authMethod as "private_key_ref" | "managed_identity" | "password_ref", privateKey: secret.privateKey, passphrase: secret.passphrase, password: secret.password });
      if (!("ok" in result) || !result.ok) throw new Error("error" in result ? result.error : "credential_not_saved");
      return result;
    },
    onSuccess: () => { setSecret({ privateKey: "", passphrase: "", password: "" }); setStep(2); },
  });
  const observe = useMutation({ mutationFn: () => hostApi.observeFingerprint(host!.id), onSuccess: (data) => { setHost(data.host); setFingerprintAccepted(false); void onChanged(); } });
  const confirm = useMutation({
    mutationFn: async () => {
      if (!host?.observedFingerprint) throw new Error("fingerprint_missing");
      const confirmed = await hostApi.confirmFingerprint(host.id, host.observedFingerprint, host.revision);
      return hostApi.verify(confirmed.host.id);
    },
    onSuccess: (data) => { setHost(data.host); setStep(3); void onChanged(); },
  });
  const createScope = useMutation({ mutationFn: () => hostApi.createScope(host!.id, { label: scope.label, rootPath: scope.rootPath, purpose: scope.purpose, permissions: ["list", ...(scope.upload ? ["upload" as const] : []), ...(scope.download ? ["download" as const] : [])] }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["my-host-scopes", host!.id] }); await onChanged(); onClose(); } });
  const mutationError = create.error ?? saveCredential.error ?? observe.error ?? confirm.error ?? createScope.error;
  const titles = zh ? ["连接资料", "安全凭据", "确认指纹", "文件范围"] : ["Connection", "Secure credential", "Confirm fingerprint", "File range"];
  const close = () => { if (!create.isPending && !saveCredential.isPending && !observe.isPending && !confirm.isPending && !createScope.isPending) onClose(); };

  return <Modal open={open} onClose={close} title={zh ? "添加或继续设置主机" : "Add or continue host setup"} description={`${zh ? "第" : "Step"} ${step + 1}/4 · ${titles[step]}`} size="lg" footer={<div className="flex w-full flex-wrap justify-between gap-2"><Button variant="secondary" onClick={close}>{zh ? "稍后继续" : "Continue later"}</Button><div className="flex gap-2">{step === 2 ? <Button variant="secondary" onClick={() => setStep(1)}><ArrowLeft />{zh ? "返回凭据" : "Back to credential"}</Button> : null}{step === 0 ? <Button disabled={!form.host.trim() || !form.user.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? <Loader2 className="animate-spin" /> : <ChevronRight />}{zh ? "保存连接资料" : "Save connection"}</Button> : null}{step === 1 ? <Button disabled={saveCredential.isPending || (form.authMethod === "password_ref" ? !secret.password : !secret.privateKey)} onClick={() => saveCredential.mutate()}>{saveCredential.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}{zh ? "安全保存" : "Save securely"}</Button> : null}{step === 2 ? (!host?.observedFingerprint ? <Button disabled={observe.isPending} onClick={() => observe.mutate()}>{observe.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}{zh ? "读取主机指纹" : "Read fingerprint"}</Button> : <Button disabled={!fingerprintAccepted || confirm.isPending} onClick={() => confirm.mutate()}>{confirm.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}{zh ? "确认并测试连接" : "Confirm and verify"}</Button>) : null}{step === 3 ? <Button disabled={!scope.rootPath.trim() || createScope.isPending} onClick={() => createScope.mutate()}>{createScope.isPending ? <Loader2 className="animate-spin" /> : <FolderLock />}{zh ? "验证范围并完成" : "Verify range and finish"}</Button> : null}</div></div>}>
    <div className="space-y-4">
      <ol className="grid grid-cols-4 gap-1" aria-label={zh ? "设置进度" : "Setup progress"}>{titles.map((title, index) => <li key={title} className={`rounded-md px-2 py-2 text-center text-xs ${index === step ? "bg-primary text-primary-foreground" : index < step ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{title}</li>)}</ol>
      {step === 0 ? <div className="grid gap-3 sm:grid-cols-2"><Field label={zh ? "主机名称" : "Host name"}><Input value={form.name} placeholder={zh ? "网站生产主机" : "Production website host"} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label={zh ? "主机地址" : "Host address"}><Input value={form.host} placeholder="host.example.com" onChange={(event) => setForm({ ...form, host: event.target.value })} /></Field><Field label={zh ? "端口" : "Port"}><Input type="number" min="1" max="65535" value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })} /></Field><Field label={zh ? "登录用户" : "Login user"}><Input value={form.user} onChange={(event) => setForm({ ...form, user: event.target.value })} /></Field><Field label={zh ? "认证方式" : "Authentication"}><Select value={form.authMethod} onChange={(event) => setForm({ ...form, authMethod: event.target.value as HostAuthMethod })}><option value="private_key_ref">{zh ? "私钥（推荐）" : "Private key (recommended)"}</option><option value="password_ref">{zh ? "密码" : "Password"}</option></Select></Field><div className="space-y-2 pt-6"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.sitePublish} onChange={(event) => setForm({ ...form, sitePublish: event.target.checked })} />{zh ? "允许用于站点发布" : "Allow site publishing"}</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.allowPrivate} onChange={(event) => setForm({ ...form, allowPrivate: event.target.checked })} />{zh ? "允许访问私网地址" : "Allow private-network address"}</label></div></div> : null}
      {step === 1 ? <div className="space-y-3"><div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{zh ? "凭据只会由桌面端写入操作系统安全存储。页面、服务状态和日志均不会保存明文。" : "The desktop app writes this credential only to OS secure storage. Plaintext is never stored in page state, server state, or logs."}</div>{form.authMethod === "password_ref" ? <Field label={zh ? "主机密码" : "Host password"}><Input type="password" value={secret.password} autoComplete="new-password" onChange={(event) => setSecret({ ...secret, password: event.target.value })} /></Field> : <><Field label={zh ? "私钥" : "Private key"}><Textarea rows={8} value={secret.privateKey} spellCheck={false} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" onChange={(event) => setSecret({ ...secret, privateKey: event.target.value })} /></Field><Field label={zh ? "私钥口令（如有）" : "Key passphrase (if any)"}><Input type="password" value={secret.passphrase} autoComplete="new-password" onChange={(event) => setSecret({ ...secret, passphrase: event.target.value })} /></Field></>}</div> : null}
      {step === 2 ? <div className="space-y-3"><div className="rounded-lg border p-4"><p className="text-sm font-medium">{zh ? "主机指纹" : "Host fingerprint"}</p><code className="mt-2 block break-all rounded bg-muted p-3 text-xs">{host?.observedFingerprint ?? (zh ? "尚未读取" : "Not read yet")}</code></div>{host?.observedFingerprint ? <label className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm"><input className="mt-1" type="checkbox" checked={fingerprintAccepted} onChange={(event) => setFingerprintAccepted(event.target.checked)} /><span>{zh ? "我已通过主机控制台或管理员提供的可信渠道核对该指纹。" : "I checked this fingerprint through the host console or another trusted administrator channel."}</span></label> : <p className="text-sm text-muted-foreground">{zh ? "读取只获取主机公钥，不会发送密码或私钥。" : "Reading fetches only the host public key and sends no password or private key."}</p>}</div> : null}
      {step === 3 ? <div className="space-y-3"><div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{zh ? "请选择专门用于网站、资料或 HTTPS 证书的目录。不同用途不能与证书范围重叠，也不能选择系统目录或符号链接路径。" : "Choose a dedicated website, file, or HTTPS certificate directory. Other ranges cannot overlap a certificate range, and system or symlinked paths are rejected."}</div><Field label={zh ? "范围名称" : "Range name"}><Input value={scope.label} onChange={(event) => setScope({ ...scope, label: event.target.value })} /></Field><Field label={zh ? "远程目录" : "Remote directory"}><Input className="font-mono" value={scope.rootPath} onChange={(event) => setScope({ ...scope, rootPath: event.target.value })} /></Field><Field label={zh ? "用途" : "Purpose"}><Select value={scope.purpose} onChange={(event) => setScope({ ...scope, purpose: event.target.value as HostFileScopePurpose })}><option value="site_publish">{zh ? "站点发布" : "Site publishing"}</option><option value="tls_certificate">{zh ? "HTTPS 证书专用" : "HTTPS certificates only"}</option><option value="general_files">{zh ? "普通文件" : "General files"}</option><option value="backup">{zh ? "备份" : "Backup"}</option></Select></Field>{scope.purpose === "tls_certificate" ? <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">{zh ? "证书范围不会出现在文件浏览和下载入口；只有受控证书部署可以写入。" : "Certificate ranges are excluded from file browsing and downloads; only controlled certificate deployment can write to them."}</p> : <div className="rounded-lg border p-3"><p className="mb-2 text-sm font-medium">{zh ? "允许的传输" : "Allowed transfers"}</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={scope.upload} onChange={(event) => setScope({ ...scope, upload: event.target.checked })} />{zh ? "上传（最大 10 MB，默认保留两份）" : "Upload (10 MB max, keep both by default)"}</label><label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={scope.download} onChange={(event) => setScope({ ...scope, download: event.target.checked })} />{zh ? "下载（最大 25 MB，阻止敏感文件）" : "Download (25 MB max, sensitive files blocked)"}</label></div>}</div> : null}
      {mutationError ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{errorText(mutationError, zh)}</p> : null}
    </div>
  </Modal>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="space-y-1.5 text-sm"><span className="font-medium">{label}</span>{children}</label>; }
function Notice({ title, detail, action, loading = false }: { title: string; detail?: string; action?: React.ReactNode; loading?: boolean }) { return <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center">{loading ? <Loader2 className="size-7 animate-spin text-muted-foreground" /> : <Server className="size-7 text-muted-foreground" />}<h3 className="font-semibold">{title}</h3>{detail ? <p className="max-w-lg text-sm text-muted-foreground">{detail}</p> : null}{action}</div>; }
function formatBytes(value: number) { return value >= 1024 * 1024 ? `${(value / (1024 * 1024)).toFixed(1)} MB` : value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${value} B`; }
