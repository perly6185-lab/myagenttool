import type { RefusalRow } from "@/lib/console-state";

// Refusal model Phase 3 (#761): a REFUSAL is a normal reply, not an error.
// `failed` = the device tried and could not finish. `refused` = the device
// declined to try. These helpers keep that distinction and never classify a
// refusal as an incident — no danger tone, no failure vocabulary.

export type RefusalCategory = RefusalRow["category"];

const CATEGORY_ORDER: RefusalCategory[] = ["not_granted", "policy", "state", "human"];

const CATEGORY_LABEL: Record<RefusalCategory, string> = {
  not_granted: "Not granted",
  policy: "Policy",
  state: "State",
  human: "Human decision",
};

const CATEGORY_HINT: Record<RefusalCategory, string> = {
  not_granted: "The requester holds no grant for the capability.",
  policy: "A policy rule forbids it — the request must change to succeed.",
  state: "The subject is not in a state where the action is valid; retry may help once it changes.",
  human: "A person declined. Only a human can overturn it.",
};

export function readableRefusalCategory(category: string): string {
  return CATEGORY_LABEL[category as RefusalCategory] ?? category;
}

export function refusalCategoryHint(category: string): string {
  return CATEGORY_HINT[category as RefusalCategory] ?? "";
}

/** A refusal code like `cwd_outside_approved_root` → "Cwd outside approved root". */
export function readableRefusalCode(code: string): string {
  if (!code) return "";
  const spaced = code.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Who, if anyone, can overturn the veto — for the appeal line. */
export function readableAppealTo(appealTo: string | null): string | null {
  if (!appealTo) return null;
  if (appealTo === "device_owner") return "the device owner";
  return appealTo.replace(/_/g, " ");
}

export interface RefusalCodeGroup {
  code: string;
  label: string;
  refusals: RefusalRow[];
}

export interface RefusalCategoryGroup {
  category: RefusalCategory;
  label: string;
  hint: string;
  count: number;
  codes: RefusalCodeGroup[];
}

/**
 * Group refusals by category (in evaluation order) then by code, newest-first
 * within each code. Answers "what did this machine refuse, and why?" at a glance.
 */
export function groupRefusals(refusals: RefusalRow[]): RefusalCategoryGroup[] {
  const byCategory = new Map<RefusalCategory, Map<string, RefusalRow[]>>();
  for (const refusal of refusals ?? []) {
    const category = (CATEGORY_ORDER.includes(refusal.category) ? refusal.category : "policy") as RefusalCategory;
    if (!byCategory.has(category)) byCategory.set(category, new Map());
    const codes = byCategory.get(category)!;
    if (!codes.has(refusal.code)) codes.set(refusal.code, []);
    codes.get(refusal.code)!.push(refusal);
  }
  const groups: RefusalCategoryGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const codes = byCategory.get(category);
    if (!codes) continue;
    const codeGroups: RefusalCodeGroup[] = [];
    let count = 0;
    for (const [code, rows] of codes) {
      const sorted = [...rows].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
      count += sorted.length;
      codeGroups.push({ code, label: readableRefusalCode(code), refusals: sorted });
    }
    // Most-used code first within a category.
    codeGroups.sort((a, b) => b.refusals.length - a.refusals.length);
    groups.push({
      category,
      label: CATEGORY_LABEL[category],
      hint: CATEGORY_HINT[category],
      count,
      codes: codeGroups,
    });
  }
  return groups;
}

/** Whether a retry could ever help — drives the "retry after" affordance. */
export function refusalRetryHint(refusal: RefusalRow): string | null {
  if (!refusal.retryAfter) return null;
  return refusal.retryAfter;
}
