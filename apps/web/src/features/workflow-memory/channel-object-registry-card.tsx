import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Database, Loader2, Plus, RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { useConsoleState } from "@/data/use-console-state";
import {
  workflowMemoryApi,
  type ChannelObjectKind,
  type ChannelObjectRecord,
  type ChannelObjectImportPreview,
  type ChannelObjectConnectorConfig,
  type ChannelObjectSyncPreview,
  type ChannelMutationBinding,
} from "@/features/workflow-memory/workflow-memory-api";

const KIND_COPY: Record<ChannelObjectKind, string> = {
  contact: "联系人",
  order: "订单",
  quotation: "报价",
  shipment: "发货记录",
  after_sales: "售后记录",
  return: "退货记录",
  receivable: "应收记录",
  bank_transaction: "到账流水",
  account: "付款账户",
  publish_target: "发布目标",
};

function fieldSchema(kind: ChannelObjectKind) {
  if (kind === "contact") return [{ key: "name", label: "姓名/称呼" }, { key: "email", label: "邮箱" }, { key: "phone", label: "电话" }];
  if (kind === "order") return [{ key: "order_number", label: "订单号" }, { key: "customer", label: "客户" }];
  if (kind === "quotation") return [{ key: "quotation_number", label: "报价单号" }, { key: "customer", label: "客户" }, { key: "amount", label: "报价金额" }, { key: "status", label: "报价状态" }];
  if (kind === "shipment") return [{ key: "shipment_number", label: "物流/发货单号" }, { key: "order_number", label: "订单号" }, { key: "quantity", label: "发货数量" }, { key: "delivery_status", label: "发货状态" }];
  if (kind === "after_sales") return [{ key: "case_number", label: "售后单号" }, { key: "order_number", label: "订单号" }, { key: "status", label: "售后状态" }];
  if (kind === "return") return [{ key: "return_number", label: "退货单号" }, { key: "order_number", label: "订单号" }, { key: "quantity", label: "退货数量" }, { key: "return_amount", label: "退货金额" }, { key: "return_status", label: "退货状态" }];
  if (kind === "receivable") return [{ key: "reference", label: "应收编号/备注" }, { key: "order_number", label: "订单号" }, { key: "amount", label: "应收金额" }, { key: "payment_status", label: "回款状态" }];
  if (kind === "bank_transaction") return [{ key: "reference", label: "流水备注/编号" }, { key: "amount", label: "到账金额" }, { key: "date", label: "到账日期" }];
  if (kind === "account") return [{ key: "accountName", label: "账户名称" }, { key: "accountNumber", label: "账号（仅保存后四位）" }, { key: "currency", label: "币种" }];
  return [{ key: "platform", label: "平台" }, { key: "channel", label: "账号/频道" }];
}

function objectLabel(record: ChannelObjectRecord) {
  return record.kind === "account" && record.fields.accountNumber
    ? `${record.label} · ${record.fields.accountNumber}`
    : record.label;
}

async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function importFormat(fileName: string): "csv" | "json" | "xlsx" | null {
  const extension = fileName.toLowerCase().split(".").pop();
  return extension === "csv" ? "csv" : extension === "json" ? "json" : extension === "xlsx" || extension === "xls" ? "xlsx" : null;
}

