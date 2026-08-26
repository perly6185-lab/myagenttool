import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  CheckCircle2,
  ChevronRight,
  Copy,
  Eye,
  File,
  FileImage,
  FileText,
  Folder,
  FolderLock,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  Sparkles,
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
import { HOST_DIAGNOSTIC_QUICK_ACTIONS, hostDiagnosticPlan, suggestHostDiagnostic } from "./host-assistant";
import type { HostAuthMethod, HostFileConflictPolicy, HostFileEntry, HostFileScope, HostFileScopePurpose, HostFileScopeSuggestion, HostFileTransfer, SshHost } from "./host-types";

type DetailTab = "overview" | "files" | "transfers" | "settings";

function errorText(error: unknown, zh: boolean) {
  const code = error instanceof ApiError ? error.code : "";
  const messages: Record<string, [string, string]> = {
    secure_storage_unavailable: ["当前系统安全存储不可用，不能保存主机凭据。", "OS secure storage is unavailable, so this credential cannot be saved."],
    ssh_host_private_network_blocked: ["这是局域网地址。请确认允许连接这台局域网设备后重试。", "This is a local-network address. Allow connection to this local device, then try again."],
    ssh_host_fingerprint_changed: ["主机指纹已变化。为保护文件，连接已阻断。", "The host fingerprint changed. The connection was blocked to protect remote files."],
    ssh_authentication_failed: ["凭据未获主机接受，请重新保存正确的私钥或密码。", "The host did not accept the credential. Save the correct private key or password and retry."],
    ssh_credential_unavailable: ["此电脑尚未准备好该主机的安全凭据。", "This computer has not prepared a secure credential for this host."],
    ssh_credential_invalid: ["没有找到可用的登录密码或私钥，请重新输入。", "No usable password or private key was found. Enter it again."],
    ssh_connection_refused: ["设备拒绝连接，请确认 SSH 服务已开启且端口正确。", "The device refused the connection. Check that SSH is running and the port is correct."],
    ssh_connection_timeout: ["连接设备超时，请确认设备在线且与本机处于同一局域网。", "The connection timed out. Check that the device is online and on the same local network."],
    ssh_connection_failed: ["无法连接这台设备，请检查地址、SSH 端口和网络连接。", "This device could not be connected. Check its address, SSH port, and network connection."],
    ssh_host_unreachable: ["找不到这台设备，请检查地址、网络连接和防火墙。", "This device could not be reached. Check its address, network connection, and firewall."],
    ssh_host_unresolvable: ["找不到这个主机地址，请检查输入是否正确。", "This host address could not be found. Check that it was entered correctly."],
    ssh_host_address_forbidden: ["出于安全原因，不能连接这个地址。请填写这台设备明确可识别的地址。", "This address cannot be connected for safety reasons. Enter an address that clearly identifies this device."],
    host_file_scope_symlink_forbidden: ["这个目录是快捷入口。为避免跳出允许范围，请选择它指向的真实目录。", "This directory is a shortcut. Choose its real target so access cannot leave the approved range."],
    host_file_scope_escape_blocked: ["远程目录已偏离批准范围，浏览已停止。", "The remote directory moved outside its approved range, so browsing stopped."],
    host_file_listing_too_large: ["该目录项目过多，请先在主机上整理为更小的子目录。", "This directory has too many items. Organize it into smaller subdirectories first."],
    host_file_conflict: ["远端已有同名文件，请选择保留两份或明确确认覆盖。", "A remote file has the same name. Keep both or explicitly confirm replacement."],
    host_file_upload_size_invalid: ["文件为空或超过 10 MB 上传上限。", "The file is empty or exceeds the 10 MB upload limit."],
    host_file_download_size_invalid: ["该文件超过 25 MB 浏览器安全下载上限。", "The file exceeds the 25 MB safe browser download limit."],
    host_file_download_sensitive_blocked: ["该文件可能包含密钥或环境凭据，禁止通过浏览器下载。", "This file may contain keys or environment credentials and cannot be downloaded in the browser."],
    host_file_atomic_replace_unavailable: ["此主机不支持安全的原子覆盖，请改为“保留两份”。", "This host cannot replace files atomically. Choose Keep both."],
    host_file_transfer_retry_limit: ["该任务已达到最多 3 次尝试，请检查主机后重新发起。", "This task reached the three-attempt limit. Check the host and start a new transfer."],
    ssh_diagnostic_confirmation_required: ["请先确认要执行这项只读诊断。", "Confirm the read-only diagnostic before it runs."],
    ssh_diagnostic_unsupported: ["暂不支持这类主机诊断。", "This host diagnostic is not supported yet."],
    ssh_host_not_ready: ["请先完成主机连接验证。", "Complete host connection verification first."],
    ssh_fixed_command_failed: ["主机没有完成这项诊断，请检查系统命令是否可用。", "The host did not complete this diagnostic. Check whether the system command is available."],
    ssh_fixed_command_timeout: ["主机诊断超时，请稍后重试。", "The host diagnostic timed out. Try again later."],
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
  const [setupAllowPrivate, setSetupAllowPrivate] = useState(false);
  const [openSetupAfterLoad, setOpenSetupAfterLoad] = useState(false);
  const selected = hosts.data?.hosts.find((host) => host.id === selectedId) ?? hosts.data?.hosts[0] ?? null;

  useEffect(() => {
    if (!selectedId && hosts.data?.hosts[0]) setSelectedId(hosts.data.hosts[0].id);
  }, [hosts.data?.hosts, selectedId]);

  useEffect(() => {
    if (!professional || !openSetupAfterLoad || hosts.isLoading || hosts.error) return;
    setOpenSetupAfterLoad(false);
    if (!hosts.data?.hosts.length) {
      setSelectedId(null);
      setSetupOpen(true);
    }
  }, [hosts.data?.hosts.length, hosts.error, hosts.isLoading, openSetupAfterLoad, professional]);

  const refresh = async () => queryClient.invalidateQueries({ queryKey: ["my-hosts"] });
  const copy = zh ? {
    eyebrow: "我的设置 · 专业能力", title: "我的主机", description: "安全连接自有主机，并把远程文件限制在经过验证的专用目录内。",
    add: "添加主机", empty: "尚未添加主机", emptyHint: "添加后会依次保存安全凭据、确认主机指纹，并配置受控文件范围。",
  } : {
    eyebrow: "My settings · Professional", title: "My hosts", description: "Connect self-hosted servers and keep remote access inside verified dedicated directories.",
    add: "Add host", empty: "No hosts yet", emptyHint: "Add one to save a secure credential, confirm its fingerprint, and configure a governed file range.",
  };

  if (!professional) return <div className="space-y-5"><SectionHeading eyebrow={zh ? "我的设置" : "My settings"} title={zh ? "连接我的主机" : "Connect my host"} description={zh ? "连接自己的电脑或服务器。高级 SSH 设置会在需要时显示。" : "Connect your own computer or server. Advanced SSH settings appear only when needed."} /><Notice title={zh ? "连接你的电脑或服务器" : "Connect your computer or server"} detail={zh ? "输入主机地址和登录信息，应用会先验证连接，再让你选择允许访问的文件夹。" : "Enter the host address and sign-in details. We will verify the connection before asking which folders may be accessed."} action={<Button onClick={() => { setOpenSetupAfterLoad(true); setExperienceMode("professional"); }}><Plus />{zh ? "开始连接" : "Start connecting"}</Button>} /></div>;

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
        {selected ? <HostDetail host={selected} tab={tab} setTab={setTab} zh={zh} onContinue={(options) => { setSetupAllowPrivate(Boolean(options?.allowPrivate)); setSetupOpen(true); }} /> : null}
      </div>
    )}
    <HostSetupDialog open={setupOpen} initialHost={selectedId ? selected : null} allowPrivateByDefault={setupAllowPrivate} zh={zh} onClose={() => { setSetupOpen(false); setSetupAllowPrivate(false); }} onChanged={refresh} />
  </div>;
}

