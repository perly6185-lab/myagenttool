import { formatUsd as usd } from "@/lib/money";
import type { ImportedUsageEstimate } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

export function importedUsagePeriod(row: ImportedUsageEstimate): string {
  return row.date ?? row.month ?? row.week ?? row.periodStart ?? "—";
}

/**
 * The imported-estimate rows table, shared between the Economics card (all rows)
 * and the Invocations detail (this run's rows). Estimates are non-authoritative
 * external-billed figures — callers own that framing; this renders the data.
 */
export function ImportedUsageTable({ rows, limit = 50 }: { rows: ImportedUsageEstimate[]; limit?: number }) {
  const { t } = useAppTranslation();
  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {["provider","model","period","tokens","cost"].map((key, index) => <th key={key} className={`px-3 py-2 ${index > 2 ? "text-right" : "text-left"} font-medium`}>{t(`economicsImport.${key}` as never)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="px-3 py-2">{row.provider ?? row.sourceAgent ?? "unknown"}</td>
                <td className="px-3 py-2 text-muted-foreground">{row.model ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{importedUsagePeriod(row)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {(row.totalTokens ?? (row.inputTokens ?? 0) + (row.outputTokens ?? 0)) || "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {row.estimatedCostUsd != null ? `~${usd(row.estimatedCostUsd)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit ? (
        <p className="text-xs text-muted-foreground">{t("economicsImport.showing", { limit, total: rows.length })}</p>
      ) : null}
    </>
  );
}
