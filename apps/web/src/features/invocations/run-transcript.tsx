import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Brain, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CollapsiblePanel } from "@/components/ui/collapsible-panel";
import { MarkdownBlock } from "@/components/ui/markdown-block";
import { api, type RunTranscriptBlock, type RunTranscriptRecord } from "@/lib/api-client";
import { cn } from "@/lib/cn";

// #1074 (Epic #1070): render a persisted run transcript the way the Claude Code
// IDE does — "Thought for Ns" blocks, tool-call rows with collapsible IN/OUT
// panels, Markdown assistant text. Truncation and retention are shown honestly:
// a cut payload says how much was dropped, a reaped one says the payload
// expired; a run with no transcript renders nothing (old runs are unaffected).

/** Pair each tool_use with its tool_result (by toolUseId, in stream order). */
export interface TranscriptStep {
  block: RunTranscriptBlock;
  result?: RunTranscriptBlock;
}

export function pairTranscriptBlocks(blocks: RunTranscriptBlock[]): TranscriptStep[] {
  const consumed = new Set<number>();
  const steps: TranscriptStep[] = [];
  blocks.forEach((block, index) => {
    if (consumed.has(index)) return;
    if (block.kind === "tool_use" && block.toolUseId) {
      const match = blocks.findIndex(
        (candidate, at) =>
          at > index && !consumed.has(at) && candidate.kind === "tool_result" && candidate.toolUseId === block.toolUseId,
      );
      if (match >= 0) {
        consumed.add(match);
        steps.push({ block, result: blocks[match] });
        return;
      }
    }
    steps.push({ block });
  });
  return steps;
}

export function thoughtLabel(durationMs?: number) {
  if (!Number.isFinite(durationMs)) return "Thought";
  const seconds = Math.round((durationMs as number) / 1000);
  return seconds < 1 ? "Thought for <1s" : `Thought for ${seconds}s`;
}

function sizeLabel(chars: number) {
  return chars >= 1024 ? `${(chars / 1024).toFixed(1)} KB` : `${chars} chars`;
}

/** The explicit degraded-state notice for one block, or null when intact. */
function payloadNotice(block: RunTranscriptBlock, reaped: boolean) {
  if (block.payloadDropped) {
    const size = block.chars ? ` (${sizeLabel(block.chars)})` : "";
    return reaped ? `payload expired per retention${size}` : `payload dropped by size budget${size}`;
  }
  if (block.truncated && block.droppedChars) {
    return `truncated — ${sizeLabel(block.droppedChars)} dropped`;
  }
  return null;
}

function MonospacePayload({ value, notice }: { value?: string; notice: string | null }) {
  return (
    <div className="space-y-1">
      {value ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs [overflow-wrap:anywhere]">{value}</pre>
      ) : null}
      {notice ? <p className="text-[11px] italic text-muted-foreground">{notice}</p> : null}
    </div>
  );
}

function ThinkingBlock({ block, reaped }: { block: RunTranscriptBlock; reaped: boolean }) {
  const notice = payloadNotice(block, reaped);
  return (
    <CollapsiblePanel
      label={
        <span className="inline-flex items-center gap-1.5">
          <Brain aria-hidden className="size-3.5" />
          {thoughtLabel(block.durationMs)}
        </span>
      }
      meta={notice && block.payloadDropped ? <span className="italic">{notice}</span> : undefined}
      className="border-dashed"
    >
      <MonospacePayload value={block.text} notice={block.payloadDropped ? null : notice} />
    </CollapsiblePanel>
  );
}

