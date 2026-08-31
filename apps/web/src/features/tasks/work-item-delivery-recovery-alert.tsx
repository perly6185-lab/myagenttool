import { Button } from "@/components/ui/button";

export type DeliveryRecoveryAction = "review_changes" | "refresh";

export function WorkItemDeliveryRecoveryAlert({
  error,
  recovery,
  language,
  compact = false,
  onRecover,
}: {
  error: string;
  recovery: DeliveryRecoveryAction | null;
  language: "zh" | "en";
  compact?: boolean;
  onRecover: () => void;
}) {
  return (
    <div className={compact ? "rounded-lg border border-destructive/30 bg-destructive/[0.04] p-3 text-sm" : "rounded-lg border border-destructive/35 bg-destructive/[0.05] px-3 py-2 text-sm"} role="alert">
      <p className="text-destructive">{error}</p>
      {recovery ? (
        <Button className="mt-2" size="sm" variant="secondary" onClick={onRecover}>
          {recovery === "review_changes"
            ? language === "zh" ? "检查当前改动" : "Review current changes"
            : language === "zh" ? "刷新任务" : "Refresh task"}
        </Button>
      ) : null}
    </div>
  );
}
