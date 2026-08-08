import { Badge } from "@/components/ui/badge";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { LocalWorkItem } from "./task-view-types";

export function WorkItemAcceptanceSection({ item }: { item: LocalWorkItem }) {
  const { t } = useAppTranslation();
  const criteria = item.reviewContract?.acceptanceCriteria ?? item.acceptanceCriteria;
  if (!criteria.length && !item.verificationRecords?.length) return null;
  return (
    <section className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("tasks.acceptanceCriteria")}</h3>
        <Badge tone={item.completionGate?.ready ? "success" : "warning"}>
          {t(item.completionGate?.ready ? "tasks.localStatus.done" : "tasks.localStatus.blocked")}
        </Badge>
      </div>
      <ul className="space-y-1">
        {criteria.map((criterion) => {
          const result = item.reviewEvidence?.find((candidate) => candidate.criterion === criterion)
            ?? item.acceptanceResults?.find((candidate) => candidate.criterion === criterion);
          return (
            <li key={criterion} className="flex items-start justify-between gap-2 text-xs">
              <span>{criterion}{result?.note ? ` · ${result.note}` : ""}</span>
              <Badge tone={result?.status === "passed" ? "success" : result?.status === "failed" ? "danger" : "neutral"}>
                {result?.status === "passed" ? t("approvals.testsPassed") : result?.status === "failed" ? t("approvals.testsFailed") : t("evidence.none")}
              </Badge>
            </li>
          );
        })}
      </ul>
      {item.reviewContract ? (
        <p className="font-mono text-[10px] text-muted-foreground">
          {item.reviewContract.schemaVersion} · {item.reviewContract.digest?.slice(0, 12) ?? item.reviewContract.id}
        </p>
      ) : null}
      {(item.verificationRecords ?? []).map((record) => (
        <div key={record.id} className="rounded bg-muted p-2 text-xs">
          <div className="flex justify-between gap-2">
            <strong>{record.kind} · {record.summary}</strong>
            <Badge tone={record.status === "passed" ? "success" : "danger"}>
              {t(record.status === "passed" ? "approvals.testsPassed" : "approvals.testsFailed")}
            </Badge>
          </div>
          {record.command ? <code className="mt-1 block">{record.command}</code> : null}
          {record.evidence.map((entry) => <div key={`${entry.kind}:${entry.ref}`} className="mt-1 font-mono">{entry.kind}: {entry.ref}</div>)}
        </div>
      ))}
    </section>
  );
}