function HostDetail({ host, tab, setTab, zh, onContinue }: { host: SshHost; tab: DetailTab; setTab: (tab: DetailTab) => void; zh: boolean; onContinue: (options?: { allowPrivate?: boolean }) => void }) {
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

function HostOverview({ host, scopeCount, zh, onContinue }: { host: SshHost; scopeCount: number; zh: boolean; onContinue: (options?: { allowPrivate?: boolean }) => void }) {
  const ready = host.connectionStatus === "ready";
  const privateNetworkBlocked = host.lastConnectionError?.code === "ssh_host_private_network_blocked";
  const hasConnectionError = host.connectionStatus === "error";
  const bannerTitle = !ready
    ? privateNetworkBlocked ? (zh ? "需要允许访问内网设备" : "Local-network access needs approval") : (zh ? "继续完成安全连接" : "Complete secure connection")
    : (zh ? "添加一个文件范围" : "Add a file range");
  const bannerDetail = !ready
    ? privateNetworkBlocked ? (zh ? "这是局域网地址。允许后会重新检查设备连接。" : "This is a local-network address. Approve it to check the device again.") : (zh ? "输入登录信息后，系统会验证设备并保护远程文件。" : "After sign-in, we will verify the device and protect remote files.")
    : (zh ? "只有批准目录内的文件可以被查看。" : "Only files inside an approved directory can be viewed.");
  const bannerActionLabel = !ready
    ? privateNetworkBlocked ? (zh ? "允许内网并重试" : "Allow local network and retry") : (hasConnectionError ? (zh ? "检查并重试" : "Check and retry") : (zh ? "继续设置" : "Continue setup"))
    : (zh ? "继续设置" : "Continue setup");
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3">
      <Summary icon={ready ? CheckCircle2 : TriangleAlert} label={zh ? "连接" : "Connection"} value={ready ? (zh ? "已验证" : "Verified") : (zh ? "未完成" : "Incomplete")} />
      <Summary icon={FolderLock} label={zh ? "文件范围" : "File ranges"} value={zh ? `${scopeCount} 个` : String(scopeCount)} />
      <Summary icon={ShieldCheck} label={zh ? "访问方式" : "Access"} value={zh ? "范围内受控传输" : "Governed transfers"} />
    </div>
    {!ready || !scopeCount ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4"><div><p className="text-sm font-medium">{bannerTitle}</p><p className="mt-1 text-xs text-muted-foreground">{bannerDetail}</p></div><Button onClick={() => onContinue(privateNetworkBlocked ? { allowPrivate: true } : undefined)}>{bannerActionLabel}<ChevronRight /></Button></div> : null}
    {host.lastConnectionError ? <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{errorText(new ApiError(host.lastConnectionError.code, host.lastConnectionError.code, 0), zh)}</p> : null}
    <HostAssistant host={host} zh={zh} />
  </div>;
}

function Summary({ icon: Icon, label, value }: { icon: typeof Server; label: string; value: string }) {
  return <div className="rounded-lg border p-3"><Icon className="size-5 text-primary" /><p className="mt-3 text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>;
}

function HostAssistant({ host, zh }: { host: SshHost; zh: boolean }) {
  const [input, setInput] = useState("");
  const [plan, setPlan] = useState<ReturnType<typeof suggestHostDiagnostic>>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const planMutation = useMutation({
    mutationFn: () => hostApi.planDiagnostic(host.id, input.trim()),
    onSuccess: (result) => { choose({ ...hostDiagnosticPlan(result.plan.action, result.plan.parameters), command: result.plan.command, parameters: result.plan.parameters }); },
    onError: () => { setPlan(null); setOutput(null); setMessage(zh ? "暂时无法理解这项请求。可以试试磁盘、内存、进程、端口或容器状态。" : "I could not map that request safely. Try disk, memory, processes, ports, or Docker status."); },
  });
  const mutation = useMutation({
    mutationFn: (next: NonNullable<typeof plan>) => next.parameters ? hostApi.diagnose(host.id, next.action, next.parameters) : hostApi.diagnose(host.id, next.action),
    onSuccess: (result) => { setOutput(result.result.output || (zh ? "主机没有返回内容。" : "The host returned no output.")); setMessage(null); },
    onError: (error) => { setOutput(null); setMessage(errorText(error, zh)); },
  });
  const choose = (next: NonNullable<typeof plan>) => { setPlan(next); setOutput(null); setMessage(null); };
  const submit = () => { if (input.trim()) planMutation.mutate(); };
  const ready = host.connectionStatus === "ready";
  return <div className="rounded-lg border bg-card p-4" data-testid="host-assistant">
    <div className="flex flex-wrap items-start gap-3"><span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><Bot className="size-5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{zh ? "AI 主机助手" : "AI host assistant"}</p><StatusBadge tone="neutral"><Sparkles className="size-3" />{zh ? "安全建议" : "Safe suggestions"}</StatusBadge></div><p className="mt-1 text-xs text-muted-foreground">{zh ? "用一句话描述你想了解的内容。当前先使用可审计的安全建议模板，只建议只读诊断，执行前会展示命令并等待确认。" : "Describe what you want to know. For now, auditable safe templates suggest read-only diagnostics and show the command before you confirm."}</p></div></div>
    <div className="mt-4 flex flex-col gap-2 sm:flex-row"><Input value={input} placeholder={zh ? "例如：看看磁盘还剩多少空间" : "For example: show remaining disk space"} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submit(); }} /><Button variant="secondary" disabled={!input.trim() || !ready || planMutation.isPending} onClick={submit}>{planMutation.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}{zh ? "生成建议" : "Suggest"}</Button></div>
    <div className="mt-3 flex flex-wrap gap-2">{HOST_DIAGNOSTIC_QUICK_ACTIONS.map((item) => <Button key={item.action} size="sm" variant="ghost" disabled={!ready} onClick={() => choose(hostDiagnosticPlan(item.action))}>{item.title}</Button>)}</div>
    {!ready ? <p className="mt-3 rounded-lg bg-warning/10 p-3 text-xs text-muted-foreground">{zh ? "请先完成主机连接验证，助手才会访问设备。" : "Complete host connection verification before the assistant can access this device."}</p> : null}
    {plan ? <div className="mt-4 space-y-3 rounded-lg border border-primary/25 bg-primary/[0.04] p-3"><div><p className="text-sm font-medium">{plan.title}</p><p className="mt-1 text-xs text-muted-foreground">{plan.explanation}</p></div><code className="block overflow-x-auto rounded-md bg-muted p-3 text-xs">{plan.command || (zh ? "需要先指定服务名称" : "Specify a service name first")}</code><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{zh ? "只读 · 不会上传、删除或重启服务" : "Read-only · no upload, deletion, or service restart"}</span><Button disabled={!ready || !plan.command || mutation.isPending} onClick={() => mutation.mutate(plan)}>{mutation.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}{zh ? "确认并执行" : "Confirm and run"}</Button></div></div> : null}
    {message ? <p role="status" className="mt-3 rounded-lg bg-muted p-3 text-sm text-muted-foreground">{message}</p> : null}
    {output !== null ? <div className="mt-4"><div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"><CheckCircle2 className="size-4 text-primary" />{zh ? "诊断结果（本次会话显示）" : "Diagnostic result (shown for this session)"}</div><DiagnosticInsights action={plan?.action ?? null} output={output} zh={zh} /><pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs leading-5">{output}</pre></div> : null}
  </div>;
}

