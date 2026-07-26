import { Button } from "@/components/ui/button";
import { actionErrorModel } from "@/lib/action-error";

export function ActionErrorNotice({ error, onRetry, labels }: {
  error: unknown;
  onRetry?: () => void;
  labels: { cause: string; impact: string; remedy: string; retry: string };
}) {
  const model = actionErrorModel(error);
  return (
    <div role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
      <p><strong>{labels.cause}:</strong> {model.cause}</p>
      <p><strong>{labels.impact}:</strong> {model.impact}</p>
      <p><strong>{labels.remedy}:</strong> {model.remedy}</p>
      {model.retryable && onRetry ? <Button size="sm" variant="secondary" onClick={onRetry}>{labels.retry}</Button> : null}
    </div>
  );
}