export function ChannelObjectRegistryCard() {
  const queryClient = useQueryClient();
  const { data: consoleState } = useConsoleState();
  const projects = consoleState?.projects ?? [];
  const projectId = consoleState?.currentProjectId ?? projects[0]?.id ?? "";
  const [kind, setKind] = useState<ChannelObjectKind>("contact");
  const [label, setLabel] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [showDisabled, setShowDisabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ChannelObjectImportPreview | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncPreview, setSyncPreview] = useState<ChannelObjectSyncPreview | null>(null);
  const [credentialRefs, setCredentialRefs] = useState<Record<string, string>>({});
  const connectors = useQuery({
    queryKey: ["channel-object-connectors"],
    queryFn: () => workflowMemoryApi.listChannelObjectConnectors(projectId),
    enabled: Boolean(projectId),
  });
  const connectorConfigs = useQuery({
    queryKey: ["channel-object-connector-configs", projectId],
    queryFn: () => workflowMemoryApi.listChannelObjectConnectorConfigs(projectId),
    enabled: Boolean(projectId),
  });
  const fileSources = useQuery({
    queryKey: ["channel-object-file-sources", projectId, kind],
    queryFn: () => workflowMemoryApi.listChannelObjectFileSources(projectId, kind),
    enabled: Boolean(projectId),
  });
  const ledgerDefinitions = useQuery({
    queryKey: ["ledger-definitions", projectId],
    queryFn: () => workflowMemoryApi.listLedgerDefinitions(),
    enabled: Boolean(projectId),
  });
  const mutationBindings = useQuery({
    queryKey: ["channel-mutation-bindings", projectId],
    queryFn: () => workflowMemoryApi.listChannelMutationBindings(projectId),
    enabled: Boolean(projectId),
  });
  const schema = useMemo(() => fieldSchema(kind), [kind]);
  const query = useQuery({
    queryKey: ["channel-objects", projectId, showDisabled],
    queryFn: () => workflowMemoryApi.listChannelObjects({
      projectId,
      status: showDisabled ? undefined : "active",
    }),
    enabled: Boolean(projectId),
  });
  const connectorList = connectors.data?.connectors ?? [];
  const connectorConfigList = connectorConfigs.data?.configs ?? [];
  const fileSourceList = fileSources.data?.sources ?? [];
  const ledgerDefinitionList = ledgerDefinitions.data?.ledgerDefinitions ?? [];
  const mutationBindingList = mutationBindings.data?.bindings ?? [];
  const objectList = query.data?.objects ?? [];

  const resetForm = (nextKind = kind) => {
    setKind(nextKind);
    setLabel("");
    setFields({});
    setError(null);
  };

  const save = async () => {
    if (!projectId || !label.trim()) {
      setError("请先选择项目并填写对象名称。补充字段有助于系统准确匹配。");
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await workflowMemoryApi.upsertChannelObject({ kind, projectId, label: label.trim(), fields });
      resetForm();
      setNotice("已登记。Channel 任务确认时会优先使用这条记录。");
      await queryClient.invalidateQueries({ queryKey: ["channel-objects", projectId] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登记失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  };

  const changeStatus = async (record: ChannelObjectRecord) => {
    setPending(true);
    setError(null);
    try {
      await workflowMemoryApi.setChannelObjectStatus(record.id, {
        status: record.status === "active" ? "disabled" : "active",
        expectedRevision: record.revision,
      });
      await queryClient.invalidateQueries({ queryKey: ["channel-objects", projectId] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新失败，请刷新后重试。");
    } finally {
      setPending(false);
    }
  };

  const previewImport = async () => {
    if (!projectId || !importFile) return;
    const format = importFormat(importFile.name);
    if (!format) { setError("请选择 CSV、Excel 或 JSON 文件。"); return; }
    setPending(true); setError(null); setNotice(null);
    try {
      const result = await workflowMemoryApi.previewChannelObjectImport({
        projectId, kind, format, fileName: importFile.name, content: await fileToBase64(importFile),
      });
      setImportPreview(result.import);
      setNotice(result.canConfirm ? "预览完成，请确认导入。" : "预览完成，请先修正文件中的错误。导入不会自动写入。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "文件预览失败，请检查格式。");
    } finally { setPending(false); }
  };

  const confirmImport = async () => {
    if (!importPreview) return;
    setPending(true); setError(null);
    try {
      await workflowMemoryApi.confirmChannelObjectImport(importPreview.id);
      setImportPreview(null); setImportFile(null); setNotice(`已导入 ${importPreview.acceptedRows} 条${KIND_COPY[importPreview.kind]}。`);
      await queryClient.invalidateQueries({ queryKey: ["channel-objects", projectId] });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "确认导入失败，请稍后重试。"); }
    finally { setPending(false); }
  };

  const sync = async (connectorId: string, configId?: string) => {
    if (!projectId || !connectorId) return;
    setSyncing(true); setError(null); setNotice(null);
    try {
      const result = await workflowMemoryApi.previewChannelObjectConnectorSync({ connectorId, configId, projectId, kind });
      setSyncPreview(result.preview);
      setNotice(result.canConfirm ? "已生成同步差异，请确认后写入本地对象。" : "同步检查完成，没有需要更新的对象。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "同步失败，请检查连接器状态。"); }
    finally { setSyncing(false); }
  };

  const confirmSync = async () => {
    if (!syncPreview) return;
    setSyncing(true); setError(null);
    try {
      const result = await workflowMemoryApi.confirmChannelObjectConnectorSync(syncPreview.id);
      setSyncPreview(null);
      setNotice(`同步完成：新增或更新 ${result.sync.imported} 条，失败 ${result.sync.failed} 条。`);
      await queryClient.invalidateQueries({ queryKey: ["channel-objects", projectId] });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "确认同步失败，请稍后重试。"); }
    finally { setSyncing(false); }
  };

  const saveConnectorConfig = async (connectorId: string, existing?: ChannelObjectConnectorConfig) => {
    if (!projectId) return;
    setPending(true); setError(null);
    try {
      await workflowMemoryApi.upsertChannelObjectConnectorConfig({
        id: existing?.id, projectId, connectorId, name: connectorList.find((item) => item.id === connectorId)?.name,
        kinds: [kind], credentialRef: credentialRefs[connectorId], expectedRevision: existing?.revision,
      });
      setNotice("连接器配置已保存。请先测试连接，再执行同步。");
      await queryClient.invalidateQueries({ queryKey: ["channel-object-connector-configs", projectId] });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "连接器配置保存失败。"); }
    finally { setPending(false); }
  };

  const testConnector = async (config: ChannelObjectConnectorConfig) => {
    setPending(true); setError(null); setNotice(null);
    try {
      const result = await workflowMemoryApi.testChannelObjectConnectorConfig(config.id);
      setNotice(result.ok ? "连接测试通过，可以预览同步。" : "连接测试未通过，请检查凭据引用。要求仍保持只读。 ");
      await queryClient.invalidateQueries({ queryKey: ["channel-object-connector-configs", projectId] });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "连接测试失败，请稍后重试。"); }
    finally { setPending(false); }
  };

  const bindMutationRule = async (source: { id: string; fileName: string }, definitionId: string, existing?: ChannelMutationBinding) => {
    setPending(true); setError(null); setNotice(null);
    try {
      await workflowMemoryApi.upsertChannelMutationBinding({
        id: existing?.id,
        projectId,
        fileSourceId: source.id,
        ledgerDefinitionId: definitionId,
        expectedRevision: existing?.revision,
      });
      setNotice(`已为 ${source.fileName} 绑定安全写回规则。`);
      await queryClient.invalidateQueries({ queryKey: ["channel-mutation-bindings", projectId] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "写回规则绑定失败，请检查文件和规则格式。备份源文件不会被修改。");
    } finally { setPending(false); }
  };

  return (
    <Card aria-labelledby="channel-object-registry-heading">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle id="channel-object-registry-heading" className="flex items-center gap-2">
              <Database className="size-4 text-primary" aria-hidden="true" />
              业务对象
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              登记报价、订单、发货、回款、售后和退货记录。微信里直接说业务目标，系统会先核对对应数据，再决定是否需要确认。
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={showDisabled} onChange={(event) => setShowDisabled(event.target.checked)} />
            显示已停用
          </label>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="grid gap-2 md:grid-cols-[10rem_1fr_1fr_auto] md:items-end">
            <label className="grid gap-1 text-xs font-medium">
              类型
              <Select value={kind} onChange={(event) => resetForm(event.target.value as ChannelObjectKind)}>
                {Object.entries(KIND_COPY).map(([value, copy]) => <option key={value} value={value}>{copy}</option>)}
              </Select>
            </label>
            <label className="grid gap-1 text-xs font-medium">
              名称
              <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={kind === "contact" ? "例如：张三" : "例如：公司付款账户"} />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              {schema.slice(0, 2).map((field) => (
                <label key={field.key} className="grid gap-1 text-xs font-medium">
                  {field.label}
                  <Input
                    value={fields[field.key] ?? ""}
                    onChange={(event) => setFields((current) => ({ ...current, [field.key]: event.target.value }))}
                    placeholder={field.key === "accountNumber" ? "只保存后四位" : "可选"}
                  />
                </label>
              ))}
            </div>
            <Button onClick={() => void save()} disabled={pending || !projectId}>
              {pending ? <Loader2 className="animate-spin" /> : <Plus />}
              登记
            </Button>
          </div>
          {schema.length > 2 ? (
            <div className="mt-2 max-w-xs">
              <label className="grid gap-1 text-xs font-medium">
                {schema[2].label}
                <Input value={fields[schema[2].key] ?? ""} onChange={(event) => setFields((current) => ({ ...current, [schema[2].key]: event.target.value }))} placeholder="可选" />
              </label>
            </div>
          ) : null}
        </div>
        <div className="mt-3 grid gap-3 rounded-lg border border-dashed p-3 md:grid-cols-[1fr_auto] md:items-end">
          <label className="grid gap-1 text-xs font-medium">
            批量导入（先预览，再确认）
            <Input type="file" accept=".csv,.json,.xlsx,.xls" onChange={(event) => { setImportFile(event.target.files?.[0] ?? null); setImportPreview(null); }} />
            <span className="font-normal text-muted-foreground">支持 CSV、Excel、JSON；账号只保留后四位，原文件不会保存。</span>
          </label>
          <Button variant="secondary" onClick={() => void previewImport()} disabled={pending || !importFile || !projectId}>
            {pending ? <Loader2 className="animate-spin" /> : null}预览文件
          </Button>
        </div>
        {importPreview ? (
          <div className="mt-3 rounded-lg border bg-background p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{importPreview.fileName}：新增 {importPreview.diff?.created ?? importPreview.acceptedRows}，修改 {importPreview.diff?.updated ?? 0}，无变化 {importPreview.diff?.unchanged ?? 0}，移除 {importPreview.diff?.removed ?? 0}，错误 {importPreview.errorRows}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setImportPreview(null)}>取消</Button>
                <Button size="sm" onClick={() => void confirmImport()} disabled={pending || importPreview.errorRows > 0 || importPreview.acceptedRows === 0}>确认导入</Button>
              </div>
            </div>
            {importPreview.errors.length ? <ul className="mt-2 list-disc pl-5 text-xs text-destructive">{importPreview.errors.slice(0, 5).map((item) => <li key={`${item.rowNumber}-${item.error}`}>第 {item.rowNumber} 行：{item.error}</li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">前 {Math.min(importPreview.previewRows.length, 20)} 条已通过校验，确认后才会写入。</p>}
          </div>
        ) : null}
        {fileSourceList.length ? <p className="mt-3 text-xs text-muted-foreground">当前文件源：{fileSourceList.map((source) => `${source.fileName}（第 ${source.revision} 版，${source.rowCount} 条）`).join(" · ")}</p> : null}
        {fileSourceList.length ? (
          <div className="mt-3 rounded-lg border border-warning/30 bg-warning/[0.04] p-3 text-sm">
            <p className="font-medium">安全写回规则</p>
            <p className="mt-1 text-xs text-muted-foreground">只绑定已有的 CSV/XLSX 规则；没有规则时，微信任务只生成预览，不会修改源文件。</p>
            <div className="mt-2 grid gap-2">
              {fileSourceList.map((source) => {
                const binding = mutationBindingList.find((item) => item.fileSourceId === source.id && item.status === "active");
                const definitions = ledgerDefinitionList.filter((definition) =>
                  definition.projectId === projectId
                  && definition.state === "active"
                  && definition.format.toLowerCase() === source.fileName.toLowerCase().split(".").pop()
                  && definition.relativePath.toLowerCase().split(/[\\/]/).pop() === source.fileName.toLowerCase());
                return (
                  <div key={source.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2">
                    <span className="min-w-48 font-medium">{source.fileName}</span>
                    {binding ? (
                      <Badge tone={binding.stale ? "warning" : "success"}>{binding.stale ? "规则已失效" : `已绑定 · v${binding.ledgerDefinitionRevision}`}</Badge>
                    ) : definitions.length ? (
                      definitions.map((definition) => (
                        <Button key={definition.id} size="sm" variant="secondary" onClick={() => void bindMutationRule(source, definition.id)} disabled={pending}>
                          绑定“{definition.name}”
                        </Button>
                      ))
                    ) : <span className="text-xs text-muted-foreground">暂无同名且同格式的启用规则</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {syncPreview ? (
          <div className="mt-3 rounded-lg border bg-background p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">同步预览：新增 {syncPreview.creates} 条，更新 {syncPreview.updates} 条，无变化 {syncPreview.unchanged} 条</p>
              <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setSyncPreview(null)}>取消</Button><Button size="sm" onClick={() => void confirmSync()} disabled={syncing || syncPreview.creates + syncPreview.updates === 0}>确认同步</Button></div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">确认后只更新本地业务对象，不会修改外部系统。</p>
            {syncPreview.sampleRows.length ? <ul className="mt-2 list-disc pl-5 text-xs">{syncPreview.sampleRows.slice(0, 5).map((row) => <li key={`${row.businessKey}-${row.change}`}>{row.change === "create" ? "新增" : row.change === "update" ? "更新" : "不变"}：{row.label}</li>)}</ul> : null}
          </div>
        ) : null}
        {connectorList.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
            <span className="font-medium">同步本地业务数据</span>
            <span className="text-xs text-muted-foreground">只读同步，不会修改外部系统</span>
            <div className="grid w-full gap-2">
              {connectorList.filter((connector) => connector.kinds.includes(kind)).map((connector) => {
                const config = connectorConfigList.find((item) => item.connectorId === connector.id);
                return <div key={connector.id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-32">{connector.name}</span>
                  {!connector.id.startsWith("business_") ? <Input className="max-w-xs" value={credentialRefs[connector.id] ?? ""} onChange={(event) => setCredentialRefs((current) => ({ ...current, [connector.id]: event.target.value }))} placeholder={config?.credentialConfigured ? "已配置凭据引用" : "凭据引用（不填 token）"} /> : null}
                  {!connector.id.startsWith("business_") ? <Button size="sm" variant="secondary" onClick={() => void saveConnectorConfig(connector.id, config)} disabled={pending || !credentialRefs[connector.id] && !config?.credentialConfigured}>保存配置</Button> : null}
                  {config ? <><Badge tone={config.health === "ready" ? "success" : config.health === "error" ? "danger" : "neutral"}>{config.health === "ready" ? "连接正常" : config.health === "error" ? "需要检查" : "未测试"}</Badge><Button size="sm" variant="ghost" onClick={() => void testConnector(config)} disabled={pending}>测试连接</Button></> : null}
                  {connector.id.startsWith("business_") ? <Button size="sm" variant="secondary" onClick={() => void sync(connector.id)} disabled={syncing || !projectId}>{syncing ? <Loader2 className="animate-spin" /> : null}预览同步</Button> : config?.status === "enabled" ? <Button size="sm" variant="secondary" onClick={() => void sync(config.connectorId, config.id)} disabled={syncing || !projectId}>{syncing ? <Loader2 className="animate-spin" /> : null}预览同步</Button> : null}
                </div>;
              })}
            </div>
          </div>
        ) : null}
        {notice ? <p className="mt-3 text-sm text-success" role="status">{notice}</p> : null}
        {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
        {query.isLoading ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />正在读取业务对象…</p>
        ) : query.isError ? (
          <p className="mt-4 text-sm text-destructive">暂时无法读取业务对象，请稍后重试。</p>
        ) : objectList.length ? (
          <ul className="mt-4 divide-y rounded-lg border">
            {objectList.map((record) => (
              <li key={record.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{objectLabel(record)}</span>
                    <Badge tone={record.status === "active" ? "success" : "neutral"}>{KIND_COPY[record.kind]}</Badge>
                    {record.status === "disabled" ? <Badge tone="warning">已停用</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {Object.entries(record.fields).filter(([key]) => key !== "accountNumber").map(([key, value]) => `${key}：${value}`).join(" · ") || "仅登记名称"}
                    {` · 版本 ${record.revision}`}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => void changeStatus(record)} disabled={pending}>
                  {record.status === "active" ? <Archive /> : <RotateCcw />}
                  {record.status === "active" ? "停用" : "恢复"}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">还没有登记对象。先登记一个常用联系人，微信任务就可以用真实对象核对。</p>
        )}
      </CardContent>
    </Card>
  );
}
