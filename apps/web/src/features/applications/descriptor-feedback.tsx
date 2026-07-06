import { Badge } from "@/components/ui/badge";
import { descriptorFeedbackIssues, type WrapperCapabilityImpact } from "@/features/applications/descriptor-utils";

export function WrapperCapabilityImpactPanel({ impact }: { impact: WrapperCapabilityImpact | null }) {
  if (!impact) return null;
  const changed = [
    ...impact.added.map((name) => `+ ${name}`),
    ...impact.removed.map((name) => `- ${name}`),
  ];
  return (
    <div className="rounded-md border border-border/70 p-3 text-xs">
      <div className="mb-2 font-medium">Capability impact</div>
      <div className="flex flex-wrap gap-2">
        <Badge tone={impact.added.length ? "success" : "neutral"}>{impact.added.length} added</Badge>
        <Badge tone={impact.removed.length ? "danger" : "neutral"}>{impact.removed.length} removed</Badge>
        <Badge tone="neutral">{impact.unchanged.length} unchanged</Badge>
      </div>
      {changed.length ? (
        <p className="mt-2 break-words text-muted-foreground">{changed.join(" · ")}</p>
      ) : null}
    </div>
  );
}

export function DescriptorFeedbackList({ message }: { message?: string | null }) {
  const issues = descriptorFeedbackIssues(message);
  if (!issues.length) return null;
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
      <div className="mb-2 font-medium">Descriptor feedback</div>
      <ul className="space-y-1">
        {issues.map((issue, index) => (
          <li key={`${issue.path ?? "message"}-${index}`} className="break-words">
            {issue.path ? <span className="font-medium">{issue.path}: </span> : null}
            <span>{issue.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