function DiagnosticInsights({ action, output, zh }: { action: string | null; output: string; zh: boolean }) {
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  const cards: string[] = [];
  if (action === "disk_usage") {
    for (const line of lines) {
      const match = line.match(/(\d+)%\s+(.+)$/);
      if (match) cards.push(`${match[2]} · ${match[1]}%`);
    }
  } else if (action === "memory_usage") {
    const memory = lines.find((line) => /^Mem:/i.test(line));
    if (memory) {
      const fields = memory.split(/\s+/);
      if (fields.length >= 7) cards.push(`${zh ? "已用" : "Used"} ${fields[2]} / ${fields[1]} · ${zh ? "可用" : "Available"} ${fields[6]}`);
    }
  } else if (action === "processes") {
    cards.push(`${zh ? "显示进程" : "Processes shown"}: ${Math.max(0, lines.length - 1)}`);
  } else if (action === "listening_ports") {
    cards.push(`${zh ? "监听项" : "Listening entries"}: ${Math.max(0, lines.length - 1)}`);
  } else if (action === "docker_status") {
    cards.push(`${zh ? "运行中容器" : "Running containers"}: ${lines.length}`);
  }
  if (!cards.length) return null;
  return <div className="grid gap-2 sm:grid-cols-2" data-testid="diagnostic-insights">{cards.slice(0, 6).map((card) => <div key={card} className="rounded-lg border bg-card px-3 py-2 text-xs font-medium">{card}</div>)}</div>;
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
  const [previewEntry, setPreviewEntry] = useState<HostFileEntry | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const query = useQuery({ queryKey: ["host-file-entries", scope.id, path], queryFn: () => hostApi.entries(scope.id, path), retry: false });
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const refresh = () => query.refetch();
  const listedFiles = query.data?.entries.filter((entry) => entry.type === "file") ?? [];
  const listedBytes = listedFiles.reduce((total, entry) => total + (entry.size ?? 0), 0);
  return <><div className="overflow-hidden rounded-lg border"><div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2"><FolderLock className="size-4 text-muted-foreground" /><span className="text-xs font-medium">{scope.label}</span><code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">/{path}</code>{scope.permissions.includes("upload") ? <><input ref={uploadInput} className="hidden" type="file" onChange={(event) => { const file = event.target.files?.[0] ?? null; event.target.value = ""; setUploadFile(file); }} /><Button size="sm" variant="secondary" onClick={() => uploadInput.current?.click()}><ArrowUpFromLine />{zh ? "上传" : "Upload"}</Button></> : null}{path ? <Button size="sm" variant="ghost" onClick={() => setPath(parent)}><ArrowLeft />{zh ? "上一级" : "Up"}</Button> : null}</div>
    {query.data?.entries?.length ? <div className="flex flex-wrap gap-3 border-b bg-muted/10 px-3 py-2 text-xs text-muted-foreground" data-testid="directory-summary"><span>{zh ? `当前目录 ${query.data.entries.length} 项` : `${query.data.entries.length} items in this folder`}</span><span>{zh ? `已列出文件 ${formatBytes(listedBytes)}` : `${formatBytes(listedBytes)} in listed files`}</span></div> : null}
    {query.isLoading ? <div className="p-6 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 size-5 animate-spin" />{zh ? "正在安全读取目录…" : "Reading directory safely…"}</div> : query.error ? <Notice title={zh ? "目录未能打开" : "Directory could not be opened"} detail={errorText(query.error, zh)} action={<Button size="sm" variant="secondary" onClick={() => void query.refetch()}><RefreshCw />{zh ? "重试" : "Retry"}</Button>} /> : !query.data?.entries.length ? <div className="p-6 text-center text-sm text-muted-foreground">{zh ? "此目录为空。" : "This directory is empty."}</div> : null}
    {query.data?.entries?.length ? <div className="divide-y">{query.data.entries.map((entry) => <FileRow key={entry.path} entry={entry} zh={zh} canDownload={scope.permissions.includes("download")} onDownload={() => setDownloadEntry(entry)} onPreview={() => setPreviewEntry(entry)} onOpen={() => entry.type === "directory" && entry.accessible ? setPath(entry.path) : undefined} />)}</div> : null}
  </div><TransferConfirmDialog scope={scope} directory={path} uploadFile={uploadFile} downloadEntry={downloadEntry} zh={zh} onClose={() => { setUploadFile(null); setDownloadEntry(null); }} onCompleted={refresh} /><FilePreviewDialog scope={scope} entry={previewEntry} zh={zh} onClose={() => setPreviewEntry(null)} /></>;
}

