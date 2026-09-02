import type { LocalWorkItem } from "./task-view-types";

type ChannelTaskContract = NonNullable<LocalWorkItem["channelTaskContract"]>;

export function WorkItemChannelDataPlan({
  contract,
  language,
}: {
  contract: ChannelTaskContract;
  language: "zh" | "en";
}) {
  const plan = contract.dataPlan;
  if (!plan || plan.status === "not_required") return null;

  return (
    <section
      className={`rounded-xl border p-4 ${plan.status === "ready" ? "border-success/30 bg-success/[0.04]" : "border-warning/35 bg-warning/[0.05]"}`}
      aria-label={language === "zh" ? "资料检查结果" : "Source check results"}
    >
      <h4 className="text-sm font-semibold">{language === "zh" ? "资料检查结果" : "Source check results"}</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        {plan.status === "ready"
          ? (language === "zh" ? "以下资料会用于本次处理，开始前还会再次检查。" : "These sources will be used for this task and checked again before starting.")
          : (language === "zh" ? "还缺少部分资料，补齐或选择来源后才能继续。" : "Some sources are still missing. Add or choose them before continuing.")}
      </p>
      {plan.sources.length ? (
        <ul className="mt-3 space-y-1 text-xs">
          {plan.sources.map((source) => (
            <li key={source.sourceId}>
              <span className="font-medium">{source.fileName ?? source.sourceId}</span>
              {source.revision != null ? <span className="ml-1 text-muted-foreground">· v{source.revision}</span> : null}
              {source.rowCount != null ? <span className="ml-1 text-muted-foreground">· {source.rowCount} rows</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {plan.requirements.filter((requirement) => requirement.state !== "ready").map((requirement) => (
        <p key={requirement.id} className="mt-2 text-xs text-warning-foreground">
          {language === "zh" ? "还需要：" : "Needed: "}{requirement.label}{requirement.state === "ambiguous" ? (language === "zh" ? "（来源不唯一）" : " (multiple sources)") : ""}
        </p>
      ))}
      {plan.relations.length ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {language === "zh" ? "资料对应关系：" : "Source relationships: "}
          {plan.relations.map((relation) => `${relation.fromRequirementId}.${relation.fromField} → ${relation.toRequirementId}.${relation.toField}`).join("；")}
        </p>
      ) : null}
      {contract.dataRelationPreview?.relations.length ? (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {contract.dataRelationPreview.relations.map((relation) => (
            <li key={relation.id}>
              {relation.fromRequirementId}.{relation.fromField} → {relation.toRequirementId}.{relation.toField}：
              {relation.state === "ready"
                ? (language === "zh" ? `已对应 ${relation.matchedRows} 条` : `${relation.matchedRows} matched`)
                : (language === "zh" ? `还需确认，${relation.unmatchedRows} 条未对应` : `review needed, ${relation.unmatchedRows} unmatched`)}
            </li>
          ))}
        </ul>
      ) : null}
      {contract.dataRelationConfirmation ? (
        <div className="mt-3 rounded-lg border border-success/25 bg-success/[0.04] p-3 text-xs">
          <p className="font-medium text-success-foreground">
            {contract.dataRelationConfirmation.status === "verified"
              ? (language === "zh" ? "资料对应关系已检查并记录" : "Source relationships checked and recorded")
              : (language === "zh" ? "资料对应关系检查状态：" : "Source relationship check: ") + contract.dataRelationConfirmation.status}
          </p>
          <p className="mt-1 text-muted-foreground">
            {contract.dataRelationConfirmation.confirmationMode === "user_confirmation"
              ? (language === "zh" ? "由本次确认完成检查" : "Checked by this confirmation")
              : (language === "zh" ? "由系统在开始前完成检查" : "Checked by the system before starting")}
            {contract.dataRelationConfirmation.objectSnapshotCount > 0
              ? (language === "zh"
                ? ` · 已记录 ${contract.dataRelationConfirmation.objectSnapshotCount} 个对象版本`
                : ` · ${contract.dataRelationConfirmation.objectSnapshotCount} object versions recorded`)
              : ""}
          </p>
        </div>
      ) : null}
    </section>
  );
}

export function WorkItemChannelMutationPreview({
  contract,
  language,
}: {
  contract: ChannelTaskContract;
  language: "zh" | "en";
}) {
  const preview = contract.dataMutationPreview;
  const ledgerPreview = contract.ledgerMutationPreview;
  if (!preview || preview.status === "not_required") return null;

  const title = language === "zh"
    ? (ledgerPreview?.kind === "batch" ? "批量文件修改预览" : ledgerPreview ? "单条文件修改预览" : "文件修改预览")
    : (ledgerPreview ? "Single-record file change preview" : "File change preview");

  return (
    <section className="rounded-xl border border-warning/35 bg-warning/[0.05] p-4" aria-label={title}>
      <h4 className="text-sm font-semibold">{title}</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        {ledgerPreview
          ? (language === "zh"
            ? (ledgerPreview.kind === "batch"
              ? "已生成批量文件修改预览；回复“确认执行”后按文件顺序处理，部分失败会保留可恢复记录。"
              : "已生成文件修改预览；回复“确认执行”后才会修改，桌面端会保留处理记录。")
            : "A file change preview is ready. Personal Channel confirmation is required before changes are applied.")
          : (language === "zh"
            ? preview.status === "ready"
              ? "修改范围预览已生成，但还不会直接修改原文件。"
              : "目前只整理了修改范围，还需要明确文件、记录范围和修改内容。"
            : preview.status === "ready"
              ? "The change scope is previewed, but source files will not be modified yet."
              : "Only the change scope is recorded. Confirm the files, rows, and changes before continuing.")}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        {contract.dataMutationBinding
          ? (language === "zh" ? "文件保护设置已准备好" : "File protection is ready")
          : (language === "zh" ? "还需要检查文件保护设置" : "File protection still needs checking")}
      </p>
      {preview.targetSources.length ? (
        <ul className="mt-3 space-y-1 text-xs">
          {preview.targetSources.map((source) => (
            <li key={source.sourceId}>
              <span className="font-medium">{source.fileName ?? source.sourceId}</span>
              {source.revision != null ? <span className="ml-1 text-muted-foreground">· v{source.revision}</span> : null}
              {source.rowCount != null ? <span className="ml-1 text-muted-foreground">· {source.rowCount} rows</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {preview.dataMutationScope ? (
        <div className="mt-3 rounded-lg border border-warning/25 bg-background/40 p-3 text-xs">
          <p className="font-medium">
            {language === "zh" ? "修改范围已固定" : "Change scope fixed"}
            <span className="ml-2 text-muted-foreground">
              {language === "zh"
                ? `${preview.dataMutationScope.targets.length} 个文件 · 预计 ${preview.dataMutationScope.expectedAffectedRows} 条`
                : `${preview.dataMutationScope.targets.length} files · ${preview.dataMutationScope.expectedAffectedRows} rows`}
            </span>
          </p>
          <p className="mt-1 text-muted-foreground">
            {language === "zh" ? "系统只保留必要的处理记录，不保存原始筛选内容。" : "Only necessary processing records are kept; raw filters are not persisted."}
          </p>
          {preview.dataMutationScope.changes.length ? (
            <p className="mt-1 text-muted-foreground">
              {language === "zh" ? "字段：" : "Fields: "}
              {preview.dataMutationScope.changes.map((change) => change.field).join("、")}
            </p>
          ) : null}
        </div>
      ) : null}
      {ledgerPreview ? (
        <div className="mt-3 rounded-lg border border-success/25 bg-success/[0.04] p-3 text-xs">
          <p className="font-medium text-success-foreground">
            {ledgerPreview.state === "rolled_back"
              ? (language === "zh" ? "修改已安全撤回" : "Changes rolled back safely")
              : ledgerPreview.state === "needs_attention"
                ? (language === "zh" ? "需要检查文件" : "File needs attention")
                : ledgerPreview.state === "committing"
                  ? (language === "zh" ? "正在恢复修改进度" : "Recovering change progress")
                  : (language === "zh" ? "文件修改预览已生成" : "File change preview ready")}
            <span className="ml-2 text-muted-foreground">
              {ledgerPreview.state === "waiting"
                ? (language === "zh" ? "排队等待处理" : "queued behind another change")
                : ledgerPreview.state === "rolled_back"
                  ? (language === "zh" ? "未保留任何部分修改" : "no partial changes kept")
                  : ledgerPreview.state === "needs_attention"
                    ? (language === "zh" ? "检测到文件被其他程序修改" : "file changed elsewhere")
                    : ledgerPreview.state === "committing"
                      ? (language === "zh" ? "已完成项不会重复修改" : "completed items will not repeat")
                      : (language === "zh" ? "等待 Channel 确认" : "awaiting Channel confirmation")}
            </span>
          </p>
          <p className="mt-1 text-muted-foreground">
            {ledgerPreview.kind === "batch"
              ? `${language === "zh" ? "涉及：" : "Scope: "}${ledgerPreview.targetCount ?? 0} ${language === "zh" ? "个文件，" : "files, "}${ledgerPreview.operationCount ?? ledgerPreview.children?.length ?? 0} ${language === "zh" ? "条记录" : "operations"}`
              : ledgerPreview.changedCells.length
                ? `${language === "zh" ? "字段：" : "Fields: "}${ledgerPreview.changedCells.map((cell) => cell.field).filter(Boolean).join("、")}`
                : (language === "zh" ? "没有检测到实际字段变化" : "No field difference detected")}
            {ledgerPreview.kind !== "batch" && ledgerPreview.rowNumber != null
              ? ` · ${language === "zh" ? "第" : "row "}${ledgerPreview.rowNumber}${language === "zh" ? "行" : ""}`
              : ""}
          </p>
          {ledgerPreview.kind === "batch" && ledgerPreview.journal ? (
            <p className="mt-1 text-muted-foreground">
              {language === "zh"
                ? `处理记录：已完成 ${ledgerPreview.journal.appliedCount} 项、保留 ${ledgerPreview.journal.snapshotCount} 个文件备份`
                : `Processing record: ${ledgerPreview.journal.appliedCount} completed, ${ledgerPreview.journal.snapshotCount} file backups`}
            </p>
          ) : null}
        </div>
      ) : null}
      {preview.requiredFields.map((field) => (
        <p key={field} className="mt-2 text-xs text-warning-foreground">{language === "zh" ? "还需要：" : "Needed: "}{field}</p>
      ))}
    </section>
  );
}
