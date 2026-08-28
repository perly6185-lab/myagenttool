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
  Search,
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
import { HOST_DIAGNOSTIC_QUICK_ACTIONS, hostDiagnosticPlan, hostDiagnosticPlanCopy, hostDiagnosticSummaryCopy, parseHostLoginAuditEvents, suggestHostDiagnostic } from "./host-assistant";
import type { HostAuthMethod, HostDiagnosticAction, HostDiagnosticResult, HostDiagnosticSummary, HostFileConflictPolicy, HostFileEntry, HostFileScope, HostFileScopePurpose, HostFileScopeSuggestion, HostFileSearchResult, HostFileTransfer, SshHost } from "./host-types";

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
    ssh_sftp_permission_denied: ["设备不再允许操作这个文件夹。请检查文件夹权限后再继续。", "The device no longer allows access to this folder. Check the folder permission before continuing."],
    ssh_sftp_no_space: ["设备可用空间不足。请先清理空间，再核对文件并重新开始。", "The device does not have enough available space. Free some space, check the file, and start again."],
    ssh_sftp_unavailable: ["设备当前未提供文件连接。请检查设备连接和 SFTP 设置。", "The device is not currently providing file access. Check the device connection and SFTP settings."],
    ssh_sftp_operation_timeout: ["文件操作超时，无法确认最终结果。请先核对设备上的文件。", "The file operation timed out, so its final result is unknown. Check the file on the device first."],
    ssh_sftp_operation_failed: ["文件操作没有完成，最终结果无法确认。请先核对设备上的文件。", "The file operation did not finish, so its final result is unknown. Check the file on the device first."],
    host_file_transfer_failed: ["文件传输没有完成，最终结果无法确认。请先核对设备上的文件。", "The file transfer did not finish, so its final result is unknown. Check the file on the device first."],
    host_file_transfer_interrupted: ["应用在确认结果前中断。请先核对设备上的文件，避免重复传输。", "The app stopped before confirming the result. Check the file on the device first to avoid a duplicate transfer."],
    host_file_scope_symlink_forbidden: ["这个目录是快捷入口。为避免跳出允许范围，请选择它指向的真实目录。", "This directory is a shortcut. Choose its real target so access cannot leave the approved range."],
    host_file_scope_escape_blocked: ["远程目录已偏离批准范围，浏览已停止。", "The remote directory moved outside its approved range, so browsing stopped."],
    host_file_listing_too_large: ["该目录项目过多，请先在主机上整理为更小的子目录。", "This directory has too many items. Organize it into smaller subdirectories first."],
    host_file_conflict: ["远端已有同名文件，请选择保留两份或明确确认覆盖。", "A remote file has the same name. Keep both or explicitly confirm replacement."],
    host_file_upload_size_invalid: ["文件为空或超过 10 MB 上传上限。", "The file is empty or exceeds the 10 MB upload limit."],
    host_file_download_size_invalid: ["该文件超过 25 MB 浏览器安全下载上限。", "The file exceeds the 25 MB safe browser download limit."],
    host_file_download_sensitive_blocked: ["该文件可能包含密钥或环境凭据，禁止通过浏览器下载。", "This file may contain keys or environment credentials and cannot be downloaded in the browser."],
    host_file_search_query_invalid: ["请输入具体的文件名或正文关键词。", "Enter a specific file name or text keyword."],
    host_file_scope_revision_conflict: ["允许访问的文件夹刚刚发生变化，请刷新后重新查找。", "The approved folder changed. Refresh it before searching again."],
    host_file_preview_not_allowed: ["这个文件夹只允许查看名称，不能读取文件内容。", "This folder allows names to be viewed but does not allow file contents to be read."],
    host_file_preview_sensitive_blocked: ["该文件可能包含密钥或环境凭据，已阻止预览。", "This file may contain keys or environment credentials, so preview was blocked."],
    host_file_preview_size_invalid: ["文件超过安全预览上限，可以在确认后下载并在本地打开。", "The file exceeds the safe preview limit. You can confirm a download and open it locally."],
    host_file_preview_type_unsupported: ["该类型暂不支持安全预览。", "This file type is not available for safe preview."],
    host_file_preview_content_invalid: ["文件内容与类型不一致，已停止预览。", "The file content does not match its type, so preview was stopped."],
    host_file_preview_changed: ["文件在读取过程中发生变化，已停止预览。请确认文件稳定后再打开。", "The file changed while it was being read. Preview stopped; open it again after the file is stable."],
    host_file_preview_incomplete: ["文件读取未完成，无法确认内容是否完整。请稍后重新打开。", "The file could not be read completely. Open it again later."],
    host_file_atomic_replace_unavailable: ["此主机不支持安全的原子覆盖，请改为“保留两份”。", "This host cannot replace files atomically. Choose Keep both."],
    host_file_transfer_retry_limit: ["该任务已达到最多 3 次尝试，请检查主机后重新发起。", "This task reached the three-attempt limit. Check the host and start a new transfer."],
    ssh_diagnostic_confirmation_required: ["请先确认要执行这项只读诊断。", "Confirm the read-only diagnostic before it runs."],
    ssh_diagnostic_unsupported: ["暂不支持这类主机诊断。", "This host diagnostic is not supported yet."],
    ssh_host_not_ready: ["请先完成主机连接验证。", "Complete host connection verification first."],
    ssh_fixed_command_failed: ["主机没有完成这项诊断，请检查系统命令是否可用。", "The host did not complete this diagnostic. Check whether the system command is available."],
    ssh_fixed_command_timeout: ["主机诊断超时，请稍后重试。", "The host diagnostic timed out. Try again later."],
  };
  if (messages[code]) return messages[code][zh ? 0 : 1];
  if (error instanceof ApiError) return zh ? "操作未能完成，请稍后重试或检查设备状态。" : "The operation could not be completed. Try again later or check the device status.";
  return error instanceof Error ? error.message : (zh ? "操作未能完成。" : "The operation could not be completed.");
}

function hostStatus(host: SshHost, zh: boolean, professional: boolean) {
  if (host.connectionStatus === "ready") return { tone: "success" as const, label: professional ? (zh ? "连接正常" : "Ready") : (zh ? "状态正常" : "All good") };
  if (host.connectionStatus === "fingerprint_pending") return { tone: "warning" as const, label: professional ? (zh ? "等待确认指纹" : "Confirm fingerprint") : (zh ? "请确认设备" : "Confirm device") };
  if (host.connectionStatus === "error") {
    if (!professional && host.lastConnectionError?.code === "ssh_connection_refused") return { tone: "danger" as const, label: zh ? "连接服务未开启" : "Connection service is off" };
    if (!professional && ["ssh_connection_timeout", "ssh_connection_failed", "ssh_host_unreachable"].includes(host.lastConnectionError?.code ?? "")) return { tone: "danger" as const, label: zh ? "设备离线" : "Device offline" };
    return { tone: "danger" as const, label: professional ? (zh ? "需要检查" : "Needs attention") : (zh ? "需要处理" : "Action needed") };
  }
  return { tone: "neutral" as const, label: professional ? (zh ? "尚未完成设置" : "Setup incomplete") : (zh ? "继续设置" : "Continue setup") };
}

export function MyHostsView() {
  const { i18n } = useAppTranslation();
  const zh = i18n.language.startsWith("zh");
  const professional = useUiStore((state) => state.experienceMode) === "professional";
  const queryClient = useQueryClient();
  const hosts = useQuery({ queryKey: ["my-hosts"], queryFn: hostApi.list });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupForNewHost, setSetupForNewHost] = useState(false);
  const [setupAllowPrivate, setSetupAllowPrivate] = useState(false);
  const selected = hosts.data?.hosts.find((host) => host.id === selectedId) ?? hosts.data?.hosts[0] ?? null;

  useEffect(() => {
    if (!selectedId && hosts.data?.hosts[0]) setSelectedId(hosts.data.hosts[0].id);
  }, [hosts.data?.hosts, selectedId]);

  const refresh = async () => queryClient.invalidateQueries({ queryKey: ["my-hosts"] });
  const copy = zh
    ? professional
      ? {
          eyebrow: "我的主机 · 专业视图", title: "我的主机", description: "安全连接自有主机，并把远程文件限制在经过验证的专用目录内。",
          add: "添加主机", empty: "尚未添加主机", emptyHint: "添加后会依次保存安全凭据、确认主机身份，并配置受控文件范围。",
        }
      : {
          eyebrow: "我的设备", title: "我的主机", description: "查看设备状态、管理文件，或者直接告诉 AI 你想做什么。",
          add: "添加设备", empty: "还没有添加设备", emptyHint: "连接自己的电脑或服务器后，就可以查看状态、管理文件并让 AI 帮你处理日常问题。",
        }
    : professional
      ? {
          eyebrow: "My hosts · Professional view", title: "My hosts", description: "Connect self-hosted servers and keep remote access inside verified dedicated directories.",
          add: "Add host", empty: "No hosts yet", emptyHint: "Add one to save a secure credential, confirm host identity, and configure a governed file range.",
        }
      : {
          eyebrow: "My devices", title: "My hosts", description: "Check device status, manage files, or tell AI what you want to do.",
          add: "Add device", empty: "No devices yet", emptyHint: "Connect your computer or server to check its status, manage files, and get help from AI.",
        };

  if (hosts.isLoading) return <Notice title={zh ? "正在读取主机…" : "Loading hosts…"} loading />;
  if (hosts.error) return <Notice title={zh ? "暂时无法读取主机" : "Hosts are temporarily unavailable"} detail={errorText(hosts.error, zh)} action={<Button variant="secondary" onClick={() => void hosts.refetch()}><RefreshCw />{zh ? "重试" : "Retry"}</Button>} />;

  return <div className="space-y-5">
    <SectionHeading eyebrow={copy.eyebrow} title={copy.title} description={copy.description} actions={<Button onClick={() => { setSetupForNewHost(true); setSetupOpen(true); }}><Plus />{copy.add}</Button>} />
    {!hosts.data?.hosts.length ? <Notice title={copy.empty} detail={copy.emptyHint} action={<Button onClick={() => { setSetupForNewHost(true); setSetupOpen(true); }}><Plus />{copy.add}</Button>} /> : (
      <div className="grid min-h-[480px] gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
        <Card className="h-fit"><CardContent className="p-2">{hosts.data.hosts.map((host) => {
          const status = hostStatus(host, zh, professional);
          return <button key={host.id} type="button" onClick={() => { setSelectedId(host.id); setTab("overview"); }} className={`w-full rounded-lg p-3 text-left transition-colors ${selected?.id === host.id ? "bg-primary/10" : "hover:bg-muted"}`}>
            <span className="flex items-center gap-2"><Server className="size-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-sm font-medium">{host.name}</span></span>
            <span className="mt-2 flex items-center justify-between gap-2"><StatusBadge tone={status.tone}>{status.label}</StatusBadge>{professional ? <span className="truncate font-mono text-[11px] text-muted-foreground">{host.host}</span> : null}</span>
          </button>;
        })}</CardContent></Card>
        {selected ? <HostDetail host={selected} tab={tab} setTab={setTab} zh={zh} professional={professional} onContinue={(options) => { setSetupForNewHost(false); setSetupAllowPrivate(Boolean(options?.allowPrivate)); setSetupOpen(true); }} /> : null}
      </div>
    )}
    <HostSetupDialog open={setupOpen} initialHost={setupForNewHost ? null : selected} allowPrivateByDefault={setupAllowPrivate} zh={zh} professional={professional} onClose={() => { setSetupOpen(false); setSetupForNewHost(false); setSetupAllowPrivate(false); }} onChanged={refresh} />
  </div>;
}