function FileRow({ entry, zh, canDownload, onDownload, onPreview, onOpen }: { entry: HostFileEntry; zh: boolean; canDownload: boolean; onDownload: () => void; onPreview: () => void; onOpen: () => void }) {
  const directory = entry.type === "directory";
  const blocked = !entry.accessible;
  const preview = !directory && !blocked ? previewKind(entry.name) : null;
  const blockedLabel = entry.type === "symlink"
    ? (zh ? "快捷入口：请打开对应的真实文件夹" : "Shortcut: open the matching real folder")
    : (zh ? "安全限制：不可打开" : "Restricted: cannot open");
  return <div className="flex w-full items-center gap-3 px-3 py-2.5"><span className="grid size-8 place-items-center rounded-md bg-muted">{directory ? <Folder className="size-4 text-primary" /> : blocked ? <FolderLock className="size-4 text-muted-foreground" /> : preview === "image" ? <FileImage className="size-4 text-muted-foreground" /> : preview === "text" ? <FileText className="size-4 text-muted-foreground" /> : <File className="size-4 text-muted-foreground" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{entry.name}</span><span className="block text-xs text-muted-foreground">{blocked ? blockedLabel : directory ? (zh ? "文件夹" : "Folder") : formatBytes(entry.size ?? 0)}</span></span>{directory && !blocked ? <Button size="sm" variant="ghost" onClick={onOpen}>{zh ? "打开" : "Open"}<ChevronRight /></Button> : !directory && !blocked && canDownload ? <div className="flex shrink-0 gap-1">{preview ? <Button size="sm" variant="ghost" onClick={onPreview}><Eye />{zh ? "预览" : "Preview"}</Button> : null}<Button size="sm" variant="ghost" onClick={onDownload}><ArrowDownToLine />{zh ? "下载" : "Download"}</Button></div> : null}</div>;
}

type PreviewKind = "image" | "text" | "pdf";

async function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === "function") return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("blob_read_failed"));
    reader.readAsText(blob);
  });
}

function previewKind(name: string): PreviewKind | null {
  const extension = name.toLocaleLowerCase().split(".").pop() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"].includes(extension)) return "image";
  if (extension === "pdf") return "pdf";
  if (["txt", "md", "json", "yaml", "yml", "log", "conf", "ini", "csv", "xml", "html", "css", "js", "ts", "sh", "env"].includes(extension)) return "text";
  return null;
}

