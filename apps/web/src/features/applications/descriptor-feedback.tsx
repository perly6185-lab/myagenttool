import { Badge } from "@/components/ui/badge";
import { descriptorFeedbackIssues, type DescriptorRiskPreview, type DescriptorRiskPreviewItem, type WrapperCapabilityImpact } from "@/features/applications/descriptor-utils";
import { isApiError } from "@/lib/api-client";

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

export function DescriptorRiskPreviewPanel({ preview }: { preview: DescriptorRiskPreview }) {
  if (!preview.items.length) return null;
  return (
    <div className="rounded-md border border-border/70 p-3 text-xs">
      <div className="mb-2 font-medium">Descriptor risk preview</div>
      <div className="flex flex-wrap gap-2">
        <Badge tone={preview.projectedCount ? "success" : "neutral"}>{preview.projectedCount} projected</Badge>
        <Badge tone={preview.draftCount ? "warning" : "neutral"}>{preview.draftCount} draft/candidate</Badge>
        <Badge tone={preview.approvalCount ? "warning" : "neutral"}>{preview.approvalCount} approval</Badge>
        <Badge tone={preview.policyConsentCount ? "danger" : "neutral"}>{preview.policyConsentCount} consent</Badge>
        <Badge tone={preview.highRiskCount ? "danger" : "neutral"}>{preview.highRiskCount} high risk</Badge>
      </div>
      <ul className="mt-2 space-y-1 text-muted-foreground">
        {preview.items.slice(0, 8).map((item) => (
          <li key={item.id} className="[overflow-wrap:anywhere]">
            <span className="font-medium text-foreground">{item.label}</span>
            {" · "}
            {readableSurface(item)}
            {" · "}
            {item.status}
            {" · "}
            {item.riskLevel}
            {item.requiresApproval ? " · approval" : ""}
            {item.needsPolicyConsent ? ` · consent for ${item.filePolicy}/${item.networkPolicy}` : ""}
          </li>
        ))}
      </ul>
      {preview.items.length > 8 ? (
        <p className="mt-2 text-muted-foreground">{preview.items.length - 8} more descriptor item(s).</p>
      ) : null}
    </div>
  );
}

function readableSurface(item: DescriptorRiskPreviewItem): string {
  if (item.surface === "npm_wrapper") return "npm wrapper";
  if (item.surface === "manual_manifest") return "manual manifest";
  return "MCP";
}

export function DescriptorFeedbackList({ message, error }: { message?: string | null; error?: unknown }) {
  const issues = isApiError(error) && error.validationErrors.length
    ? error.validationErrors.map((item) => ({ path: item.path ?? null, message: item.message ?? item.code ?? "Invalid value." }))
    : descriptorFeedbackIssues(message ?? (error instanceof Error ? error.message : null));
  const facts = isApiError(error)
    ? [
        error.code ? `code ${error.code}` : null,
        `status ${error.status}`,
        error.reason ? `reason ${error.reason}` : null,
        typeof error.body.action === "string" ? `action ${error.body.action}` : null,
        typeof error.body.applicationId === "string" ? `application ${error.body.applicationId}` : null,
      ].filter(Boolean)
    : [];
  if (!issues.length && !facts.length) return null;
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
      <div className="mb-2 font-medium">Descriptor feedback</div>
      {facts.length ? <p className="mb-2 break-words text-muted-foreground">{facts.join(" · ")}</p> : null}
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