function ToolCallRow({ step, reaped }: { step: TranscriptStep; reaped: boolean }) {
  const { block, result } = step;
  const inNotice = payloadNotice(block, reaped);
  const outNotice = result ? payloadNotice(result, reaped) : null;
  return (
    <div className="min-w-0 rounded-md border border-border">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Terminal aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-sm font-semibold">{block.toolName ?? "tool"}</span>
        {block.description ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{block.description}</span>
        ) : null}
        {result?.isError ? (
          <Badge tone="warning">
            <span className="inline-flex items-center gap-1">
              <AlertTriangle aria-hidden className="size-3" /> error
            </span>
          </Badge>
        ) : null}
      </div>
      <div className="space-y-1.5 border-t border-border px-2 py-1.5">
        <CollapsiblePanel label="IN" meta={inNotice ? <span className="italic">{inNotice}</span> : undefined}>
          <MonospacePayload value={block.input} notice={block.payloadDropped ? null : inNotice} />
        </CollapsiblePanel>
        {result ? (
          <CollapsiblePanel
            label="OUT"
            meta={outNotice ? <span className="italic">{outNotice}</span> : undefined}
            className={cn(result.isError && "border-warning/50")}
          >
            <MonospacePayload value={result.output} notice={result.payloadDropped ? null : outNotice} />
          </CollapsiblePanel>
        ) : null}
      </div>
    </div>
  );
}

export function RunTranscriptBlocks({ transcript, className }: { transcript: RunTranscriptRecord; className?: string }) {
  const steps = pairTranscriptBlocks(transcript.blocks ?? []);
  if (steps.length === 0) return null;
  return (
    <div className={cn("space-y-2", className)}>
      {transcript.payloadReaped ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-warning">
          Transcript payload expired per retention policy — structure only (kinds, tools, durations, sizes).
        </p>
      ) : null}
      {steps.map((step, index) => {
        const { block } = step;
        if (block.kind === "thinking") return <ThinkingBlock key={index} block={block} reaped={transcript.payloadReaped} />;
        if (block.kind === "tool_use") return <ToolCallRow key={index} step={step} reaped={transcript.payloadReaped} />;
        if (block.kind === "tool_result") {
          // Unpaired result (its tool_use fell to a cap): still show the output.
          return <ToolCallRow key={index} step={{ block: { ...block, kind: "tool_use", toolName: "tool result" }, result: block }} reaped={transcript.payloadReaped} />;
        }
        return block.text || !block.payloadDropped ? (
          <MarkdownBlock key={index} text={block.text ?? ""} />
        ) : (
          <p key={index} className="text-[11px] italic text-muted-foreground">
            {payloadNotice(block, transcript.payloadReaped)}
          </p>
        );
      })}
      {transcript.droppedBlocks > 0 ? (
        <p className="text-[11px] italic text-muted-foreground">
          {transcript.droppedBlocks} step(s) were dropped by the transcript size budget.
        </p>
      ) : null}
    </div>
  );
}

export function useRunTranscript(invocationId: string) {
  return useQuery({
    queryKey: ["run-transcript", invocationId],
    queryFn: () => api.fetchInvocationTranscript(invocationId),
    staleTime: 30_000,
  });
}

/**
 * Fetch-and-render wrapper for the two run surfaces. Renders NOTHING when the
 * run has no persisted transcript (old runs, non-claude agents) — those
 * surfaces stay exactly as they are today. The absent-id guard lives OUTSIDE
 * the querying component so a surface with no run never touches the query
 * machinery at all.
 */
export function RunTranscriptSection({
  invocationId,
  ...rest
}: {
  invocationId: string | null | undefined;
  defaultOpen?: boolean;
  className?: string;
}) {
  if (!invocationId) return null;
  return <LoadedRunTranscriptSection invocationId={invocationId} {...rest} />;
}

function LoadedRunTranscriptSection({
  invocationId,
  defaultOpen = true,
  className,
}: {
  invocationId: string;
  defaultOpen?: boolean;
  className?: string;
}) {
  const { data } = useRunTranscript(invocationId);
  const transcript = data?.transcript ?? null;
  if (!transcript || (transcript.blocks ?? []).length === 0) return null;
  return (
    <CollapsiblePanel
      label={`Agent transcript (${transcript.blocks.length} steps)`}
      meta={transcript.payloadReaped ? <span className="italic">payload expired</span> : undefined}
      defaultOpen={defaultOpen}
      className={className}
      contentClassName="p-2"
    >
      <RunTranscriptBlocks transcript={transcript} />
    </CollapsiblePanel>
  );
}
