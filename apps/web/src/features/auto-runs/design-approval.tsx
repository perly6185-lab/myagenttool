import { useState } from "react";
import { Check, Loader2, MessageSquareX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, useAsyncAction } from "@/data/use-console-actions";
import type { AutoRunRecord } from "./auto-runs-view";

// D4 (issue→UI-design plan): the human design gate on a posted design report.
// Approve spawns the implementation child issue carrying the brief + artifact
// list (the click IS the authorization). Request-changes posts feedback back to
// the issue. Both audited server-side.
export function DesignApproval({ run, onDone }: { run: AutoRunRecord; onDone: () => Promise<void> | void }) {
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const { execute, pending, error } = useAsyncAction();

  const approval = run.designApproval;
  if (approval?.status === "approved") {
    return <Badge tone="success" title={`approved by ${approval.by ?? "?"}`}>design approved</Badge>;
  }
  if (approval?.status === "rejected") {
    return <Badge tone="warning" title={approval.feedback ?? undefined}>changes requested</Badge>;
  }

  const act = async (action: "approve" | "reject") => {
    const ok = await execute(() => api.designApproval(run.id, action, action === "reject" ? feedback : undefined));
    if (ok) {
      setRejecting(false);
      setFeedback("");
      void onDone();
    }
  };

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="primary" size="sm" className="h-6 px-2 text-xs" disabled={pending} onClick={() => void act("approve")}
          title="Approve this design — spawns the implementation issue carrying the brief + artifacts">
          {pending && !rejecting ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Check className="mr-1 size-3" />} Approve design
        </Button>
        <Button variant="secondary" size="sm" className="h-6 px-2 text-xs" disabled={pending} onClick={() => setRejecting((v) => !v)}
          title="Request changes — posts your feedback back to the issue">
          <MessageSquareX className="mr-1 size-3" /> Request changes
        </Button>
      </div>
      {rejecting ? (
        <div className="flex flex-col gap-1">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={2}
            placeholder="What should change in this design?"
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          />
          <Button variant="secondary" size="sm" className="h-6 self-start px-2 text-xs" disabled={pending} onClick={() => void act("reject")}>
            {pending ? <Loader2 className="mr-1 size-3 animate-spin" /> : null} Send feedback
          </Button>
        </div>
      ) : null}
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
