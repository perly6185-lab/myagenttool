import { cn } from "@/lib/cn";

export interface Fact {
  term: string;
  value: React.ReactNode;
}

/** Compact definition list used across context cards. */
export function FactList({ facts, className }: { facts: Fact[]; className?: string }) {
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
