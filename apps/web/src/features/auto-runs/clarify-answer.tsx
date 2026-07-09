import { useState } from "react";
import { Loader2, MessageSquareReply } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, useAsyncAction } from "@/data/use-console-actions";
import type { AutoRunRecord } from "./auto-runs-view";

// E3 (decision-path expansion): answer a clarify run's questions inline. The
// answers post back to the issue so a re-triggered run has the context; then the
// human re-labels the issue `auto` to proceed.
export function ClarifyAnswer({ run, onDone }: { run: AutoRunRecord; onDone: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { execute, pending, error } = useAsyncAction();

  if (run.clarifyAnswer) {
    return <Badge tone="success" title={`answered by ${run.clarifyAnswer.by ?? "?"}`}>answered</Badge>;
  }

  const submit = async () => {
    if (!text.trim()) return;
    const ok = await execute(() => api.answerClarify(run.id, text));
    if (ok) {
      setOpen(false);
      setText("");
      void onDone();
    }
  };

  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="h-6 self-start px-2 text-xs" onClick={() => setOpen(true)}
        title="Answer the clarifying questions — posts to the issue">
        <MessageSquareReply className="mr-1 size-3" /> Answer questions
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-col gap-1">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Answer the questions above…"
        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
      />
      <div className="flex gap-2">
        <Button variant="primary" size="sm" className="h-6 px-2 text-xs" disabled={pending || !text.trim()} onClick={() => void submit()}>
          {pending ? <Loader2 className="mr-1 size-3 animate-spin" /> : null} Post answers to issue
        </Button>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
