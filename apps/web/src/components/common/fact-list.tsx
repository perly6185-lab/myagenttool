import { cn } from "@/lib/cn";

export interface Fact {
  term: string;
  value: React.ReactNode;
}

/**
 * Labelled facts. Default is a compact term|value definition list. Pass
 * `columns` (Tailwind grid-cols classes) for a horizontal grid where each fact
 * stacks its label above the value — for wider "overview" cards.
 */
export function FactList({ facts, className, columns }: { facts: Fact[]; className?: string; columns?: string }) {
  if (columns) {
    return (
      <dl className={cn("grid gap-4 text-sm", columns, className)}>
        {facts.map((fact) => (
          <div key={fact.term} className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{fact.term}</dt>
            <dd className="mt-0.5 [overflow-wrap:anywhere] text-foreground">{fact.value}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl className={cn("grid gap-2.5 text-sm", className)}>
      {facts.map((fact) => (
        <div key={fact.term} className="grid grid-cols-[7.5rem_1fr] items-start gap-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {fact.term}
          </dt>
          <dd className="[overflow-wrap:anywhere] text-foreground">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
