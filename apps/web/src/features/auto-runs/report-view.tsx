import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

// D1 (issue→UI-design plan): make a design/investigation report legible.
// The report used to render as a 3-line plain-text clamp, which destroyed the
// ASCII wireframes the design role produces. This renders fenced ``` blocks in
// an aligned monospace <pre> and gives the card an expand/collapse toggle.
// Deliberately NOT a markdown engine: text stays text (no raw-HTML injection);
// only headings/fences get light styling.

export interface ReportBlock {
  type: "text" | "code";
  text: string;
  lang?: string;
}

// Split a report into text and fenced-code blocks. An unclosed fence swallows
// the rest of the report as code (the honest reading of a truncated report).
export function parseReportBlocks(report: string): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const lines = String(report ?? "").split("\n");
  let buf: string[] = [];
  let code = false;
  let lang = "";
  const flush = () => {
    if (!buf.length) return;
    const text = buf.join("\n");
    if (code || text.trim()) blocks.push(code ? { type: "code", text, lang } : { type: "text", text });
    buf = [];
  };
  for (const line of lines) {
    const fence = line.match(/^\s*```\s*(\S*)\s*$/);
    if (fence) {
      flush();
      if (!code) lang = fence[1] ?? "";
      code = !code;
      continue;
    }
    buf.push(line);
  }
  flush();
  return blocks;
}

function TextBlock({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap text-xs text-muted-foreground">
      {text.split("\n").map((ln, i) => {
        const heading = ln.match(/^(#{1,4})\s+(.*)$/);
        if (heading) {
          return (
            <div key={i} className={cn("mt-1 font-semibold text-foreground", heading[1].length <= 2 ? "text-sm" : "text-xs")}>
              {heading[2]}
            </div>
          );
        }
        return <div key={i}>{ln || " "}</div>;
      })}
    </div>
  );
}

export function ReportView({ report }: { report: string }) {
  const [open, setOpen] = useState(false);
  const blocks = parseReportBlocks(report);
  const hasCode = blocks.some((b) => b.type === "code");
  const long = report.length > 240 || report.split("\n").length > 3 || hasCode;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded bg-muted/50 px-2 py-1 text-left"
        title={long ? "Show the full report" : undefined}
      >
        <p className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{report}</p>
        {long ? (
          <span className="mt-0.5 flex items-center gap-0.5 text-[11px] font-medium text-foreground/70">
            <ChevronRight className="size-3" /> Show full report{hasCode ? " (has wireframes)" : ""}
          </span>
        ) : null}
      </button>
    );
  }
  return (
    <div className="flex w-full flex-col gap-1.5 rounded bg-muted/50 px-2 py-1.5">
      {blocks.map((b, i) =>
        b.type === "code" ? (
          <pre key={i} className="overflow-x-auto rounded-md border border-border bg-background p-2 font-mono text-[11px] leading-snug">
            {b.text}
          </pre>
        ) : (
          <TextBlock key={i} text={b.text} />
        ),
      )}
      <button type="button" onClick={() => setOpen(false)} className="flex items-center gap-0.5 self-start text-[11px] font-medium text-foreground/70">
        <ChevronDown className="size-3" /> Collapse
      </button>
    </div>
  );
}
