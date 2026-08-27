import { Cloud, Database, Eye, HardDrive, Info, Link2, RefreshCw, Settings, Table2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import type { WorkResource, WorkResourcePreview } from "./local-content-types";

function labels(locale: string) {
  return locale.startsWith("zh") ? {
    local: "本地", remote: "远程", ready: "可用", stale: "需刷新", unavailable: "不可用", archived: "已停用",
    preview: "预览", add: "加入任务", rows: "条记录", query: "可查询", propose: "变更前预览", commit: "可确认写入",
    previewTitle: "资源预览", close: "关闭", empty: "暂无可预览记录", safety: "仅展示受控样例；不会执行内容，也不会在预览时写入数据。",
    details: "查看详情", detailsTitle: "资源详情", source: "来源", location: "保存位置", freshness: "数据状态", version: "当前版本", updated: "最近更新", capabilities: "可用能力",
    refresh: "刷新状态", refreshing: "正在检查…", checkConnection: "检查连接", refreshIndex: "刷新本地索引", manage: "管理来源", manageAndSync: "管理与预览同步", refreshFailed: "检查失败，原数据没有改变。", current: "当前可用",
    connectionCheckHint: "检查连接只验证凭据和可用性，不读取最新批次，也不会同步或修改数据。需要更新本地业务数据时，请进入来源管理并先预览差异。",
    localRefreshHint: "刷新本地索引只更新资料状态，不修改原件。",
  } : {
    local: "Local", remote: "Remote", ready: "Ready", stale: "Refresh needed", unavailable: "Unavailable", archived: "Disabled",
    preview: "Preview", add: "Add to task", rows: "rows", query: "Queryable", propose: "Change preview", commit: "Confirmable writes",
    previewTitle: "Resource preview", close: "Close", empty: "No previewable records", safety: "Shows a bounded sample only; previewing never executes content or writes data.",
    details: "View details", detailsTitle: "Resource details", source: "Source", location: "Location", freshness: "Data status", version: "Current version", updated: "Last updated", capabilities: "Capabilities",
    refresh: "Refresh status", refreshing: "Checking…", checkConnection: "Check connection", refreshIndex: "Refresh local index", manage: "Manage source", manageAndSync: "Manage & preview sync", refreshFailed: "Check failed. Existing data was not changed.", current: "Current",
    connectionCheckHint: "Checking the connection only verifies credentials and availability. It does not fetch a new batch, sync, or modify data. Open source management to preview changes before updating local business data.",
    localRefreshHint: "Refreshing the local index updates resource status without modifying the original.",
  };
}

export function WorkResourceCard({ resource, locale, onPreview, onChoose, onDetails }: {
  resource: WorkResource;
  locale: string;
  onPreview: () => void;
  onChoose: () => void;
  onDetails: () => void;
}) {
  const copy = labels(locale);
  const LocationIcon = resource.locality === "local" ? HardDrive : Cloud;
  return <Card className="flex min-w-0 flex-col">
    <CardContent className="flex flex-1 flex-col gap-3 p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Table2 className="size-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{resource.displayName}</h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge tone="neutral"><LocationIcon className="mr-1 size-3" aria-hidden />{copy[resource.locality]}</Badge>
            <Badge tone={resource.availability === "ready" ? "success" : "warning"}>{copy[resource.availability]}</Badge>
            {resource.rowCount != null ? <Badge tone="neutral">{resource.rowCount} {copy.rows}</Badge> : null}
          </div>
        </div>
      </div>
      {resource.summary ? <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{resource.summary}</p> : null}
      <p className="mt-auto truncate text-xs text-muted-foreground" title={resource.source.label}>{resource.source.label}</p>
      <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
        {resource.capabilities.includes("query") ? <span className="inline-flex items-center gap-1"><Database className="size-3" aria-hidden />{copy.query}</span> : null}
        {resource.capabilities.includes("propose_change") ? <span>· {copy.propose}</span> : null}
        {resource.capabilities.includes("commit_change") ? <span>· {copy.commit}</span> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" aria-label={`${copy.details}: ${resource.displayName}`} onClick={onDetails}><Info aria-hidden />{copy.details}</Button>
        <Button size="sm" variant="secondary" aria-label={`${copy.preview}: ${resource.displayName}`} disabled={!resource.preview.supported} onClick={onPreview}><Eye aria-hidden />{copy.preview}</Button>
        <Button size="sm" aria-label={`${copy.add}: ${resource.displayName}`} disabled={!resource.taskBinding.supported} onClick={onChoose}><Link2 aria-hidden />{copy.add}</Button>
      </div>
    </CardContent>
  </Card>;
}

export function WorkResourceDetailModal({ resource, locale, refreshing, refreshError, onClose, onPreview, onChoose, onRefresh, onManage }: {
  resource: WorkResource;
  locale: string;
  refreshing: boolean;
  refreshError: boolean;
  onClose: () => void;
  onPreview: () => void;
  onChoose: () => void;
  onRefresh: () => void;
  onManage: () => void;
}) {
  const copy = labels(locale);
  const location = resource.locality === "local" ? copy.local : copy.remote;
  const freshness = resource.details?.freshness === "stale" ? copy.stale
    : resource.details?.freshness === "unavailable" ? copy.unavailable : copy.current;
  const capabilityLabels = resource.capabilities.map((capability) => capability === "query" ? copy.query
    : capability === "propose_change" ? copy.propose
      : capability === "commit_change" ? copy.commit
        : capability === "preview" ? copy.preview
          : capability === "read" ? (locale.startsWith("zh") ? "可读取" : "Readable") : capability);
  const formattedTime = resource.lastFreshAt ? new Date(resource.lastFreshAt).toLocaleString(locale) : "—";
  const shortVersion = resource.currentVersion?.startsWith("sha256:") ? `${resource.currentVersion.slice(7, 23)}…` : resource.currentVersion ?? "—";
  const isConnectionCheck = resource.actions?.refreshMode === "connection_check";
  const refreshLabel = isConnectionCheck ? copy.checkConnection : resource.actions?.refreshMode === "local_index" ? copy.refreshIndex : copy.refresh;
  const manageLabel = resource.source.type === "connector" ? copy.manageAndSync : copy.manage;
  return <Modal open onClose={onClose} title={copy.detailsTitle} description={resource.displayName} size="2xl" footer={<div className="flex flex-wrap justify-end gap-2">
    <Button variant="ghost" onClick={onClose}>{copy.close}</Button>
    <Button variant="ghost" onClick={onManage}><Settings aria-hidden />{manageLabel}</Button>
    {resource.actions?.canRefresh ? <Button variant="secondary" disabled={refreshing} onClick={onRefresh}><RefreshCw className={refreshing ? "animate-spin" : undefined} aria-hidden />{refreshing ? copy.refreshing : refreshLabel}</Button> : null}
    {resource.preview.supported ? <Button variant="secondary" onClick={onPreview}><Eye aria-hidden />{copy.preview}</Button> : null}
    {resource.taskBinding.supported ? <Button onClick={onChoose}><Link2 aria-hidden />{copy.add}</Button> : null}
  </div>}>
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5"><Badge tone="neutral">{location}</Badge><Badge tone={resource.availability === "ready" ? "success" : "warning"}>{copy[resource.availability]}</Badge>{resource.details?.connectionHealth ? <Badge tone={resource.details.connectionHealth === "ready" ? "success" : "neutral"}>{resource.details.connectionHealth}</Badge> : null}</div>
      {resource.summary ? <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed text-muted-foreground">{resource.summary}</p> : null}
      <p className="rounded-lg border border-primary/20 bg-primary/[0.04] p-3 text-xs leading-relaxed text-muted-foreground">{isConnectionCheck ? copy.connectionCheckHint : copy.localRefreshHint}</p>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div><dt className="text-xs text-muted-foreground">{copy.source}</dt><dd className="mt-1 text-sm">{resource.source.label}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{copy.location}</dt><dd className="mt-1 text-sm">{location}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{copy.freshness}</dt><dd className="mt-1 text-sm">{freshness}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{copy.updated}</dt><dd className="mt-1 text-sm">{formattedTime}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{copy.version}</dt><dd className="mt-1 font-mono text-xs">{shortVersion}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{copy.capabilities}</dt><dd className="mt-1 text-sm">{capabilityLabels.join("、") || "—"}</dd></div>
      </dl>
      {refreshError ? <p className="rounded-lg border border-destructive/30 bg-destructive/[0.06] p-3 text-sm text-destructive" role="alert">{copy.refreshFailed}</p> : null}
    </div>
  </Modal>;
}

export function WorkResourcePreviewModal({ resource, preview, loading, error, locale, onClose, onRetry }: {
  resource: WorkResource;
  preview: WorkResourcePreview | null;
  loading: boolean;
  error: boolean;
  locale: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  const copy = labels(locale);
  return <Modal open onClose={onClose} title={copy.previewTitle} description={resource.displayName} size="2xl" footer={<Button variant="ghost" onClick={onClose}>{copy.close}</Button>}>
    <p className="mb-3 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">{copy.safety}</p>
    {loading ? <div className="h-40 animate-pulse rounded-lg bg-muted/50" /> : error ? <div className="space-y-3 text-sm text-destructive"><p>{locale.startsWith("zh") ? "暂时无法读取资源预览。" : "The resource preview is temporarily unavailable."}</p><Button size="sm" variant="secondary" onClick={onRetry}>{locale.startsWith("zh") ? "重试" : "Retry"}</Button></div> : preview?.kind === "plain_text" ? <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 p-4 text-xs leading-relaxed">{preview.text || copy.empty}</pre> : preview?.rows?.length ? <div className="max-h-[28rem] overflow-auto rounded-lg border border-border"><table className="w-full min-w-[36rem] text-left text-xs"><thead className="sticky top-0 bg-muted"><tr><th className="p-2 font-medium">{locale.startsWith("zh") ? "记录" : "Record"}</th>{(preview.columns ?? []).map((column) => <th key={column} className="p-2 font-medium">{column}</th>)}</tr></thead><tbody>{preview.rows.map((row) => <tr key={row.id} className="border-t border-border"><td className="p-2 font-medium">{row.label}</td>{(preview.columns ?? []).map((column) => <td key={column} className="max-w-64 truncate p-2 text-muted-foreground">{row.fields[column] ?? "—"}</td>)}</tr>)}</tbody></table></div> : <p className="py-8 text-center text-sm text-muted-foreground">{copy.empty}</p>}
  </Modal>;
}
