import { Button } from "@/components/ui/button";
import { FactList } from "@/components/common/fact-list";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { approvalFor } from "@/features/selection";
import { cn } from "@/lib/cn";
import type { InvocationEventSnapshot } from "@/lib/console-state";

// The actionable "exit" for a decision event in an output stream, so every
// pending-decision item — not just security approvals — has somewhere to act
// from where it appears. Two shapes today:
//  - local_approval_requested (BLOCKING): the run is paused; inline Approve/Deny
//    with the policy's risk summary. Covers both risk- and budget-triggered
//    approvals (same mechanism). Collapses to a one-line note once decided.
//  - platform_agent_action_requested (ADVISORY): a recommendation whose real
//    decision lives on another surface; a deep-link that navigates there.
// Returns null for ordinary events, so it is safe to pass for every event.
export function DecisionAction({ event }: { event: InvocationEventSnapshot }) {
  const { data: state } = useConsoleState();
  const { execute, pending } = useAsyncAction();
  const setSection = useUiStore((s) => s.setSection);
  const setSelectedArtifactId = useUiStore((s) => s.setSelectedArtifactId);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);

  if (event.type === "local_approval_requested") {
    // Resolve by THIS event's invocation (not just the latest) so a multi-run
    // stream keeps each approval anchored to its own moment.
    const inv = (state?.invocations ?? []).find((i) => i.id === event.invocationId) ?? null;
    const approval = approvalFor(state, inv);
    if (!approval) return null;
    if (approval.status !== "pending") {
      return (
        <p
          className={cn(
            "mt-1.5 text-xs font-medium",
            approval.status === "approved" ? "text-success" : "text-destructive",
          )}
        >
          {approval.status === "approved" ? "✓ Approved — run released." : "✕ Denied — run blocked."}
        </p>
      );
    }
    return (
      <div className="mt-2 space-y-2 rounded-md border border-warning/50 bg-warning/5 p-3">
        <FactList
          facts={[
            { term: "Risk", value: approval.summary?.risk ?? `${approval.riskLevel ?? "unknown"} risk` },
            { term: "Data", value: approval.summary?.data ?? "Task input and result are recorded." },
            { term: "Cost", value: approval.summary?.cost ?? "Cost is unknown." },
            { term: "Cancel", value: approval.summary?.cancellation ?? "Cancellation behavior is unknown." },
            { term: "Tags", value: approval.riskTags?.length ? approval.riskTags.join(", ") : "No tags declared" },
          ]}
        />
        <div className="flex gap-2">
          <Button size="sm" disabled={pending} onClick={() => execute(() => api.approveApproval(approval.id))}>
            Approve run
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => execute(() => api.denyApproval(approval.id))}
          >
            Deny run
          </Button>
        </div>
      </div>
    );
  }

  if (event.type === "platform_agent_action_requested") {
    const artifactId = event.data?.artifactId;
    const targetInvocationId = event.data?.targetInvocationId;
    if (artifactId) {
      return (
        <Button
          variant="secondary"
          size="sm"
          className="mt-2"
          onClick={() => {
            setSelectedArtifactId(artifactId);
            setSection("integrations");
          }}
        >
          Review integration →
        </Button>
      );
    }
    if (targetInvocationId) {
      return (
        <Button
          variant="secondary"
          size="sm"
          className="mt-2"
          onClick={() => {
            setSelectedInvocationId(targetInvocationId);
            setSection("invocations");
          }}
        >
          Open troubleshooting report →
        </Button>
      );
    }
    return null;
  }

  return null;
}