function FilePreviewDialog({ scope, entry, zh, onClose }: { scope: HostFileScope; entry: HostFileEntry | null; zh: boolean; onClose: () => void }) {
  const kind = entry ? previewKind(entry.name) : null;
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [text, setText] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setStatus(entry ? "loading" : "idle");
    setText("");
    setUrl(null);
    if (!entry || !kind) return undefined;
    void hostApi.download(scope.id, { path: entry.path }).then(async (result) => {
      if (cancelled) return;
      if (kind === "text") {
        const previewText = await readBlobText(result.blob.slice(0, 512 * 1024 + 1));
        if (previewText.length > 512 * 1024) { setStatus("error"); return; }
        setText(previewText.slice(0, 200_000));
      }
      else setUrl(URL.createObjectURL(new Blob([result.blob], { type: kind === "pdf" ? "application/pdf" : "image/*" })));
      if (!cancelled) setStatus("ready");
    }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, [entry, kind, scope.id]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const title = entry ? (zh ? `预览：${entry.name}` : `Preview: ${entry.name}`) : "";
  return <Modal open={Boolean(entry)} onClose={onClose} title={title} description={zh ? "只读取批准范围内的文件，不会执行文件内容。" : "Reads a file inside the approved range; file contents are never executed."} size="xl" footer={<Button variant="secondary" onClick={onClose}>{zh ? "关闭" : "Close"}</Button>}>
    {status === "loading" ? <div className="p-8 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 size-5 animate-spin" />{zh ? "正在读取文件…" : "Reading file…"}</div> : null}
    {status === "error" ? <Notice title={zh ? "暂时无法预览" : "Preview unavailable"} detail={kind === "text" ? (zh ? "文本文件超过 512 KB 预览上限，请使用下载并在本地打开。" : "Text previews are limited to 512 KB. Download the file to open it locally.") : (zh ? "文件读取失败或不满足安全预览条件。" : "The file could not be read or did not meet safe preview requirements.")} /> : null}
    {status === "ready" && kind === "text" ? <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-4 text-xs leading-5">{text}</pre> : null}
    {status === "ready" && kind === "image" && url ? <div className="grid max-h-[65vh] place-items-center overflow-auto rounded-lg bg-muted p-3"><img src={url} alt={entry?.name ?? ""} className="max-h-[60vh] max-w-full object-contain" /></div> : null}
    {status === "ready" && kind === "pdf" && url ? <iframe title={title} src={url} className="h-[65vh] w-full rounded-lg border" /> : null}
  </Modal>;
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

type HostSetupStage = "connection" | "fingerprint" | "scope";

function isPrivateNetworkHost(value: string) {
  const host = value.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  const ipv4 = host.split(".").map(Number);
  if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return ipv4[0] === 10
      || ipv4[0] === 127
      || (ipv4[0] === 169 && ipv4[1] === 254)
      || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
      || (ipv4[0] === 192 && ipv4[1] === 168);
  }
  return host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb");
}

function HostSetupDialog({ open, initialHost, allowPrivateByDefault, zh, onClose, onChanged }: { open: boolean; initialHost: SshHost | null; allowPrivateByDefault: boolean; zh: boolean; onClose: () => void; onChanged: () => Promise<unknown> }) {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<HostSetupStage>("connection");
  const [host, setHost] = useState<SshHost | null>(null);
  const [form, setForm] = useState({ name: "", host: "", port: "22", user: "deploy", authMethod: "password_ref" as HostAuthMethod, allowPrivate: false, sitePublish: false });
  const [connectionError, setConnectionError] = useState("");
  const [privateDetected, setPrivateDetected] = useState(false);
  const [secret, setSecret] = useState({ privateKey: "", passphrase: "", password: "" });
  const [fingerprintAccepted, setFingerprintAccepted] = useState(false);
  const [fingerprintCopied, setFingerprintCopied] = useState(false);
  const [scopeRootTouched, setScopeRootTouched] = useState(false);
  const [manualScopeOpen, setManualScopeOpen] = useState(true);
  const [scope, setScope] = useState({ label: zh ? "主机文件" : "Host files", rootPath: "", purpose: "general_files" as HostFileScopePurpose, upload: false, download: true });
  const bridge = typeof window !== "undefined" ? window.myagenttoolDesktop : undefined;
  const scopeSuggestions = useQuery({
    queryKey: ["my-host-scope-suggestions", host?.id],
    queryFn: () => hostApi.scopeSuggestions(host!.id),
    enabled: open && stage === "scope" && Boolean(host?.id) && host?.connectionStatus === "ready",
    retry: false,
  });

  useEffect(() => {
    if (!open) return;
    setHost(initialHost);
    setStage(initialHost?.connectionStatus === "ready" ? "scope" : initialHost?.connectionStatus === "fingerprint_pending" && initialHost.observedFingerprint ? "fingerprint" : "connection");
    setForm({
      name: initialHost?.name ?? "",
      host: initialHost?.host ?? "",
      port: String(initialHost?.port ?? 22),
      user: initialHost?.user ?? "deploy",
      authMethod: initialHost?.authMethod ?? "password_ref",
      allowPrivate: initialHost?.networkPolicy === "allow_private_network" || allowPrivateByDefault,
      sitePublish: initialHost ? initialHost.purposes.includes("site_publish") : false,
    });
    setConnectionError("");
    setPrivateDetected(initialHost?.lastConnectionError?.code === "ssh_host_private_network_blocked");
    setSecret({ privateKey: "", passphrase: "", password: "" });
    setFingerprintAccepted(false);
    setFingerprintCopied(false);
    setScopeRootTouched(false);
    setManualScopeOpen(true);
    setScope({ label: initialHost?.purposes.includes("site_publish") ? (zh ? "网站文件" : "Website files") : (zh ? "主机文件" : "Host files"), rootPath: "", purpose: initialHost?.purposes.includes("site_publish") ? "site_publish" : "general_files", upload: initialHost?.purposes.includes("site_publish") ?? false, download: true });
    if (initialHost) void bridge?.getSshHostCredentialStatus?.({ hostId: initialHost.id });
  }, [allowPrivateByDefault, bridge, initialHost, open, zh]);

  useEffect(() => {
    if (stage !== "scope" || scopeRootTouched || !scopeSuggestions.data?.suggestions.length) return;
    const suggestion = scopeSuggestions.data.suggestions.find((item) => item.recommended) ?? scopeSuggestions.data.suggestions[0];
    setScope((current) => ({ ...current, label: suggestion.label, rootPath: suggestion.rootPath, purpose: suggestion.purpose, upload: suggestion.purpose === "site_publish" }));
    setManualScopeOpen(false);
  }, [scopeRootTouched, scopeSuggestions.data?.suggestions, stage]);

  const keyAuthentication = form.authMethod === "private_key_ref" || form.authMethod === "managed_identity";
  const credentialProvided = form.authMethod === "password_ref" ? secret.password.length > 0 : keyAuthentication ? Boolean(secret.privateKey.trim()) : false;
  const existingHost = host ?? initialHost;
  const authChanged = Boolean(existingHost && existingHost.authMethod !== form.authMethod);
  const credentialRequired = (!existingHost || authChanged) && form.authMethod !== "ssh_agent";
  const showPrivateConsent = isPrivateNetworkHost(form.host) || privateDetected || form.allowPrivate;

  const connect = useMutation({
    mutationFn: async () => {
      const input = {
        name: form.name.trim() || `${form.user.trim()}@${form.host.trim()}`,
        host: form.host.trim(),
        port: Number(form.port),
        user: form.user.trim(),
        authMethod: form.authMethod,
        purposes: form.sitePublish ? ["file_transfer", "site_publish", "tls_certificate"] as const : ["file_transfer"] as const,
        networkPolicy: form.allowPrivate ? "allow_private_network" as const : "public_only" as const,
      };
      let current = existingHost
        ? (await hostApi.update(existingHost.id, { ...input, purposes: [...input.purposes], expectedRevision: existingHost.revision })).host
        : (await hostApi.create({ ...input, purposes: [...input.purposes] })).target;
      setHost(current);

      const shouldSaveCredential = form.authMethod !== "ssh_agent" && (credentialProvided || !existingHost || authChanged);
      if (shouldSaveCredential) {
        if (!bridge?.saveSshHostCredential) throw new Error(zh ? "请使用桌面版安全保存主机密码或私钥。" : "Use the desktop app to save the host password or private key securely.");
        const result = await bridge.saveSshHostCredential({
          hostId: current.id,
          authMethod: form.authMethod as "private_key_ref" | "managed_identity" | "password_ref",
          privateKey: secret.privateKey,
          passphrase: secret.passphrase,
          password: secret.password,
        });
        if (!("ok" in result) || !result.ok) throw new ApiError("error" in result ? result.error : "credential_not_saved", "credential_not_saved", 400);
      }

      const pinnedFingerprint = current.knownHostFingerprint;
      try {
        const observed = await hostApi.observeFingerprint(current.id);
        current = observed.host;
        setHost(current);
        if (pinnedFingerprint && pinnedFingerprint === observed.observation.fingerprint) {
          const verified = await hostApi.verify(current.id);
          return { host: verified.host, needsConfirmation: false };
        }
        return { host: current, needsConfirmation: true };
      } catch (error) {
        const latest = await hostApi.get(current.id).catch(() => null);
        if (latest?.host) setHost(latest.host);
        throw error;
      }
    },
    onSuccess: async (result) => {
      setSecret({ privateKey: "", passphrase: "", password: "" });
      setHost(result.host);
      setConnectionError("");
      await onChanged();
      if (result.needsConfirmation) {
        setFingerprintAccepted(false);
        setStage("fingerprint");
      } else setStage("scope");
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "ssh_host_private_network_blocked") setPrivateDetected(true);
      setConnectionError(errorText(error, zh));
      void onChanged();
    },
  });

  const submitConnection = () => {
    if (!form.host.trim()) return setConnectionError(zh ? "请输入主机地址，例如 10.10.10.222。" : "Enter a host address, for example 10.10.10.222.");
    if (!form.user.trim()) return setConnectionError(zh ? "请输入登录用户。" : "Enter the login user.");
    const port = Number(form.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return setConnectionError(zh ? "端口必须是 1 到 65535 之间的整数。" : "Port must be an integer from 1 to 65535.");
    if (showPrivateConsent && !form.allowPrivate) return setConnectionError(zh ? "请先确认允许连接这台局域网设备。" : "Confirm that MyAgentTool may connect to this local-network device.");
    if (credentialRequired && !credentialProvided) return setConnectionError(form.authMethod === "password_ref" ? (zh ? "请输入登录密码。" : "Enter the login password.") : (zh ? "请输入私钥。" : "Enter the private key."));
    if (form.authMethod !== "ssh_agent" && (credentialProvided || !existingHost || authChanged) && !bridge?.saveSshHostCredential) return setConnectionError(zh ? "请在 MyAgentTool 桌面版中完成连接，以便安全保存凭据。" : "Complete this connection in the MyAgentTool desktop app so the credential can be stored securely.");
    setConnectionError("");
    connect.mutate();
  };

  const confirm = useMutation({
    mutationFn: async () => {
      if (!host?.observedFingerprint) throw new Error("fingerprint_missing");
      const observedFingerprint = host.observedFingerprint;
      let current = host;
      try {
        if (current.knownHostFingerprint !== observedFingerprint) {
          current = (await hostApi.confirmFingerprint(current.id, observedFingerprint, current.revision)).host;
          setHost(current);
        }
        return await hostApi.verify(current.id);
      } catch (error) {
        const latest = await hostApi.get(current.id).catch(() => null);
        if (latest?.host) setHost(latest.host);
        throw error;
      }
    },
    onSuccess: async (data) => { setHost(data.host); await onChanged(); setStage("scope"); },
  });
  const createScope = useMutation({ mutationFn: () => hostApi.createScope(host!.id, { label: scope.label, rootPath: scope.rootPath, purpose: scope.purpose, permissions: ["list", ...(scope.upload ? ["upload" as const] : []), ...(scope.download ? ["download" as const] : [])] }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["my-host-scopes", host!.id] }); await onChanged(); onClose(); } });
  const mutationError = confirm.error ?? createScope.error;
  const pending = connect.isPending || confirm.isPending || createScope.isPending;
  const close = () => { if (!pending) onClose(); };
  const modalTitle = stage === "connection" ? (zh ? "连接主机" : "Connect a host") : stage === "fingerprint" ? (zh ? "确认这台设备" : "Confirm this device") : (zh ? "添加文件范围" : "Add a file range");
  const modalDescription = stage === "connection" ? (zh ? "填写地址和登录信息，系统会安全保存凭据并测试连接。" : "Enter the address and sign-in details. The credential is stored securely and the connection is tested.") : stage === "fingerprint" ? (zh ? "首次连接需要确认设备指纹，避免连接到错误设备。" : "The first connection requires a device fingerprint check to prevent connecting to the wrong device.") : (zh ? "连接已验证。现在可选择允许访问的专用目录。" : "The connection is verified. Now choose a dedicated directory that may be accessed.");
  const stageIndex = stage === "connection" ? 0 : stage === "fingerprint" ? 1 : 2;
  const chooseScopeSuggestion = (suggestion: HostFileScopeSuggestion) => {
    setScopeRootTouched(true);
    setScope((current) => ({ ...current, label: suggestion.label, rootPath: suggestion.rootPath, purpose: suggestion.purpose, upload: suggestion.purpose === "site_publish" }));
  };
  const suggestionReason = (suggestion: HostFileScopeSuggestion) => suggestion.reason === "managed_site"
    ? (zh ? "检测到 MyAgentTool 站点配置" : "MyAgentTool site configuration detected")
    : suggestion.reason === "managed_content"
      ? (zh ? "检测到专用内容目录" : "Dedicated content directory detected")
      : (zh ? "检测到网站目录" : "Website directory detected");
  const copyFingerprint = async () => {
    if (!host?.observedFingerprint || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(host.observedFingerprint);
      setFingerprintCopied(true);
    } catch {
      setFingerprintCopied(false);
    }
  };

  const footer = <div className="flex w-full flex-wrap justify-between gap-2"><Button variant="secondary" onClick={close}>{zh ? "稍后继续" : "Continue later"}</Button><div className="flex gap-2">{stage === "fingerprint" ? <Button variant="secondary" onClick={() => { setConnectionError(""); setStage("connection"); }}><ArrowLeft />{zh ? "返回修改" : "Back to edit"}</Button> : null}{stage === "connection" ? <Button disabled={connect.isPending} onClick={submitConnection}>{connect.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}{zh ? "连接并验证" : "Connect and verify"}</Button> : null}{stage === "fingerprint" ? <Button disabled={!fingerprintAccepted || confirm.isPending} onClick={() => confirm.mutate()}>{confirm.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}{zh ? "确认并连接" : "Confirm and connect"}</Button> : null}{stage === "scope" ? <Button disabled={!scope.rootPath.trim() || createScope.isPending} onClick={() => createScope.mutate()}>{createScope.isPending ? <Loader2 className="animate-spin" /> : <FolderLock />}{zh ? "验证范围并完成" : "Verify range and finish"}</Button> : null}</div></div>;

  return <Modal open={open} onClose={close} title={modalTitle} description={modalDescription} size="lg" footer={footer}>
    <div className="space-y-4">
      <ol className="grid grid-cols-3 gap-1" aria-label={zh ? "连接进度" : "Connection progress"}>{[
        zh ? "1. 登录信息" : "1. Sign-in details",
        zh ? "2. 确认设备" : "2. Confirm device",
        zh ? "3. 选择文件夹" : "3. Choose folder",
      ].map((label, index) => <li key={label} className={`rounded-md px-2 py-2 text-center text-xs ${stageIndex === index ? "bg-primary text-primary-foreground" : stageIndex > index ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{label}</li>)}</ol>
      {stage === "connection" ? <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2"><Field label={zh ? "主机地址" : "Host address"} required><Input required aria-invalid={connectionError && !form.host.trim() ? true : undefined} value={form.host} placeholder="10.10.10.222" onChange={(event) => { setConnectionError(""); setPrivateDetected(false); setForm({ ...form, host: event.target.value, allowPrivate: false }); }} /></Field><Field label={zh ? "登录用户" : "Login user"} required><Input required aria-invalid={connectionError && !form.user.trim() ? true : undefined} value={form.user} onChange={(event) => { setConnectionError(""); setForm({ ...form, user: event.target.value }); }} /></Field></div>
        {form.authMethod === "password_ref" ? <Field label={zh ? "登录密码" : "Login password"} required={credentialRequired}><Input type="password" value={secret.password} autoComplete="new-password" placeholder={existingHost && !authChanged ? (zh ? "留空则使用已安全保存的密码" : "Leave blank to reuse the securely stored password") : ""} onChange={(event) => { setConnectionError(""); setSecret({ ...secret, password: event.target.value }); }} /></Field> : keyAuthentication ? <><Field label={zh ? "私钥" : "Private key"} required={credentialRequired}><Textarea rows={7} value={secret.privateKey} spellCheck={false} placeholder={existingHost && !authChanged ? (zh ? "留空则使用已安全保存的私钥" : "Leave blank to reuse the securely stored private key") : "-----BEGIN OPENSSH PRIVATE KEY-----"} onChange={(event) => { setConnectionError(""); setSecret({ ...secret, privateKey: event.target.value }); }} /></Field><Field label={zh ? "私钥口令（如有）" : "Key passphrase (if any)"}><Input type="password" value={secret.passphrase} autoComplete="new-password" onChange={(event) => setSecret({ ...secret, passphrase: event.target.value })} /></Field></> : null}
        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{zh ? "密码或私钥只保存在本机操作系统的安全存储中，不会写入站点数据或日志。" : "The password or private key stays in this computer's OS secure storage and is not written to site data or logs."}</p>
        {showPrivateConsent ? <label className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm"><input className="mt-1" type="checkbox" checked={form.allowPrivate} onChange={(event) => { setConnectionError(""); setForm({ ...form, allowPrivate: event.target.checked }); }} /><span>{zh ? "这是局域网地址。允许 MyAgentTool 连接这台局域网设备。" : "This is a local-network address. Allow MyAgentTool to connect to this local device."}</span></label> : null}
        <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{zh ? "高级选项" : "Advanced options"}</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label={zh ? "主机名称" : "Host name"}><Input value={form.name} placeholder={zh ? "网站生产主机" : "Production website host"} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label={zh ? "端口" : "Port"} required><Input required type="number" min="1" max="65535" value={form.port} onChange={(event) => { setConnectionError(""); setForm({ ...form, port: event.target.value }); }} /></Field><Field label={zh ? "认证方式" : "Authentication"}><Select value={form.authMethod} onChange={(event) => { setConnectionError(""); setSecret({ privateKey: "", passphrase: "", password: "" }); setForm({ ...form, authMethod: event.target.value as HostAuthMethod }); }}><option value="password_ref">{zh ? "密码" : "Password"}</option><option value="private_key_ref">{zh ? "私钥" : "Private key"}</option><option value="managed_identity">{zh ? "托管身份" : "Managed identity"}</option><option value="ssh_agent">{zh ? "SSH Agent" : "SSH agent"}</option></Select></Field><label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={form.sitePublish} onChange={(event) => setForm({ ...form, sitePublish: event.target.checked })} />{zh ? "允许用于站点发布" : "Allow site publishing"}</label></div></details>
        {connectionError ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{connectionError}</p> : null}
      </div> : null}
      {stage === "fingerprint" ? <div className="space-y-3">
        <div className="rounded-lg border p-4"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{zh ? "设备指纹" : "Device fingerprint"}</p><Button size="sm" variant="ghost" onClick={() => void copyFingerprint()}><Copy />{fingerprintCopied ? (zh ? "已复制" : "Copied") : (zh ? "复制" : "Copy")}</Button></div><code className="mt-2 block break-all rounded bg-muted p-3 text-xs">{host?.observedFingerprint ?? (zh ? "尚未读取" : "Not read yet")}</code></div>
        <p className="text-sm text-muted-foreground">{zh ? "把上面的指纹与设备控制台或管理员提供的指纹核对。确认后，如果设备身份发生变化，系统会自动阻止连接。" : "Compare the fingerprint above with the device console or the value from its administrator. Future identity changes will automatically block the connection."}</p>
        <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{zh ? "不知道如何核对？" : "Not sure how to compare it?"}</summary><div className="mt-2 space-y-2 text-xs text-muted-foreground"><p>{zh ? "请在设备控制台执行下面的只读命令，或把指纹复制给设备管理员核对：" : "Run this read-only command in the device console, or copy the fingerprint to the device administrator:"}</p><code className="block overflow-x-auto rounded bg-muted p-2">ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code></div></details>
        <label className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm"><input className="mt-1" type="checkbox" checked={fingerprintAccepted} onChange={(event) => setFingerprintAccepted(event.target.checked)} /><span>{zh ? "我已核对指纹，确认这是我要连接的设备。" : "I compared the fingerprint and confirmed this is the device I intend to connect to."}</span></label>
      </div> : null}
      {stage === "scope" ? <div className="space-y-3">
        <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{zh ? "系统只检查约定的网站和内容目录，不会扫描主目录或系统目录。选择一个推荐文件夹即可完成。" : "Only conventional website and content locations are checked. Home and system directories are never scanned. Choose a suggested folder to finish."}</div>
        {scopeSuggestions.isLoading ? <div className="flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground"><Loader2 className="animate-spin" />{zh ? "正在查找可安全访问的文件夹…" : "Finding folders that can be accessed safely…"}</div> : null}
        {scopeSuggestions.data?.suggestions.length ? <fieldset className="space-y-2"><legend className="text-sm font-medium">{zh ? "推荐文件夹" : "Suggested folders"}</legend>{scopeSuggestions.data.suggestions.map((suggestion) => <label key={suggestion.rootPath} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${scope.rootPath === suggestion.rootPath ? "border-primary bg-primary/[0.04]" : "hover:bg-muted/50"}`}><input className="mt-1" type="radio" name="scope-suggestion" checked={scope.rootPath === suggestion.rootPath} onChange={() => chooseScopeSuggestion(suggestion)} /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-sm font-medium">{suggestion.label}{suggestion.recommended ? <StatusBadge tone="success">{zh ? "推荐" : "Recommended"}</StatusBadge> : null}</span><code className="mt-1 block break-all text-xs text-muted-foreground">{suggestion.rootPath}</code><span className="mt-1 block text-xs text-muted-foreground">{suggestionReason(suggestion)}</span></span></label>)}</fieldset> : null}
        {!scopeSuggestions.isLoading && !scopeSuggestions.data?.suggestions.length ? <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-muted-foreground">{scopeSuggestions.error ? (zh ? "暂时无法自动查找文件夹，可以手动填写管理员提供的专用目录。" : "Folders could not be discovered automatically. Enter a dedicated directory provided by the administrator.") : (zh ? "没有找到约定的内容目录，请填写管理员提供的专用目录。" : "No conventional content directory was found. Enter a dedicated directory provided by the administrator.")}</p> : null}
        <details open={manualScopeOpen} onToggle={(event) => setManualScopeOpen(event.currentTarget.open)} className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{scopeSuggestions.data?.suggestions.length ? (zh ? "使用其他文件夹" : "Use another folder") : (zh ? "手动填写文件夹" : "Enter a folder manually")}</summary><div className="mt-3 space-y-3"><Field label={zh ? "范围名称" : "Range name"}><Input value={scope.label} onChange={(event) => setScope({ ...scope, label: event.target.value })} /></Field><Field label={zh ? "远程目录" : "Remote directory"} required><Input className="font-mono" value={scope.rootPath} placeholder="/srv/www/site" onChange={(event) => { setScopeRootTouched(true); setScope({ ...scope, rootPath: event.target.value }); }} /></Field></div></details>
        <Field label={zh ? "用途" : "Purpose"}><Select value={scope.purpose} onChange={(event) => setScope({ ...scope, purpose: event.target.value as HostFileScopePurpose })}>{host?.purposes.includes("site_publish") ? <option value="site_publish">{zh ? "站点发布" : "Site publishing"}</option> : null}{host?.purposes.includes("tls_certificate") || host?.purposes.includes("site_publish") ? <option value="tls_certificate">{zh ? "HTTPS 证书专用" : "HTTPS certificates only"}</option> : null}<option value="general_files">{zh ? "普通文件" : "General files"}</option><option value="backup">{zh ? "备份" : "Backup"}</option></Select></Field>
        {scope.purpose === "tls_certificate" ? <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">{zh ? "证书范围不会出现在文件浏览和下载入口；只有受控证书部署可以写入。" : "Certificate ranges are excluded from file browsing and downloads; only controlled certificate deployment can write to them."}</p> : <div className="rounded-lg border p-3"><p className="mb-2 text-sm font-medium">{zh ? "允许的传输" : "Allowed transfers"}</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={scope.upload} onChange={(event) => setScope({ ...scope, upload: event.target.checked })} />{zh ? "上传（最大 10 MB，默认保留两份）" : "Upload (10 MB max, keep both by default)"}</label><label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={scope.download} onChange={(event) => setScope({ ...scope, download: event.target.checked })} />{zh ? "下载（最大 25 MB，阻止敏感文件）" : "Download (25 MB max, sensitive files blocked)"}</label></div>}
      </div> : null}
      {mutationError ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{errorText(mutationError, zh)}</p> : null}
    </div>
  </Modal>;
}

function Field({ label, children, required = false }: { label: string; children: React.ReactNode; required?: boolean }) { return <label className="space-y-1.5 text-sm"><span className={`font-medium ${required ? "after:ml-1 after:text-destructive after:content-['*']" : ""}`}>{label}</span>{children}</label>; }
function Notice({ title, detail, action, loading = false }: { title: string; detail?: string; action?: React.ReactNode; loading?: boolean }) { return <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center">{loading ? <Loader2 className="size-7 animate-spin text-muted-foreground" /> : <Server className="size-7 text-muted-foreground" />}<h3 className="font-semibold">{title}</h3>{detail ? <p className="max-w-lg text-sm text-muted-foreground">{detail}</p> : null}{action}</div>; }
function formatBytes(value: number) { return value >= 1024 * 1024 ? `${(value / (1024 * 1024)).toFixed(1)} MB` : value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${value} B`; }
