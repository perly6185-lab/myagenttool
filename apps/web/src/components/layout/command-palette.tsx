import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, CornerDownLeft } from "lucide-react";
import { SECTIONS, SECTION_GROUPS } from "@/app/sections";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";

// ⌘K / Ctrl-K command palette: jump to any of the console's sections from
// anywhere. Filters by label / blurb / group; arrow keys + Enter to navigate,
// Esc or backdrop to close. Companion to the grouped nav — the fast path.
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const setSection = useUiStore((s) => s.setSection);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const pointerRef = useRef({ x: -1, y: -1 });

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter((s) => s.label.toLowerCase().includes(q) || s.blurb.toLowerCase().includes(q) || s.group.includes(q));
  }, [query]);

  // Mirror results/active into refs so the window key handler can read the
  // latest without re-subscribing on every keystroke.
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const activeRef = useRef(active);
  activeRef.current = active;

  const selectAt = useCallback(
    (i: number) => {
      const item = resultsRef.current[i];
      if (!item) return;
      setSection(item.key);
      setOpen(false);
    },
    [setSection],
  );

  // Global toggle — Cmd/Ctrl-K only. Exclude Shift/Alt chords (e.g. Ctrl+Shift+K
  // is the Firefox console) and ignore auto-repeat so holding the combo doesn't
  // flicker the palette open/closed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && !e.repeat && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // While open, drive navigation from a window listener so the keys work no
  // matter what inside the dialog holds focus (a result row, the input, the
  // backdrop) — binding only to the input left Esc/arrows dead after one Tab.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, resultsRef.current.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        selectAt(activeRef.current);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, selectAt]);

  // Focus the input on open; restore focus to the pre-open element on close so a
  // keyboard user isn't dumped back on <body>.
  useEffect(() => {
    if (open) {
      restoreFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
      setQuery("");
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    restoreFocusRef.current?.focus?.();
  }, [open]);

  // A fresh query means a fresh result set — highlight its top match. Without
  // this, prior arrow-nav "sticks" and Enter opens a stale mid-list row.
  useEffect(() => {
    setActive(0);
  }, [query]);

  // Scroll the active row into view as arrow keys move it.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const activeId = results[active] ? `cmdk-opt-${results[active].key}` : undefined;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a section…"
            aria-label="Search sections"
            role="combobox"
            aria-expanded
            aria-controls="cmdk-list"
            aria-activedescendant={activeId}
            className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">esc</kbd>
        </div>
        <div id="cmdk-list" ref={listRef} role="listbox" aria-label="Sections" className="max-h-[52vh] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No section matches “{query}”.</p>
          ) : (
            SECTION_GROUPS.map((grp) => {
              const items = results.filter((s) => s.group === grp.key);
              if (!items.length) return null;
              return (
                <div key={grp.key}>
                  <p className="px-2.5 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">{grp.label}</p>
                  {items.map((item) => {
                    const idx = results.indexOf(item);
                    const on = idx === active;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.key}
                        id={`cmdk-opt-${item.key}`}
                        type="button"
                        role="option"
                        aria-selected={on}
                        tabIndex={-1}
                        data-active={on || undefined}
                        onMouseMove={(e) => {
                          // Only react to a real pointer move. scrollIntoView (arrow-key
                          // nav) fires a synthetic mousemove at the SAME coordinates over
                          // whatever row slid under a resting cursor — honoring it would
                          // yank the highlight away from the keyboard.
                          if (e.clientX === pointerRef.current.x && e.clientY === pointerRef.current.y) return;
                          pointerRef.current = { x: e.clientX, y: e.clientY };
                          setActive(idx);
                        }}
                        onClick={() => selectAt(idx)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm",
                          on ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                        )}
                      >
                        <Icon className="size-4 shrink-0 opacity-80" />
                        <span className="font-medium text-foreground">{item.label}</span>
                        <span className="truncate text-xs text-muted-foreground">{item.blurb}</span>
                        {on ? <CornerDownLeft className="ml-auto size-3.5 shrink-0 text-muted-foreground" /> : null}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          <span><kbd className="rounded border border-border px-1">↑↓</kbd> navigate</span>
          <span><kbd className="rounded border border-border px-1">↵</kbd> open</span>
          <span className="ml-auto"><kbd className="rounded border border-border px-1">⌘K</kbd> toggle</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
