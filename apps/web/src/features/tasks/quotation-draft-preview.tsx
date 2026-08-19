import { CheckCircle2, FileCheck2 } from "lucide-react";

import { useAppTranslation } from "@/lib/i18n/use-app-translation";

type OfficePreview = {
  changes: Array<{ field: string; after: string }>;
  unchanged: {
    formulaCount?: number;
    preservesStyles?: boolean;
    tablePartCount?: number;
    mediaPartCount?: number;
  };
};

function parseOfficePreview(value: string): OfficePreview | null {
  try {
    const parsed = JSON.parse(value) as Partial<OfficePreview>;
    if (!Array.isArray(parsed.changes) || !parsed.unchanged || typeof parsed.unchanged !== "object") {
      return null;
    }
    const changes = parsed.changes
      .filter((change): change is { field: string; after: string } =>
        Boolean(change)
        && typeof change.field === "string"
        && typeof change.after === "string")
      .slice(0, 100);
    return { changes, unchanged: parsed.unchanged };
  } catch {
    return null;
  }
}

export function QuotationDraftPreview({ preview }: { preview: string }) {
  const { i18n } = useAppTranslation();
  const zh = i18n.resolvedLanguage?.startsWith("zh") ?? false;
  const office = parseOfficePreview(preview);

  if (!office) {
    return (
      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 text-xs">
        {preview}
      </pre>
    );
  }

  const preserved = [
    office.unchanged.preservesStyles ? (zh ? "原有样式" : "existing styles") : null,
    (office.unchanged.formulaCount ?? 0) > 0
      ? (zh ? `${office.unchanged.formulaCount} 个公式` : `${office.unchanged.formulaCount} formulas`)
      : null,
    (office.unchanged.tablePartCount ?? 0) > 0
      ? (zh ? `${office.unchanged.tablePartCount} 个表格` : `${office.unchanged.tablePartCount} tables`)
      : null,
    (office.unchanged.mediaPartCount ?? 0) > 0
      ? (zh ? `${office.unchanged.mediaPartCount} 个图片或附件` : `${office.unchanged.mediaPartCount} images or attachments`)
      : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <div className="mt-1 space-y-2 rounded border bg-background p-3 text-xs">
      <div className="flex items-center gap-2 font-medium">
        <FileCheck2 className="size-4 text-primary" aria-hidden="true" />
        {zh ? "将填写以下内容" : "The following values will be filled"}
      </div>
      {office.changes.length ? (
        <dl className="grid gap-2 sm:grid-cols-2">
          {office.changes.map((change, index) => (
            <div key={`${change.field}:${index}`} className="rounded bg-muted/40 p-2">
              <dt className="text-muted-foreground">{change.field.replaceAll("_", " ")}</dt>
              <dd className="mt-0.5 break-words font-medium">{change.after}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-muted-foreground">{zh ? "没有需要填写的新内容。" : "No new values need to be filled."}</p>
      )}
      <div className="flex items-start gap-2 rounded bg-success/5 p-2 text-muted-foreground">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
        <p>
          {zh ? "模板的其他内容不会改变" : "The rest of the template will not change"}
          {preserved.length ? `：${preserved.join(zh ? "、" : ", ")}` : "。"}
        </p>
      </div>
    </div>
  );
}