function HostDetail({ host, tab, setTab, zh, professional, onContinue }: { host: SshHost; tab: DetailTab; setTab: (tab: DetailTab) => void; zh: boolean; professional: boolean; onContinue: (options?: { allowPrivate?: boolean }) => void }) {
  const scopes = useQuery({ queryKey: ["my-host-scopes", host.id], queryFn: () => hostApi.scopes(host.id) });
  const labels: Record<DetailTab, string> = professional
    ? zh
      ? { overview: "概览", files: "远程文件", transfers: "传输任务", settings: "设置" }
      : { overview: "Overview", files: "Remote files", transfers: "Transfers", settings: "Settings" }
    : zh
      ? { overview: "主页", files: "文件", transfers: "最近活动", settings: "设置" }
      : { overview: "Home", files: "Files", transfers: "Recent activity", settings: "Settings" };
  const visibleTabs = (Object.keys(labels) as DetailTab[]).filter((key) => professional || key !== "settings");
  const visibleTab = professional || tab !== "settings" ? tab : "overview";
  const status = hostStatus(host, zh, professional);
  return <Card className="min-w-0"><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{host.name}</CardTitle>{professional ? <p className="mt-1 font-mono text-xs text-muted-foreground">{host.user}@{host.host}:{host.port}</p> : <p className="mt-1 text-xs text-muted-foreground">{zh ? "已确认是你的设备" : "Confirmed as your device"}</p>}</div><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div><div className="mt-3 flex flex-wrap gap-1 border-b">{visibleTabs.map((key) => <button key={key} type="button" onClick={() => setTab(key)} className={`border-b-2 px-3 py-2 text-sm ${visibleTab === key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{labels[key]}</button>)}</div></CardHeader>
    <CardContent>
      {visibleTab === "overview" ? <HostOverview host={host} scopeCount={scopes.data?.count ?? 0} zh={zh} professional={professional} onContinue={onContinue} /> : null}
      {visibleTab === "files" ? <RemoteFiles host={host} scopes={scopes.data?.scopes ?? []} loading={scopes.isLoading} error={scopes.error} zh={zh} professional={professional} onAdd={onContinue} /> : null}
      {visibleTab === "transfers" ? <TransferHistory host={host} scopes={scopes.data?.scopes ?? []} zh={zh} professional={professional} onInspectFiles={() => setTab("files")} onInspectHost={() => setTab("overview")} /> : null}
      {professional && visibleTab === "settings" ? <HostTechnicalSettings host={host} zh={zh} /> : null}
    </CardContent>
  </Card>;
}

function HostOverview({ host, scopeCount, zh, professional, onContinue }: { host: SshHost; scopeCount: number; zh: boolean; professional: boolean; onContinue: (options?: { allowPrivate?: boolean }) => void }) {
  const ready = host.connectionStatus === "ready";
  const recovery = hostRecovery(host, zh, professional);
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3">
      <Summary icon={ready ? CheckCircle2 : TriangleAlert} label={professional ? (zh ? "连接" : "Connection") : (zh ? "设备状态" : "Device status")} value={ready ? professional ? (zh ? "已验证" : "Verified") : (zh ? "可以使用" : "Ready to use") : professional ? (zh ? "未完成" : "Incomplete") : (zh ? "需要处理" : "Action needed")} />
      <Summary icon={FolderLock} label={professional ? (zh ? "文件范围" : "File ranges") : (zh ? "我的文件夹" : "My folders")} value={zh ? `${scopeCount} 个可用` : `${scopeCount} available`} />
      <Summary icon={professional ? ShieldCheck : Sparkles} label={professional ? (zh ? "文件操作" : "File access") : (zh ? "AI 助手" : "AI assistant")} value={professional ? (zh ? "范围内受控传输" : "Governed transfers") : (zh ? "可以直接查看设备" : "Ready to check this device")} />
    </div>
    {!ready || !scopeCount ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{recovery.title}</p><p className="mt-1 text-xs text-muted-foreground">{recovery.detail}</p></div><Button onClick={() => onContinue(recovery.allowPrivate ? { allowPrivate: true } : undefined)}>{recovery.action}<ChevronRight /></Button></div> : null}
    {professional && host.lastConnectionError ? <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{errorText(new ApiError(host.lastConnectionError.code, host.lastConnectionError.code, 0), zh)}</p> : null}
    <HostAssistant host={host} zh={zh} professional={professional} onRepairCredential={onContinue} />
  </div>;
}

function hostRecovery(host: SshHost, zh: boolean, professional: boolean) {
  if (host.connectionStatus === "ready") return professional
    ? { title: zh ? "添加一个文件范围" : "Add a file range", detail: zh ? "只有批准目录内的文件可以被查看。" : "Only files inside an approved directory can be viewed.", action: zh ? "继续设置" : "Continue setup", allowPrivate: false }
    : { title: zh ? "添加一个常用文件夹" : "Add a folder you use", detail: zh ? "添加后可以直接浏览、搜索和传输里面的文件，AI 也能在这个文件夹里帮你查找资料。" : "Browse, search, and transfer its files directly. AI can also help find information in this folder.", action: zh ? "添加文件夹" : "Add folder", allowPrivate: false };
  const code = host.lastConnectionError?.code ?? "";
  if (code === "ssh_host_private_network_blocked") return professional
    ? { title: zh ? "需要允许访问内网设备" : "Local-network access needs approval", detail: zh ? "这是局域网地址。允许后会重新检查设备连接。" : "This is a local-network address. Approve it to check the device again.", action: zh ? "允许内网并重试" : "Allow local network and retry", allowPrivate: true }
    : { title: zh ? "确认这是你的局域网设备" : "Confirm this local device is yours", detail: zh ? "首次连接确认一次，以后会直接使用这台设备。" : "Confirm once on the first connection, then use this device directly.", action: zh ? "确认并连接" : "Confirm and connect", allowPrivate: true };
  if (!professional && ["ssh_authentication_failed", "ssh_credential_unavailable", "ssh_credential_invalid"].includes(code)) return { title: zh ? "登录信息需要更新" : "Sign-in details need updating", detail: zh ? `${errorText(new ApiError(code, code, 0), zh)} 连接尚未建立，文件没有被访问。` : `${errorText(new ApiError(code, code, 0), zh)} The connection was not established and no files were accessed.`, action: zh ? "重新输入登录信息" : "Update sign-in details", allowPrivate: false };
  if (!professional && code === "ssh_host_fingerprint_changed") return { title: zh ? "设备身份发生变化" : "Device identity changed", detail: zh ? "为保护文件，连接已在访问文件前停止。请确认你仍在连接同一台设备。" : "The connection stopped before file access. Confirm that this is still the same device.", action: zh ? "检查设备身份" : "Check device identity", allowPrivate: false };
  if (!professional && code === "ssh_connection_refused") return { title: zh ? "设备在线，但连接服务未开启" : "The device is online, but its connection service is off", detail: zh ? "文件没有被访问。请在设备上开启远程登录或 SSH，并确认端口设置。" : "No files were accessed. Turn on Remote Login or SSH on the device and check the port.", action: zh ? "检查连接设置" : "Check connection settings", allowPrivate: false };
  if (!professional && ["ssh_connection_timeout", "ssh_connection_failed", "ssh_host_unreachable"].includes(code)) return { title: zh ? "设备暂时离线" : "The device is temporarily offline", detail: zh ? "当前没有访问设备文件。请确认设备已开机、网络正常，再重新连接。" : "No device files were accessed. Make sure the device is on and connected to the network, then reconnect.", action: zh ? "设备上线后重试" : "Retry when online", allowPrivate: false };
  if (!professional && code === "ssh_host_unresolvable") return { title: zh ? "找不到这个设备地址" : "This device address cannot be found", detail: zh ? "文件没有被访问。请检查设备名称或地址是否正确。" : "No files were accessed. Check the device name or address.", action: zh ? "修改设备地址" : "Change device address", allowPrivate: false };
  if (!professional && code === "ssh_host_address_forbidden") return { title: zh ? "这个设备地址不能使用" : "This device address cannot be used", detail: errorText(new ApiError(code, code, 0), zh), action: zh ? "修改设备地址" : "Change device address", allowPrivate: false };
  if (!professional && host.connectionStatus === "fingerprint_pending") return { title: zh ? "确认这是你的设备" : "Confirm this is your device", detail: zh ? "首次连接需要你确认设备身份，然后才能查看文件。" : "Confirm the device on the first connection before viewing files.", action: zh ? "确认设备" : "Confirm device", allowPrivate: false };
  return { title: professional ? (zh ? "继续完成安全连接" : "Complete secure connection") : (zh ? "继续连接这台设备" : "Continue connecting this device"), detail: professional ? (zh ? "输入登录信息后，系统会验证设备并保护远程文件。" : "After sign-in, we will verify the device and protect remote files.") : (zh ? "检查地址和登录信息后即可继续。" : "Check the address and sign-in details to continue."), action: professional ? host.connectionStatus === "error" ? (zh ? "检查并重试" : "Check and retry") : (zh ? "继续设置" : "Continue setup") : (zh ? "继续设置" : "Continue setup"), allowPrivate: false };
}

function Summary({ icon: Icon, label, value }: { icon: typeof Server; label: string; value: string }) {
  return <div className="rounded-lg border p-3"><Icon className="size-5 text-primary" /><p className="mt-3 text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>;
}

function HostAssistant({ host, zh, professional, onRepairCredential }: { host: SshHost; zh: boolean; professional: boolean; onRepairCredential: () => void }) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [plan, setPlan] = useState<ReturnType<typeof suggestHostDiagnostic>>(null);
  const [result, setResult] = useState<HostDiagnosticResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [credentialRepairNeeded, setCredentialRepairNeeded] = useState(false);
  const choose = (next: NonNullable<typeof plan>) => { setPlan(next); setResult(null); setMessage(null); setCredentialRepairNeeded(false); };
  const mutation = useMutation({
    mutationFn: (next: NonNullable<typeof plan>) => next.parameters ? hostApi.diagnose(host.id, next.action, next.parameters) : hostApi.diagnose(host.id, next.action),
    onSuccess: (response) => { setResult(response.result); setMessage(null); },
    onError: (error) => {
      setResult(null);
      setMessage(diagnosticFailureText(error, zh, professional));
      const repairNeeded = isCredentialDiagnosticFailure(error);
      setCredentialRepairNeeded(repairNeeded);
      if (repairNeeded) void queryClient.invalidateQueries({ queryKey: ["my-hosts"] });
    },
  });
  const selectAction = (next: NonNullable<typeof plan>) => {
    choose(next);
    if (!professional) mutation.mutate(next);
  };
  const planMutation = useMutation({
    mutationFn: () => hostApi.planDiagnostic(host.id, input.trim()),
    onSuccess: (response) => {
      selectAction({ ...hostDiagnosticPlan(response.plan.action, response.plan.parameters), command: response.plan.command, parameters: response.plan.parameters });
    },
    onError: () => {
      setPlan(null);
      setResult(null);
      setMessage(zh ? "我还没理解你的意思。可以换种说法，例如“看看最近谁登录过”，或者直接选择下面的一项。" : "I did not understand that yet. Try “show recent sign-ins” or choose one of the options below.");
    },
  });
  useEffect(() => { setInput(""); setPlan(null); setResult(null); setMessage(null); setCredentialRepairNeeded(false); }, [host.id]);
  useEffect(() => { if (host.connectionStatus !== "ready") { setPlan(null); setResult(null); } }, [host.connectionStatus]);
  const busy = planMutation.isPending || mutation.isPending;
  const submit = () => { if (input.trim() && !busy) planMutation.mutate(); };
  const ready = host.connectionStatus === "ready";
  const planCopy = plan ? hostDiagnosticPlanCopy(plan, zh) : null;
  return <div className="rounded-lg border bg-card p-4" data-testid="host-assistant">
    <div className="flex flex-wrap items-start gap-3"><span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><Bot className="size-5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{zh ? "问问 AI" : "Ask AI"}</p>{professional ? <StatusBadge tone="neutral"><Sparkles className="size-3" />{zh ? "只读检查" : "Read-only checks"}</StatusBadge> : <StatusBadge tone="success"><Sparkles className="size-3" />{zh ? "设备助手" : "Device assistant"}</StatusBadge>}</div><p className="mt-1 text-xs text-muted-foreground">{professional ? (zh ? "说出你遇到的问题。助手会先展示固定检查计划，确认后执行。" : "Describe the problem. The assistant shows a fixed inspection plan before it runs.") : (zh ? "直接问这台设备的空间、内存、程序、网络或最近登录情况。" : "Ask about this device's storage, memory, apps, network, or recent sign-ins.")}</p></div></div>
    <div className="mt-4 flex flex-col gap-2 sm:flex-row"><Input disabled={busy} value={input} placeholder={professional ? (zh ? "例如：看看磁盘还剩多少空间" : "For example: show remaining disk space") : (zh ? "例如：最近有谁登录过？" : "For example: who signed in recently?")} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submit(); }} /><Button variant="secondary" disabled={!input.trim() || !ready || busy} onClick={submit}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}{professional ? (zh ? "生成建议" : "Suggest") : (zh ? "查看" : "Ask")}</Button></div>
    <div className="mt-3 flex flex-wrap gap-2">{HOST_DIAGNOSTIC_QUICK_ACTIONS.map((item) => <Button key={item.action} size="sm" variant="ghost" disabled={!ready || busy} onClick={() => selectAction(hostDiagnosticPlan(item.action))}>{professional ? hostDiagnosticPlanCopy(item, zh).title : ordinaryDiagnosticLabel(item.action, zh)}</Button>)}</div>
    {!ready ? <p className="mt-3 rounded-lg bg-warning/10 p-3 text-xs text-muted-foreground">{zh ? "请先完成主机连接验证，助手才会访问设备。" : "Complete host connection verification before the assistant can access this device."}</p> : null}
    {professional && plan && planCopy && !result ? <div className="mt-4 space-y-3 rounded-lg border border-primary/25 bg-primary/[0.04] p-3"><div><p className="text-sm font-medium">{planCopy.title}</p><p className="mt-1 text-xs text-muted-foreground">{planCopy.explanation}</p></div><div className="rounded-md bg-muted p-3 text-sm"><span className="text-xs text-muted-foreground">{zh ? "将检查" : "Will check"}</span><p className="mt-1 font-medium">{planCopy.check}</p></div><code className="block overflow-x-auto rounded-md bg-muted p-3 text-xs">{plan.command || (zh ? "需要先指定服务名称" : "Specify a service name first")}</code><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{zh ? "只读 · 不会上传、删除、清理或重启服务" : "Read-only · no upload, deletion, cleanup, or service restart"}</span><Button disabled={!ready || !plan.command || mutation.isPending} onClick={() => mutation.mutate(plan)}>{mutation.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}{zh ? "确认并执行" : "Confirm and run"}</Button></div></div> : null}
    {!professional && mutation.isPending ? <div className="mt-4 flex items-center gap-2 rounded-lg bg-primary/[0.06] p-3 text-sm"><Loader2 className="size-4 animate-spin text-primary" />{zh ? "正在查看这台设备…" : "Checking this device…"}</div> : null}
    {message ? <div role="alert" className="mt-3 flex flex-wrap items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" /><p className="min-w-0 flex-1">{message}</p>{credentialRepairNeeded && ready ? <Button size="sm" variant="secondary" onClick={onRepairCredential}><KeyRound />{zh ? "重新输入登录信息" : "Update sign-in details"}</Button> : null}</div> : null}
    {result ? <div className="mt-4"><div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"><CheckCircle2 className="size-4 text-primary" />{professional ? (zh ? "检查结果（仅本次会话保留技术输出）" : "Check result (technical output is session-only)") : (zh ? "AI 已查看这台设备" : "AI checked this device")}</div><DiagnosticSummaryPanel summary={result.summary} zh={zh} professional={professional} />{!professional && result.action === "ssh_login_audit" ? <LoginAuditPanel output={result.output} zh={zh} /> : null}{professional ? <details className="mt-3 rounded-lg border p-3" open><summary className="cursor-pointer text-xs font-medium">{zh ? "技术证据" : "Technical evidence"}</summary><div className="mt-3 space-y-2"><code className="block overflow-x-auto rounded-md bg-muted p-3 text-xs">{result.command}</code>{result.resolvedAddress ? <p className="break-all text-xs text-muted-foreground">{zh ? "本次连接地址" : "Connection address"}: {result.resolvedAddress}</p> : null}<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs leading-5">{result.output || (zh ? "设备没有返回原始输出。" : "The device returned no raw output.")}</pre><p className="text-xs text-muted-foreground">{zh ? "原始输出只在本次页面会话显示，不写入诊断审计。" : "Raw output is shown only in this page session and is not written to diagnostic audit records."}</p></div></details> : null}</div> : null}
  </div>;
}

function ordinaryDiagnosticLabel(action: HostDiagnosticAction, zh: boolean) {
  const labels: Record<HostDiagnosticAction, readonly [string, string]> = {
    disk_usage: ["磁盘空间", "Storage"], memory_usage: ["内存", "Memory"], system_info: ["系统信息", "System"], uptime: ["运行状态", "Uptime"],
    ssh_login_audit: ["最近登录", "Recent sign-ins"], processes: ["程序占用", "App usage"], listening_ports: ["网络服务", "Network services"],
    docker_status: ["容器", "Containers"], network_info: ["网络状态", "Network"], login_sessions: ["当前登录", "Current sign-ins"],
    failed_services: ["异常服务", "Failed services"], service_status: ["服务状态", "Service status"], recent_logs: ["最近事件", "Recent events"],
  };
  return labels[action][zh ? 0 : 1];
}

function isCredentialDiagnosticFailure(error: unknown) {
  const code = error instanceof ApiError ? error.code : "";
  return ["ssh_authentication_failed", "ssh_credential_unavailable", "ssh_credential_invalid"].includes(code);
}

function diagnosticFailureText(error: unknown, zh: boolean, professional: boolean) {
  const code = error instanceof ApiError ? error.code : "";
  if (!professional) {
    if (["ssh_authentication_failed", "ssh_credential_unavailable", "ssh_credential_invalid", "ssh_agent_unavailable"].includes(code)) return zh ? "需要重新登录这台设备，然后再试一次。" : "Sign in to this device again, then retry.";
    if (code === "ssh_fixed_command_failed" || code === "ssh_diagnostic_unsupported") return zh ? "这台设备暂时看不了这一项，可以换一项继续。" : "This item is not available on the device right now. Try another one.";
    if (code === "ssh_fixed_command_timeout" || code === "ssh_connection_timeout") return zh ? "查看超时了。确认设备在线后再试一次。" : "That took too long. Confirm the device is online and try again.";
    if (["ssh_connection_failed", "ssh_connection_refused", "ssh_host_unreachable"].includes(code)) return zh ? "现在连不上这台设备，请先检查设备是否在线。" : "This device cannot be reached right now. Check that it is online.";
    return errorText(error, zh);
  }
  if (["ssh_authentication_failed", "ssh_credential_unavailable", "ssh_credential_invalid", "ssh_agent_unavailable"].includes(code)) return zh ? "无法读取这台设备的登录信息。请先重新输入密码或私钥，再重试检查；设备和文件没有被修改。" : "The sign-in details for this device are unavailable. Re-enter the password or private key before retrying. No device settings or files were changed.";
  if (code === "ssh_fixed_command_failed" || code === "ssh_diagnostic_unsupported") return zh ? "这台设备无法完成该项只读检查，设备和文件没有被修改。请选择另一项检查或查看专业设置。" : "This device could not complete that read-only check. No device settings or files were changed. Choose another check or review Professional settings.";
  if (code === "ssh_fixed_command_timeout" || code === "ssh_connection_timeout") return zh ? "检查等待超时，设备和文件没有被修改。确认设备在线后再手动重试。" : "The check timed out. No device settings or files were changed. Confirm the device is online before retrying manually.";
  if (["ssh_connection_failed", "ssh_connection_refused", "ssh_host_unreachable"].includes(code)) return zh ? "检查期间无法连接设备，文件没有被访问。请先恢复设备连接。" : "The device could not be reached during the check. No files were accessed. Restore the device connection first.";
  return `${errorText(error, zh)} ${zh ? "没有自动修改设备。" : "The device was not changed automatically."}`;
}

function DiagnosticSummaryPanel({ summary, zh, professional }: { summary: HostDiagnosticSummary; zh: boolean; professional: boolean }) {
  const copy = hostDiagnosticSummaryCopy(summary, zh, !professional);
  const tone = summary.severity === "healthy" ? "success" : summary.severity === "critical" ? "danger" : summary.severity === "warning" ? "warning" : "neutral";
  const severity = summary.severity === "healthy" ? (zh ? "正常" : "Looks good") : summary.severity === "critical" ? (zh ? "需要处理" : "Needs attention") : summary.severity === "warning" ? (zh ? "请留意" : "Warning") : summary.severity === "unknown" ? (zh ? "无法确认" : "Unknown") : (zh ? "信息" : "Information");
  return <div className="space-y-3 rounded-lg border p-3" data-testid="diagnostic-summary"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{copy.finding}</p><StatusBadge tone={tone}>{severity}</StatusBadge></div>{copy.facts.length ? <div className="grid gap-2 sm:grid-cols-2">{copy.facts.map((item) => <div key={`${item.key}-${item.value}`} className="rounded-md bg-muted px-3 py-2 text-xs"><span className="text-muted-foreground">{item.label}</span><strong className="mt-1 block text-sm">{item.value}</strong></div>)}</div> : null}<div className="grid gap-2 text-sm sm:grid-cols-2"><div className="rounded-md bg-muted/60 p-3"><span className="text-xs text-muted-foreground">{professional ? (zh ? "影响" : "Impact") : (zh ? "这意味着" : "What this means")}</span><p className="mt-1">{copy.impact}</p></div><div className="rounded-md bg-primary/[0.06] p-3"><span className="text-xs text-muted-foreground">{professional ? (zh ? "下一步" : "Next step") : (zh ? "建议" : "Suggestion")}</span><p className="mt-1 font-medium">{copy.nextAction}</p></div></div></div>;
}

function LoginAuditPanel({ output, zh }: { output: string; zh: boolean }) {
  const events = parseHostLoginAuditEvents(output);
  if (!events.length) return null;
  const labels = {
    success: zh ? "成功" : "Successful",
    failed: zh ? "失败" : "Failed",
    invalid_user: zh ? "账号不存在" : "Unknown account",
    preauth: zh ? "认证前断开" : "Disconnected before sign-in",
  } as const;
  return <div className="mt-3 space-y-2 rounded-lg border p-3" data-testid="login-audit-events">
    <div><p className="text-sm font-medium">{zh ? "最近登录记录" : "Recent sign-in activity"}</p><p className="mt-1 text-xs text-muted-foreground">{zh ? "最近 24 小时，按时间从近到远排列。" : "The last 24 hours, newest first."}</p></div>
    <div className="divide-y rounded-md border">{events.map((event, index) => <div key={`${event.time}-${event.source}-${index}`} className="grid gap-2 p-3 text-xs sm:grid-cols-[145px_90px_minmax(0,1fr)] sm:items-center">
      <span className="text-muted-foreground">{formatAuditTime(event.time, zh)}</span>
      <StatusBadge tone={event.status === "success" ? "success" : event.status === "preauth" ? "neutral" : "warning"}>{labels[event.status]}</StatusBadge>
      <span className="min-w-0"><strong className="block truncate">{event.user || (zh ? "未识别账号" : "Unknown account")}</strong><span className="block truncate text-muted-foreground">{zh ? "来源" : "From"}: {event.source || (zh ? "未知" : "Unknown")}</span></span>
    </div>)}</div>
  </div>;
}

function formatAuditTime(value: string, zh: boolean) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat(zh ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(parsed);
}

function RemoteFiles({ host, scopes, loading, error, zh, professional, onAdd }: { host: SshHost; scopes: HostFileScope[]; loading: boolean; error: unknown; zh: boolean; professional: boolean; onAdd: () => void }) {
  const [scopeId, setScopeId] = useState<string>("");
  useEffect(() => { if (!scopeId && scopes[0]) setScopeId(scopes[0].id); }, [scopeId, scopes]);
  if (loading) return <Notice title={professional ? (zh ? "正在读取文件范围…" : "Loading file ranges…") : (zh ? "正在读取允许的文件夹…" : "Loading approved folders…")} loading />;
  if (error) return <Notice title={professional ? (zh ? "无法读取文件范围" : "File ranges unavailable") : (zh ? "无法读取允许的文件夹" : "Approved folders unavailable")} detail={errorText(error, zh)} />;
  if (!scopes.length) return <Notice title={professional ? (zh ? "尚未配置文件范围" : "No file range configured") : (zh ? "还没有允许访问的文件夹" : "No approved folder yet")} detail={professional ? (zh ? "请选择主机管理员准备好的专用目录。系统不会允许浏览主目录或系统目录。" : "Choose a dedicated directory prepared by the host administrator. Home and system directories are not allowed.") : (zh ? "请选择这台设备上专门用于当前工作的文件夹；应用不会访问其他位置。" : "Choose a folder dedicated to this work. The app will not access other locations.")} action={<Button disabled={host.connectionStatus !== "ready"} onClick={onAdd}><Plus />{professional ? (zh ? "添加文件范围" : "Add file range") : (zh ? "选择文件夹" : "Choose folder")}</Button>} />;
  const scope = scopes.find((item) => item.id === scopeId) ?? scopes[0];
  const transferEnabled = scope.permissions.includes("upload") || scope.permissions.includes("download");
  const certificateOnly = scope.purpose === "tls_certificate";
  return <div className="space-y-3"><div className="flex flex-wrap items-center gap-2"><Select aria-label={professional ? (zh ? "选择文件范围" : "Select file range") : (zh ? "选择允许的文件夹" : "Select approved folder")} value={scope.id} onChange={(event) => setScopeId(event.target.value)} className="max-w-xs">{scopes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select><StatusBadge tone={scope.status === "ready" ? "success" : "warning"}>{scope.status === "ready" ? (certificateOnly ? professional ? (zh ? "证书专用" : "Certificate only") : (zh ? "由我的站点管理" : "Managed by My Site") : transferEnabled ? professional ? (zh ? "受控传输" : "Governed transfer") : (zh ? "可上传和下载" : "Upload and download") : professional ? (zh ? "只读范围" : "Read-only range") : (zh ? "只可查看" : "View only")) : (zh ? "已停用" : "Disabled")}</StatusBadge>{professional || !certificateOnly ? <ScopeEditButton host={host} scope={scope} zh={zh} professional={professional} /> : null}<Button size="sm" variant="secondary" onClick={onAdd}><Plus />{professional ? (zh ? "添加范围" : "Add range") : (zh ? "添加文件夹" : "Add folder")}</Button></div>{scope.status === "ready" ? certificateOnly ? professional ? <TlsActivationProfiles host={host} scope={scope} zh={zh} /> : <ManagedCertificateFolderNotice zh={zh} /> : <FileBrowser key={`${scope.id}-${scope.revision}`} scope={scope} zh={zh} professional={professional} /> : <Notice title={professional ? (zh ? "此文件范围已停用" : "This file range is disabled") : (zh ? "此文件夹已停用" : "This folder is disabled")} detail={professional ? (zh ? "在“范围设置”中重新启用后才能浏览。" : "Enable it again in Range settings before browsing.") : (zh ? "在“文件夹设置”中重新启用后才能浏览。" : "Enable it again in Folder settings before browsing.")} />}</div>;
}

function ManagedCertificateFolderNotice({ zh }: { zh: boolean }) {
  return <div className="rounded-lg border bg-muted/20 p-4"><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><ShieldCheck className="size-5" /></span><div><p className="text-sm font-medium">{zh ? "这个文件夹由“我的站点”安全管理" : "This folder is safely managed by My Site"}</p><p className="mt-1 text-xs text-muted-foreground">{zh ? "它用于网站 HTTPS，不会在这里开放浏览、上传或下载。需要管理网站时，请前往“我的站点”。" : "It is used for website HTTPS and cannot be browsed, uploaded to, or downloaded here. Use My Site to manage the website."}</p></div></div></div>;
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

function ScopeEditButton({ host, scope, zh, professional }: { host: SshHost; scope: HostFileScope; zh: boolean; professional: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ label: scope.label, rootPath: scope.rootPath, purpose: scope.purpose, disabled: scope.status === "disabled", upload: scope.permissions.includes("upload"), download: scope.permissions.includes("download") });
  useEffect(() => setForm({ label: scope.label, rootPath: scope.rootPath, purpose: scope.purpose, disabled: scope.status === "disabled", upload: scope.permissions.includes("upload"), download: scope.permissions.includes("download") }), [scope]);
  const mutation = useMutation({
    mutationFn: () => hostApi.updateScope(host.id, scope.id, { expectedRevision: scope.revision, label: form.label, rootPath: form.rootPath, purpose: form.purpose, status: form.disabled ? "disabled" : "ready", permissions: ["list", ...(form.upload ? ["upload" as const] : []), ...(form.download ? ["download" as const] : [])] }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["my-host-scopes", host.id] }); await queryClient.invalidateQueries({ queryKey: ["host-file-entries", scope.id] }); setOpen(false); },
  });
  return <><Button size="sm" variant="ghost" onClick={() => setOpen(true)}>{professional ? (zh ? "范围设置" : "Range settings") : (zh ? "文件夹设置" : "Folder settings")}</Button><Modal open={open} onClose={() => setOpen(false)} title={professional ? (zh ? "文件范围设置" : "File range settings") : (zh ? "允许访问的文件夹设置" : "Approved folder settings")} description={professional ? (zh ? "更改目录会重新连接主机，并再次验证完整路径边界。传输权限可随时单独关闭。" : "Changing the directory reconnects and verifies the path boundary again. Transfer permissions can be disabled independently.") : (zh ? "更改文件夹后会重新检查访问边界；上传和下载可以分别关闭。" : "Changing the folder rechecks its access boundary. Upload and download can be disabled separately.")} footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>{zh ? "取消" : "Cancel"}</Button><Button disabled={!form.label.trim() || !form.rootPath.trim() || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}{zh ? "验证并保存" : "Verify and save"}</Button></div>}><div className="space-y-3"><Field label={professional ? (zh ? "范围名称" : "Range name") : (zh ? "文件夹名称" : "Folder name")}><Input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} /></Field><Field label={zh ? "远程目录" : "Remote directory"}><Input className="font-mono" value={form.rootPath} onChange={(event) => setForm({ ...form, rootPath: event.target.value })} /></Field><Field label={zh ? "用途" : "Purpose"}><Select value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value as HostFileScopePurpose })}><option value="site_publish">{zh ? "站点发布" : "Site publishing"}</option><option value="tls_certificate">{zh ? "HTTPS 证书专用" : "HTTPS certificates only"}</option><option value="general_files">{zh ? "普通文件" : "General files"}</option><option value="backup">{zh ? "备份" : "Backup"}</option></Select></Field>{form.purpose === "tls_certificate" ? <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{zh ? "此范围不开放浏览、上传或下载，只供证书管理器写入。" : "This range does not allow browsing, uploads, or downloads. Only the certificate manager can write to it."}</p> : <div className="rounded-lg border p-3"><p className="mb-2 text-sm font-medium">{zh ? "允许的操作" : "Allowed operations"}</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.upload} onChange={(event) => setForm({ ...form, upload: event.target.checked })} />{zh ? "允许确认后上传（单文件最大 10 MB）" : "Allow confirmed uploads (10 MB per file)"}</label><label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.download} onChange={(event) => setForm({ ...form, download: event.target.checked })} />{zh ? "允许确认后下载（单文件最大 25 MB）" : "Allow confirmed downloads (25 MB per file)"}</label></div>}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.disabled} onChange={(event) => setForm({ ...form, disabled: event.target.checked })} />{professional ? (zh ? "暂时停用此范围" : "Temporarily disable this range") : (zh ? "暂时停用此文件夹" : "Temporarily disable this folder")}</label>{mutation.error ? <p role="alert" className="text-sm text-destructive">{errorText(mutation.error, zh)}</p> : null}</div></Modal></>;
}

function FileBrowser({ scope, zh, professional }: { scope: HostFileScope; zh: boolean; professional: boolean }) {
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
  const locate = (entry: HostFileSearchResult) => setPath(entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "");
  return <><FileSearchAssistant scope={scope} zh={zh} professional={professional} onPreview={setPreviewEntry} onLocate={locate} /><div className="overflow-hidden rounded-lg border"><div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2"><FolderLock className="size-4 text-muted-foreground" /><span className="text-xs font-medium">{scope.label}</span><code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">/{path}</code>{scope.permissions.includes("upload") ? <><input ref={uploadInput} className="hidden" type="file" onChange={(event) => { const file = event.target.files?.[0] ?? null; event.target.value = ""; setUploadFile(file); }} /><Button size="sm" variant="secondary" onClick={() => uploadInput.current?.click()}><ArrowUpFromLine />{zh ? "上传" : "Upload"}</Button></> : null}{path ? <Button size="sm" variant="ghost" onClick={() => setPath(parent)}><ArrowLeft />{zh ? "上一级" : "Up"}</Button> : null}</div>
    {query.data?.entries?.length ? <div className="flex flex-wrap gap-3 border-b bg-muted/10 px-3 py-2 text-xs text-muted-foreground" data-testid="directory-summary"><span>{zh ? `当前目录 ${query.data.entries.length} 项` : `${query.data.entries.length} items in this folder`}</span><span>{zh ? `已列出文件 ${formatBytes(listedBytes)}` : `${formatBytes(listedBytes)} in listed files`}</span></div> : null}
    {query.isLoading ? <div className="p-6 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 size-5 animate-spin" />{zh ? "正在安全读取目录…" : "Reading directory safely…"}</div> : query.error ? <Notice title={zh ? "目录未能打开" : "Directory could not be opened"} detail={errorText(query.error, zh)} action={<Button size="sm" variant="secondary" onClick={() => void query.refetch()}><RefreshCw />{zh ? "重试" : "Retry"}</Button>} /> : !query.data?.entries.length ? <div className="p-6 text-center text-sm text-muted-foreground">{zh ? "此目录为空。" : "This directory is empty."}</div> : null}
    {query.data?.entries?.length ? <div className="divide-y">{query.data.entries.map((entry) => <FileRow key={entry.path} entry={entry} zh={zh} canDownload={scope.permissions.includes("download")} onDownload={() => setDownloadEntry(entry)} onPreview={() => setPreviewEntry(entry)} onOpen={() => entry.type === "directory" && entry.accessible ? setPath(entry.path) : undefined} />)}</div> : null}
  </div><TransferConfirmDialog scope={scope} directory={path} uploadFile={uploadFile} downloadEntry={downloadEntry} zh={zh} onClose={() => { setUploadFile(null); setDownloadEntry(null); }} onCompleted={refresh} /><FilePreviewDialog scope={scope} entry={previewEntry} zh={zh} onClose={() => setPreviewEntry(null)} /></>;
}

function FileSearchAssistant({ scope, zh, professional, onPreview, onLocate }: { scope: HostFileScope; zh: boolean; professional: boolean; onPreview: (entry: HostFileEntry) => void; onLocate: (entry: HostFileSearchResult) => void }) {
  const [input, setInput] = useState("");
  const searchMutation = useMutation({ mutationFn: () => hostApi.search(scope.id, input.trim(), scope.revision) });
  const submit = () => { if (input.trim().length >= 2 && !searchMutation.isPending) searchMutation.mutate(); };
  const canPreview = scope.permissions.includes("download");
  return <div className="mb-3 rounded-lg border bg-card p-4" data-testid="host-file-search">
    <div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Search className="size-5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{zh ? "AI 文件助手" : "AI file assistant"}</p><StatusBadge tone="neutral"><FolderLock className="size-3" />{zh ? `只查找“${scope.label}”` : `Only “${scope.label}”`}</StatusBadge></div><p className="mt-1 text-xs text-muted-foreground">{canPreview ? (zh ? "输入文件名或正文关键词。系统会限量查找，正文不会直接出现在结果中。" : "Enter a file name or text keyword. Search is bounded and file text is not shown in results.") : (zh ? "这个文件夹只允许按名称查找；需要读取正文时，请先在文件夹设置中允许下载。" : "This folder allows name search only. Enable downloads in folder settings before searching file text.")}</p></div></div>
    <div className="mt-3 flex flex-col gap-2 sm:flex-row"><Input value={input} disabled={searchMutation.isPending} placeholder={zh ? "例如：部署说明，或 mytoolagent.com" : "For example: deployment guide or mytoolagent.com"} onChange={(event) => { setInput(event.target.value); if (searchMutation.data || searchMutation.error) searchMutation.reset(); }} onKeyDown={(event) => { if (event.key === "Enter") submit(); }} /><Button disabled={input.trim().length < 2 || searchMutation.isPending} onClick={submit}>{searchMutation.isPending ? <Loader2 className="animate-spin" /> : <Search />}{zh ? "查找文件" : "Find files"}</Button></div>
    {searchMutation.error ? <p role="status" className="mt-3 rounded-lg bg-muted p-3 text-sm text-muted-foreground">{errorText(searchMutation.error, zh)}</p> : null}
    {searchMutation.data ? <div className="mt-4 space-y-3" data-testid="host-file-search-results"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{searchMutation.data.count ? (zh ? `找到 ${searchMutation.data.count} 个文件` : `${searchMutation.data.count} files found`) : (zh ? "没有找到匹配文件" : "No matching files found")}</p>{searchMutation.data.boundaries.truncated ? <StatusBadge tone="warning">{zh ? "结果可能不完整" : "Partial results"}</StatusBadge> : <StatusBadge tone="success">{zh ? "查找完成" : "Search complete"}</StatusBadge>}</div>{!searchMutation.data.count ? <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{zh ? "可以换一个更短、更具体的文件名或正文关键词。" : "Try a shorter, more specific file name or text keyword."}</p> : <div className="divide-y rounded-lg border">{searchMutation.data.results.map((entry) => <div key={entry.path} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center"><span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted">{entry.previewKind === "image" ? <FileImage className="size-4" /> : <FileText className="size-4" />}</span><span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{entry.name}</span><span className="block break-all text-xs text-muted-foreground">{entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : (zh ? "文件夹根目录" : "Folder root")} · {entry.matchKind === "content" ? (zh ? "正文匹配" : "Text match") : (zh ? "名称匹配" : "Name match")}</span></span><div className="flex shrink-0 flex-wrap gap-1">{entry.restricted ? <StatusBadge tone="warning">{zh ? "敏感文件，已限制" : "Sensitive, restricted"}</StatusBadge> : <>{entry.previewKind && canPreview ? <Button size="sm" variant="secondary" onClick={() => onPreview(entry)}><Eye />{zh ? "安全预览" : "Safe preview"}</Button> : null}<Button size="sm" variant="ghost" onClick={() => onLocate(entry)}><Folder />{zh ? "打开位置" : "Open location"}</Button></>}</div></div>)}</div>}{professional ? <details className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium">{zh ? "查找边界" : "Search boundaries"}</summary><p className="mt-2">{zh ? `扫描 ${searchMutation.data.boundaries.scannedEntries} 项，限量读取 ${searchMutation.data.boundaries.scannedTextFiles} 个文本文件（${formatBytes(searchMutation.data.boundaries.readBytes)}），跳过 ${searchMutation.data.boundaries.skippedEntries} 项。` : `Scanned ${searchMutation.data.boundaries.scannedEntries} entries, read ${searchMutation.data.boundaries.scannedTextFiles} bounded text files (${formatBytes(searchMutation.data.boundaries.readBytes)}), and skipped ${searchMutation.data.boundaries.skippedEntries}.`}</p></details> : null}</div> : null}
  </div>;
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
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"].includes(extension)) return "image";
  if (extension === "pdf") return "pdf";
  if (["txt", "md", "json", "yaml", "yml", "log", "conf", "ini", "csv", "xml", "html", "css", "js", "ts", "sh", "svg"].includes(extension)) return "text";
  return null;
}

function FilePreviewDialog({ scope, entry, zh, onClose }: { scope: HostFileScope; entry: HostFileEntry | null; zh: boolean; onClose: () => void }) {
  const expectedKind = entry ? previewKind(entry.name) : null;
  const [kind, setKind] = useState<PreviewKind | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [text, setText] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  useEffect(() => {
    let cancelled = false;
    setStatus(entry ? "loading" : "idle");
    setKind(null);
    setText("");
    setUrl(null);
    setPreviewError(null);
    if (!entry || !expectedKind) return undefined;
    void hostApi.preview(scope.id, { path: entry.path, expectedRevision: scope.revision }).then(async (result) => {
      if (cancelled) return;
      if (result.kind === "text") {
        const nextText = await readBlobText(result.blob);
        if (cancelled) return;
        setText(nextText);
      }
      else {
        const nextUrl = URL.createObjectURL(new Blob([result.blob], { type: result.contentType }));
        if (cancelled) { URL.revokeObjectURL(nextUrl); return; }
        setUrl(nextUrl);
      }
      setKind(result.kind);
      setStatus("ready");
    }).catch((error) => { if (!cancelled) { setPreviewError(error); setStatus("error"); } });
    return () => { cancelled = true; };
  }, [entry, expectedKind, scope.id, scope.revision]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const title = entry ? (zh ? `预览：${entry.name}` : `Preview: ${entry.name}`) : "";
  return <Modal open={Boolean(entry)} onClose={onClose} title={title} description={zh ? "只读取批准范围内的文件，不会执行文件内容。" : "Reads a file inside the approved range; file contents are never executed."} size="xl" footer={<Button variant="secondary" onClick={onClose}>{zh ? "关闭" : "Close"}</Button>}>
    {status === "loading" ? <div className="p-8 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 size-5 animate-spin" />{zh ? "正在读取文件…" : "Reading file…"}</div> : null}
    {status === "error" ? <Notice title={zh ? "暂时无法预览" : "Preview unavailable"} detail={errorText(previewError, zh)} /> : null}
    {status === "ready" && kind === "text" ? <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-4 text-xs leading-5">{text}</pre> : null}
    {status === "ready" && kind === "image" && url ? <div className="grid max-h-[65vh] place-items-center overflow-auto rounded-lg bg-muted p-3"><img src={url} alt={entry?.name ?? ""} className="max-h-[60vh] max-w-full object-contain" /></div> : null}
    {status === "ready" && kind === "pdf" && url ? <iframe title={title} src={url} sandbox="" referrerPolicy="no-referrer" className="h-[65vh] w-full rounded-lg border" /> : null}
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

const TRANSFER_ALWAYS_CHECK_ERRORS = new Set(["ssh_sftp_permission_denied", "ssh_sftp_no_space", "host_file_transfer_interrupted", "ssh_host_fingerprint_changed", "ssh_authentication_failed", "ssh_credential_unavailable", "ssh_credential_invalid", "ssh_sftp_unavailable"]);
const AMBIGUOUS_UPLOAD_ERRORS = new Set(["ssh_connection_failed", "ssh_sftp_operation_timeout", "ssh_sftp_operation_failed", "host_file_transfer_failed"]);

function transferNeedsInspection(task: HostFileTransfer) {
  const code = task.errorCode ?? "";
  return TRANSFER_ALWAYS_CHECK_ERRORS.has(code) || (task.direction === "upload" && AMBIGUOUS_UPLOAD_ERRORS.has(code));
}

function ordinaryTransferRecovery(task: HostFileTransfer, zh: boolean) {
  if (task.errorCode === "ssh_sftp_permission_denied") return {
    detail: zh ? "设备不再允许操作这个文件夹，传输已停止。文件结果可能不完整；请先检查文件夹权限和内容。" : "The device no longer allows access to this folder, so the transfer stopped. The file result may be incomplete; check the folder permission and contents first.",
    action: "files" as const,
    label: zh ? "检查文件夹" : "Check folder",
  };
  if (task.errorCode === "ssh_sftp_no_space") return {
    detail: zh ? "设备空间不足，传输已停止。文件结果可能不完整；请先清理空间并核对文件。" : "The device ran out of space, so the transfer stopped. The file result may be incomplete; free space and check the file first.",
    action: "host" as const,
    label: zh ? "检查设备空间" : "Check device space",
  };
  if (task.errorCode === "ssh_sftp_operation_timeout") return {
    detail: zh ? "文件操作超时，最终结果无法确认。请先核对设备上的文件，避免重复传输。" : "The file operation timed out and its final result is unknown. Check the file on the device first to avoid a duplicate transfer.",
    action: "files" as const,
    label: zh ? "核对文件" : "Check file",
  };
  if (task.errorCode === "host_file_transfer_interrupted") return {
    detail: zh ? "应用在确认结果前中断，无法判断传输是否完成。请先核对设备上的文件，避免重复传输。" : "The app stopped before confirming the result, so completion is unknown. Check the file on the device first to avoid a duplicate transfer.",
    action: "files" as const,
    label: zh ? "核对文件" : "Check file",
  };
  if (["ssh_host_fingerprint_changed", "ssh_authentication_failed", "ssh_credential_unavailable", "ssh_credential_invalid", "ssh_sftp_unavailable"].includes(task.errorCode ?? "")) return {
    detail: zh ? `${errorText(new ApiError(task.errorCode ?? "", task.errorCode ?? "", 0), zh)} 文件传输没有确认完成，请先检查设备连接。` : `${errorText(new ApiError(task.errorCode ?? "", task.errorCode ?? "", 0), zh)} The transfer was not confirmed complete; check the device connection first.`,
    action: "host" as const,
    label: zh ? "检查设备连接" : "Check device connection",
  };
  if (task.direction === "upload" && AMBIGUOUS_UPLOAD_ERRORS.has(task.errorCode ?? "")) return {
    detail: zh ? "上传过程中连接中断，最终文件状态无法确认。请先核对设备上的文件，避免重复上传。" : "The connection stopped during upload, so the final file state is unknown. Check the file on the device first to avoid a duplicate upload.",
    action: "files" as const,
    label: zh ? "核对文件" : "Check file",
  };
  return {
    detail: task.errorCode ? errorText(new ApiError(task.errorCode, task.errorCode, 0), zh) : (zh ? "这次传输没有完成。" : "This transfer did not finish."),
    action: "retry" as const,
    label: zh ? "重试" : "Retry",
  };
}

function transferIsLongRunning(task: HostFileTransfer) {
  const startedAt = Date.parse(task.startedAt ?? task.createdAt);
  return task.status === "running" && Number.isFinite(startedAt) && Date.now() - startedAt >= 30_000;
}

function TransferHistory({ host, scopes, zh, professional, onInspectFiles, onInspectHost }: { host: SshHost; scopes: HostFileScope[]; zh: boolean; professional: boolean; onInspectFiles: () => void; onInspectHost: () => void }) {
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
    const longRunning = transferIsLongRunning(task);
    const status = task.status === "completed" ? (zh ? "已完成" : "Completed") : task.status === "failed" ? (zh ? "失败" : "Failed") : longRunning ? (zh ? "耗时较长" : "Taking longer") : (zh ? "进行中" : "In progress");
    const retryEligible = task.status === "failed" && task.attempt < task.maxAttempts && scopes.some((item) => item.id === task.scopeId && item.status === "ready" && item.permissions.includes(task.direction));
    const canRetry = retryEligible && !transferNeedsInspection(task);
    const recovery = ordinaryTransferRecovery(task, zh);
    const inspectAction = !professional && task.status === "failed" && !canRetry && recovery.action !== "retry" ? <Button size="sm" variant="secondary" onClick={recovery.action === "files" ? onInspectFiles : onInspectHost}>{recovery.action === "files" ? <Folder className="size-4" /> : <Server className="size-4" />}{recovery.label}</Button> : null;
    const primaryAction = canRetry ? <Button size="sm" variant="secondary" onClick={() => beginRetry(task)}><RotateCcw />{zh ? "重试" : "Retry"}</Button> : inspectAction;
    return <div key={task.id} className="space-y-2 p-3"><div className={primaryAction ? "grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" : ""}><div className="flex min-w-0 items-center gap-2"><span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted">{task.direction === "upload" ? <ArrowUpFromLine className="size-4" /> : <ArrowDownToLine className="size-4" />}</span><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{task.fileName}</strong>{professional ? <code className="block truncate text-xs text-muted-foreground">/{task.remotePath}</code> : <span className="block text-xs text-muted-foreground">{task.direction === "upload" ? (zh ? "上传到设备" : "Upload to device") : (zh ? "从设备下载" : "Download from device")}</span>}</span><StatusBadge tone={tone}>{status}</StatusBadge></div>{primaryAction ? <div className="flex justify-start sm:justify-end">{primaryAction}</div> : null}</div>{task.status === "running" ? <><TransferProgress value={task.progress} label={longRunning ? (zh ? "仍在传输，请勿重复发起" : "Still transferring — do not start a duplicate") : (zh ? "正在处理" : "Processing")} />{longRunning && !professional ? <p className="text-xs text-muted-foreground">{zh ? "这次传输比平时久。请等待最终结果；完成前无法确认设备上的文件状态。" : "This transfer is taking longer than usual. Wait for the final result; the file state on the device is unknown until it finishes."}</p> : null}</> : <div className="space-y-1 text-xs text-muted-foreground"><div className="flex flex-wrap justify-between gap-2"><span>{formatBytes(task.bytesTransferred)} / {formatBytes(task.bytesTotal)}</span>{professional ? <span>{zh ? `第 ${task.attempt}/${task.maxAttempts} 次` : `Attempt ${task.attempt}/${task.maxAttempts}`}{task.errorCode ? ` · ${task.errorCode}` : ""}</span> : task.status === "completed" ? <span>{zh ? "文件传输已完成" : "File transfer completed"}</span> : null}</div>{!professional && task.status === "failed" ? <p role="alert" className="text-destructive">{recovery.detail}{canRetry ? (zh ? " 可以安全重试。" : " You can safely retry.") : ""}</p> : null}</div>}</div>;
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
  const ipv4 = host.split(".").map(Number);
  if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return ipv4[0] === 10
      || (ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127)
      || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
      || (ipv4[0] === 192 && ipv4[1] === 168);
  }
  return host.startsWith("fc") || host.startsWith("fd");
}

function HostSetupDialog({ open, initialHost, allowPrivateByDefault, zh, professional, onClose, onChanged }: { open: boolean; initialHost: SshHost | null; allowPrivateByDefault: boolean; zh: boolean; professional: boolean; onClose: () => void; onChanged: () => Promise<unknown> }) {
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
  const [credentialRepairFlow, setCredentialRepairFlow] = useState(false);
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
    setCredentialRepairFlow(Boolean(initialHost && ["ssh_authentication_failed", "ssh_credential_unavailable", "ssh_credential_invalid"].includes(initialHost.lastConnectionError?.code ?? "")));
    setScope({ label: initialHost?.purposes.includes("site_publish") ? (zh ? "网站文件" : "Website files") : (zh ? "主机文件" : "Host files"), rootPath: "", purpose: initialHost?.purposes.includes("site_publish") ? "site_publish" : "general_files", upload: initialHost?.purposes.includes("site_publish") ?? false, download: true });
  }, [allowPrivateByDefault, initialHost, open, zh]);

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
  const credentialRepairRequired = Boolean(existingHost && ["ssh_authentication_failed", "ssh_credential_unavailable", "ssh_credential_invalid"].includes(existingHost.lastConnectionError?.code ?? ""));
  const credentialRequired = (!existingHost || authChanged || credentialRepairRequired) && form.authMethod !== "ssh_agent";
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

      const shouldSaveCredential = form.authMethod !== "ssh_agent" && (credentialProvided || !existingHost || authChanged || credentialRepairRequired);
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
      } else if (credentialRepairFlow) onClose();
      else setStage("scope");
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
    if (form.authMethod !== "ssh_agent" && (credentialProvided || !existingHost || authChanged || credentialRepairRequired) && !bridge?.saveSshHostCredential) return setConnectionError(zh ? "请在 MyAgentTool 桌面版中完成连接，以便安全保存凭据。" : "Complete this connection in the MyAgentTool desktop app so the credential can be stored securely.");
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
    onSuccess: async (data) => { setHost(data.host); await onChanged(); if (credentialRepairFlow) onClose(); else setStage("scope"); },
  });
  const createScope = useMutation({ mutationFn: (input: { label: string; rootPath: string; purpose: HostFileScopePurpose; permissions: Array<"list" | "upload" | "download"> }) => hostApi.createScope(host!.id, input), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["my-host-scopes", host!.id] }); await onChanged(); onClose(); } });
  const mutationError = confirm.error ?? createScope.error;
  const pending = connect.isPending || confirm.isPending || createScope.isPending;
  const close = () => { if (!pending) onClose(); };
  const modalTitle = stage === "connection"
    ? credentialRepairFlow ? (zh ? "更新登录信息" : "Update sign-in details") : professional ? (zh ? "连接主机" : "Connect a host") : (zh ? "连接我的设备" : "Connect my device")
    : stage === "fingerprint"
      ? professional ? (zh ? "确认这台设备" : "Confirm this device") : (zh ? "确认这是我的设备" : "Confirm this is my device")
      : professional ? (zh ? "添加文件范围" : "Add a file range") : (zh ? "选择允许使用的文件夹" : "Choose a folder MyAgentTool may use");
  const modalDescription = stage === "connection"
    ? credentialRepairFlow
      ? (zh ? "重新输入密码或私钥。保存后会验证连接，但不会自动重试刚才的检查。" : "Re-enter the password or private key. The connection will be verified after saving, but the previous check will not run automatically.")
      : professional
      ? (zh ? "填写地址和登录信息，系统会安全保存凭据并测试连接。" : "Enter the address and sign-in details. The credential is stored securely and the connection is tested.")
      : (zh ? "输入这台设备的地址和登录信息。密码只会安全保存在当前电脑。" : "Enter this device's address and sign-in details. The password stays securely on this computer.")
    : stage === "fingerprint"
      ? professional
        ? (zh ? "首次连接需要确认设备指纹，避免连接到错误设备。" : "The first connection requires a device fingerprint check to prevent connecting to the wrong device.")
        : (zh ? "第一次连接时，请确认地址和设备是你预期的那一台。" : "On the first connection, confirm that this is the device you expected.")
      : professional
        ? (zh ? "连接已验证。现在可选择允许访问的专用目录。" : "The connection is verified. Now choose a dedicated directory that may be accessed.")
        : (zh ? "连接成功。MyAgentTool 只会使用你在这里允许的文件夹。" : "Connected. MyAgentTool will only use the folder you approve here.");
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
  const scopeAccessOptions = <>
    <Field label={zh ? "用途" : "Purpose"}><Select value={scope.purpose} onChange={(event) => setScope({ ...scope, purpose: event.target.value as HostFileScopePurpose })}>{host?.purposes.includes("site_publish") ? <option value="site_publish">{zh ? "站点发布" : "Site publishing"}</option> : null}{host?.purposes.includes("tls_certificate") || host?.purposes.includes("site_publish") ? <option value="tls_certificate">{zh ? "HTTPS 证书专用" : "HTTPS certificates only"}</option> : null}<option value="general_files">{zh ? "普通文件" : "General files"}</option><option value="backup">{zh ? "备份" : "Backup"}</option></Select></Field>
    {scope.purpose === "tls_certificate" ? <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">{zh ? "证书范围不会出现在文件浏览和下载入口；只有受控证书部署可以写入。" : "Certificate ranges are excluded from file browsing and downloads; only controlled certificate deployment can write to them."}</p> : <div className="rounded-lg border p-3"><p className="mb-2 text-sm font-medium">{zh ? "允许的传输" : "Allowed transfers"}</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={scope.upload} onChange={(event) => setScope({ ...scope, upload: event.target.checked })} />{zh ? "上传（最大 10 MB，默认保留两份）" : "Upload (10 MB max, keep both by default)"}</label><label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={scope.download} onChange={(event) => setScope({ ...scope, download: event.target.checked })} />{zh ? "下载（最大 25 MB，阻止敏感文件）" : "Download (25 MB max, sensitive files blocked)"}</label></div>}
  </>;
  const submitScope = () => createScope.mutate({ label: scope.label, rootPath: scope.rootPath, purpose: scope.purpose, permissions: ["list", ...(scope.upload ? ["upload" as const] : []), ...(scope.download ? ["download" as const] : [])] });

  const footer = <div className="flex w-full flex-wrap justify-between gap-2"><Button variant="secondary" onClick={close}>{credentialRepairFlow ? (zh ? "取消" : "Cancel") : (zh ? "稍后继续" : "Continue later")}</Button><div className="flex gap-2">{stage === "fingerprint" ? <Button variant="secondary" onClick={() => { setConnectionError(""); setStage("connection"); }}><ArrowLeft />{zh ? "返回修改" : "Back to edit"}</Button> : null}{stage === "connection" ? <Button disabled={connect.isPending} onClick={submitConnection}>{connect.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}{credentialRepairFlow ? (zh ? "保存并重新连接" : "Save and reconnect") : professional ? (zh ? "连接并验证" : "Connect and verify") : (zh ? "连接这台设备" : "Connect this device")}</Button> : null}{stage === "fingerprint" ? <Button disabled={!fingerprintAccepted || confirm.isPending} onClick={() => confirm.mutate()}>{confirm.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}{professional ? (zh ? "确认并连接" : "Confirm and connect") : (zh ? "确认设备并继续" : "Confirm device and continue")}</Button> : null}{stage === "scope" ? <Button disabled={!scope.rootPath.trim() || createScope.isPending} onClick={submitScope}>{createScope.isPending ? <Loader2 className="animate-spin" /> : <FolderLock />}{professional ? (zh ? "验证范围并完成" : "Verify range and finish") : (zh ? "使用这个文件夹并完成" : "Use this folder and finish")}</Button> : null}</div></div>;

  return <Modal open={open} onClose={close} title={modalTitle} description={modalDescription} size="lg" footer={footer}>
    <div className="space-y-4">
      {!credentialRepairFlow ? <ol className="grid grid-cols-3 gap-1" aria-label={zh ? "连接进度" : "Connection progress"}>{[
        professional ? (zh ? "1. 登录信息" : "1. Sign-in details") : (zh ? "1. 连接设备" : "1. Connect device"),
        professional ? (zh ? "2. 确认设备" : "2. Confirm device") : (zh ? "2. 确认是我的" : "2. Confirm it's mine"),
        professional ? (zh ? "3. 选择文件夹" : "3. Choose folder") : (zh ? "3. 允许文件夹" : "3. Approve folder"),
      ].map((label, index) => <li key={label} className={`rounded-md px-2 py-2 text-center text-xs ${stageIndex === index ? "bg-primary text-primary-foreground" : stageIndex > index ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{label}</li>)}</ol> : null}
      {stage === "connection" ? <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2"><Field label={professional ? (zh ? "主机地址" : "Host address") : (zh ? "设备地址" : "Device address")} required><Input required aria-invalid={connectionError && !form.host.trim() ? true : undefined} value={form.host} placeholder="10.10.10.222" onChange={(event) => { setConnectionError(""); setPrivateDetected(false); setForm({ ...form, host: event.target.value, allowPrivate: false }); }} /></Field><Field label={professional ? (zh ? "登录用户" : "Login user") : (zh ? "登录账号" : "Sign-in account")} required><Input required aria-invalid={connectionError && !form.user.trim() ? true : undefined} value={form.user} onChange={(event) => { setConnectionError(""); setForm({ ...form, user: event.target.value }); }} /></Field></div>
        {form.authMethod === "password_ref" ? <Field label={zh ? "登录密码" : "Login password"} required={credentialRequired}><Input type="password" value={secret.password} autoComplete="new-password" placeholder={existingHost && !authChanged && !credentialRepairRequired ? (zh ? "留空则使用已安全保存的密码" : "Leave blank to reuse the securely stored password") : ""} onChange={(event) => { setConnectionError(""); setSecret({ ...secret, password: event.target.value }); }} /></Field> : keyAuthentication ? <><Field label={zh ? "私钥" : "Private key"} required={credentialRequired}><Textarea rows={7} value={secret.privateKey} spellCheck={false} placeholder={existingHost && !authChanged && !credentialRepairRequired ? (zh ? "留空则使用已安全保存的私钥" : "Leave blank to reuse the securely stored private key") : "-----BEGIN OPENSSH PRIVATE KEY-----"} onChange={(event) => { setConnectionError(""); setSecret({ ...secret, privateKey: event.target.value }); }} /></Field><Field label={zh ? "私钥口令（如有）" : "Key passphrase (if any)"}><Input type="password" value={secret.passphrase} autoComplete="new-password" onChange={(event) => setSecret({ ...secret, passphrase: event.target.value })} /></Field></> : null}
        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{professional ? (zh ? "密码或私钥只保存在本机操作系统的安全存储中，不会写入站点数据或日志。" : "The password or private key stays in this computer's OS secure storage and is not written to site data or logs.") : (zh ? "登录信息只安全保存在当前电脑，不会同步到网站或写进日志。" : "Sign-in details stay securely on this computer and are never synced to the website or written to logs.")}</p>
        {showPrivateConsent ? <label className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm"><input className="mt-1" type="checkbox" checked={form.allowPrivate} onChange={(event) => { setConnectionError(""); setForm({ ...form, allowPrivate: event.target.checked }); }} /><span><strong className="block font-medium">{professional ? (zh ? "局域网连接许可" : "Local-network permission") : (zh ? "允许连接我的局域网设备" : "Allow access to my local device")}</strong><span className="mt-1 block text-muted-foreground">{professional ? (zh ? "这是局域网地址。允许 MyAgentTool 连接这台局域网设备。" : "This is a local-network address. Allow MyAgentTool to connect to this local device.") : (zh ? "这个地址只在你的局域网中可用。勾选后，MyAgentTool 才会尝试连接这台设备。" : "This address is only available on your local network. MyAgentTool will connect only after you approve it.")}</span></span></label> : null}
        <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{zh ? "高级选项" : "Advanced options"}</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label={zh ? "主机名称" : "Host name"}><Input value={form.name} placeholder={zh ? "网站生产主机" : "Production website host"} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label={zh ? "端口" : "Port"} required><Input required type="number" min="1" max="65535" value={form.port} onChange={(event) => { setConnectionError(""); setForm({ ...form, port: event.target.value }); }} /></Field><Field label={zh ? "认证方式" : "Authentication"}><Select value={form.authMethod} onChange={(event) => { setConnectionError(""); setSecret({ privateKey: "", passphrase: "", password: "" }); setForm({ ...form, authMethod: event.target.value as HostAuthMethod }); }}><option value="password_ref">{zh ? "密码" : "Password"}</option><option value="private_key_ref">{zh ? "私钥" : "Private key"}</option><option value="managed_identity">{zh ? "托管身份" : "Managed identity"}</option><option value="ssh_agent">{zh ? "SSH Agent" : "SSH agent"}</option></Select></Field><label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={form.sitePublish} onChange={(event) => setForm({ ...form, sitePublish: event.target.checked })} />{zh ? "允许用于站点发布" : "Allow site publishing"}</label></div></details>
        {connectionError ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{connectionError}</p> : null}
      </div> : null}
      {stage === "fingerprint" ? <div className="space-y-3">
        {professional ? <>
          <FingerprintPanel host={host} copied={fingerprintCopied} zh={zh} onCopy={copyFingerprint} />
          <p className="text-sm text-muted-foreground">{zh ? "把上面的指纹与设备控制台或管理员提供的指纹核对。确认后，如果设备身份发生变化，系统会自动阻止连接。" : "Compare the fingerprint above with the device console or the value from its administrator. Future identity changes will automatically block the connection."}</p>
          <FingerprintHelp zh={zh} />
        </> : <>
          <div className="rounded-lg border border-success/30 bg-success/5 p-4"><p className="font-medium">{zh ? "已找到设备" : "Device found"}</p><dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[100px_1fr]"><dt className="text-muted-foreground">{zh ? "设备地址" : "Device address"}</dt><dd className="break-all font-medium">{host?.host}</dd><dt className="text-muted-foreground">{zh ? "登录账号" : "Sign-in account"}</dt><dd className="break-all font-medium">{host?.user}</dd></dl></div>
          <p className="text-sm text-muted-foreground">{zh ? "请确认上面的地址和账号属于你要连接的设备。确认后，如果设备身份发生变化，系统会自动停止连接并提醒你。" : "Confirm that the address and account belong to the device you intended to connect. If its identity changes later, MyAgentTool will stop and alert you."}</p>
          <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{zh ? "查看技术指纹" : "View technical fingerprint"}</summary><div className="mt-3 space-y-3"><FingerprintPanel host={host} copied={fingerprintCopied} zh={zh} onCopy={copyFingerprint} compact /><FingerprintHelp zh={zh} /></div></details>
        </>}
        <label className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm"><input className="mt-1" type="checkbox" checked={fingerprintAccepted} onChange={(event) => setFingerprintAccepted(event.target.checked)} /><span>{professional ? (zh ? "我已核对指纹，确认这是我要连接的设备。" : "I compared the fingerprint and confirmed this is the device I intend to connect to.") : (zh ? "我确认这是我要连接的设备。" : "I confirm this is the device I intend to connect to.")}</span></label>
      </div> : null}
      {stage === "scope" ? <div className="space-y-3">
        <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{professional ? (zh ? "系统只检查约定的网站和内容目录，不会扫描主目录或系统目录。选择一个推荐文件夹即可完成。" : "Only conventional website and content locations are checked. Home and system directories are never scanned. Choose a suggested folder to finish.") : (zh ? "已为你选中推荐文件夹。MyAgentTool 只能查看和操作这个文件夹内的内容，不会扫描其他位置。" : "The recommended folder is selected for you. MyAgentTool can only view or change files inside it and will not scan other locations.")}</div>
        {scopeSuggestions.isLoading ? <div className="flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground"><Loader2 className="animate-spin" />{zh ? "正在查找可安全访问的文件夹…" : "Finding folders that can be accessed safely…"}</div> : null}
        {scopeSuggestions.data?.suggestions.length ? <fieldset className="space-y-2"><legend className="text-sm font-medium">{professional ? (zh ? "推荐文件夹" : "Suggested folders") : (zh ? "允许使用的文件夹" : "Folder to approve")}</legend>{scopeSuggestions.data.suggestions.map((suggestion) => <label key={suggestion.rootPath} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${scope.rootPath === suggestion.rootPath ? "border-primary bg-primary/[0.04]" : "hover:bg-muted/50"}`}><input className="mt-1" type="radio" name="scope-suggestion" checked={scope.rootPath === suggestion.rootPath} onChange={() => chooseScopeSuggestion(suggestion)} /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-sm font-medium">{suggestion.label}{suggestion.recommended ? <StatusBadge tone="success">{zh ? "推荐" : "Recommended"}</StatusBadge> : null}</span><code className="mt-1 block break-all text-xs text-muted-foreground">{suggestion.rootPath}</code><span className="mt-1 block text-xs text-muted-foreground">{suggestionReason(suggestion)}</span></span></label>)}</fieldset> : null}
        {!scopeSuggestions.isLoading && !scopeSuggestions.data?.suggestions.length ? <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-muted-foreground">{scopeSuggestions.error ? (zh ? "暂时无法自动查找文件夹，可以手动填写管理员提供的专用目录。" : "Folders could not be discovered automatically. Enter a dedicated directory provided by the administrator.") : (zh ? "没有找到约定的内容目录，请填写管理员提供的专用目录。" : "No conventional content directory was found. Enter a dedicated directory provided by the administrator.")}</p> : null}
        <details open={manualScopeOpen} onToggle={(event) => setManualScopeOpen(event.currentTarget.open)} className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{scopeSuggestions.data?.suggestions.length ? (zh ? "使用其他文件夹" : "Use another folder") : (zh ? "手动填写文件夹" : "Enter a folder manually")}</summary><div className="mt-3 space-y-3"><Field label={professional ? (zh ? "范围名称" : "Range name") : (zh ? "文件夹名称" : "Folder name")}><Input value={scope.label} onChange={(event) => setScope({ ...scope, label: event.target.value })} /></Field><Field label={professional ? (zh ? "远程目录" : "Remote directory") : (zh ? "文件夹路径" : "Folder path")} required><Input className="font-mono" value={scope.rootPath} placeholder="/srv/www/site" onChange={(event) => { setScopeRootTouched(true); setScope({ ...scope, rootPath: event.target.value }); }} /></Field></div></details>
        {professional ? scopeAccessOptions : <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{zh ? "文件夹权限" : "Folder permissions"}</summary><div className="mt-3 space-y-3">{scopeAccessOptions}</div></details>}
      </div> : null}
      {mutationError ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{errorText(mutationError, zh)}</p> : null}
    </div>
  </Modal>;
}

function FingerprintPanel({ host, copied, zh, onCopy, compact = false }: { host: SshHost | null; copied: boolean; zh: boolean; onCopy: () => Promise<void>; compact?: boolean }) {
  return <div className={compact ? "" : "rounded-lg border p-4"}><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{zh ? "设备指纹" : "Device fingerprint"}</p><Button size="sm" variant="ghost" onClick={() => void onCopy()}><Copy />{copied ? (zh ? "已复制" : "Copied") : (zh ? "复制" : "Copy")}</Button></div><code className="mt-2 block break-all rounded bg-muted p-3 text-xs">{host?.observedFingerprint ?? (zh ? "尚未读取" : "Not read yet")}</code></div>;
}

function FingerprintHelp({ zh }: { zh: boolean }) {
  return <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{zh ? "如何核对指纹？" : "How do I compare the fingerprint?"}</summary><div className="mt-2 space-y-2 text-xs text-muted-foreground"><p>{zh ? "请在设备控制台执行下面的只读命令，或把指纹复制给设备管理员核对：" : "Run this read-only command in the device console, or copy the fingerprint to the device administrator:"}</p><code className="block overflow-x-auto rounded bg-muted p-2">ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code></div></details>;
}

function Field({ label, children, required = false }: { label: string; children: React.ReactNode; required?: boolean }) { return <label className="space-y-1.5 text-sm"><span className={`font-medium ${required ? "after:ml-1 after:text-destructive after:content-['*']" : ""}`}>{label}</span>{children}</label>; }
function Notice({ title, detail, action, loading = false }: { title: string; detail?: string; action?: React.ReactNode; loading?: boolean }) { return <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center">{loading ? <Loader2 className="size-7 animate-spin text-muted-foreground" /> : <Server className="size-7 text-muted-foreground" />}<h3 className="font-semibold">{title}</h3>{detail ? <p className="max-w-lg text-sm text-muted-foreground">{detail}</p> : null}{action}</div>; }
function formatBytes(value: number) { return value >= 1024 * 1024 ? `${(value / (1024 * 1024)).toFixed(1)} MB` : value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${value} B`; }
