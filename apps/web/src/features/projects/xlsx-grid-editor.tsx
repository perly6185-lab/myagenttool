import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { api } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";

// xlsx grid editor (v0). A worksheet is rendered as an editable table; each cell is
// keyed on its stable A1 address, so editing needs no alignment or ordering — every
// changed cell maps to a surgical, governed `set /<sheet>/<addr>`. A value starting
// with `=` is a formula. "Save all" produces one worktree-scoped `apply.batch`; the
// rest of the sheet is untouched. Enter data past the used range — officecli
// auto-creates the cell. (Row/column insert-delete and formatting are follow-ups.)

const PAD_ROWS = 4; // spare blank rows below the used range for new data
const PAD_COLS = 2;

function columnLabel(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function XlsxGridEditor({ projectId, worktreeId, file, onChanged }: { projectId: string; worktreeId: string; file: string; onChanged?: () => void }) {
  const { data: state } = useConsoleState();
  const [grid, setGrid] = useState<{ sheet: string; sheets: string[]; maxRow: number; maxCol: number } | null>(null);
  const [base, setBase] = useState<Record<string, string>>({}); // addr -> original editable text
  const [edits, setEdits] = useState<Record<string, string>>({}); // addr -> edited text (only touched cells)
  const [loadState, setLoadState] = useState<"loading" | "error" | "done">("loading");
  const [saving, setSaving] = useState(false);
  const [invId, setInvId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sheetRef = useRef<string | undefined>(undefined);

  const load = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    try {
      const r = await api.officecliSheet(projectId, file, worktreeId, sheetRef.current);
      const b: Record<string, string> = {};
      for (const [addr, cell] of Object.entries(r.cells)) b[addr] = cell.edit;
      sheetRef.current = r.sheet;
      setGrid({ sheet: r.sheet, sheets: r.sheets, maxRow: r.maxRow, maxCol: r.maxCol });
      setBase(b);
      setEdits({});
      setLoadState("done");
    } catch {
      setLoadState("error");
    }
  }, [projectId, worktreeId, file]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => Object.keys(edits).some((addr) => edits[addr] !== (base[addr] ?? "")), [edits, base]);
  const valueAt = (addr: string) => (addr in edits ? edits[addr] : base[addr] ?? "");
  const setCell = (addr: string, v: string) => setEdits((e) => ({ ...e, [addr]: v }));

  const save = useCallback(async () => {
    if (!grid) return;
    setSaving(true);
    setError(null);
    try {
      // Send only the cells the user actually touched.
      const cells: Record<string, string> = {};
      for (const addr of Object.keys(edits)) if (edits[addr] !== (base[addr] ?? "")) cells[addr] = edits[addr];
      const { commands } = (await api.officecliSheetOps(projectId, { file, worktree: worktreeId, sheet: grid.sheet, cells })) as {
        commands: Record<string, unknown>[];
      };
      if (!commands.length) {
        setSaving(false);
        await load();
        return;
      }
      const grant = (await api.issueApprovalGrant("wrapper:batch", "app_officecli")) as { token: string };
      const res = (await api.invokeCapability("app.app_officecli.apply.batch", {
        projectId,
        worktreeId,
        file,
        commands,
        approvalToken: grant.token,
      } as unknown as Record<string, string>)) as { invocationId?: string };
      if (res?.invocationId) setInvId(res.invocationId);
      else throw new Error("The edit was not accepted.");
    } catch (e) {
      setSaving(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [grid, edits, base, projectId, worktreeId, file, load]);

  useEffect(() => {
    if (!invId) return;
    const inv = (state?.invocations ?? []).find((i) => i.id === invId);
    if (!inv?.status) return;
    if (inv.status === "succeeded") {
      setInvId(null);
      setSaving(false);
      void load();
      onChanged?.();
    } else if (inv.status === "failed" || inv.status === "rejected") {
      setInvId(null);
      setSaving(false);
      setError("The edit was refused (approval, worktree, or an invalid value).");
    }
  }, [state?.invocations, invId, load, onChanged]);

  if (loadState === "loading") {
    return <span className="flex items-center gap-1 px-2 py-6 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> loading sheet…</span>;
  }
  if (loadState === "error" || !grid) {
    return <span className="px-2 py-6 text-xs text-red-600 dark:text-red-400">Could not read the sheet — it may not render, or officecli is not installed.</span>;
  }

  const rowCount = Math.max(grid.maxRow, 1) + PAD_ROWS;
  const colCount = Math.max(grid.maxCol, 1) + PAD_COLS;
  const cols = Array.from({ length: colCount }, (_, i) => i + 1);
  const rows = Array.from({ length: rowCount }, (_, i) => i + 1);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          Sheet <span className="font-mono">{grid.sheet}</span> — edit cells; start with <code className="font-mono">=</code> for a formula. One governed batch; the rest of the sheet is untouched.
        </span>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void save()}
          className="flex shrink-0 items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium disabled:opacity-40"
        >
          {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
          {saving ? "Saving…" : "Save all"}
        </button>
      </div>
      {error ? <p className="px-2 pt-1 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border border-border bg-muted px-1 text-[10px] text-muted-foreground" />
              {cols.map((c) => (
                <th key={c} className="min-w-[6rem] border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{columnLabel(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row}>
                <td className="sticky left-0 z-10 border border-border bg-muted px-2 text-center text-[10px] text-muted-foreground">{row}</td>
                {cols.map((col) => {
                  const addr = `${columnLabel(col)}${row}`;
                  const changed = addr in edits && edits[addr] !== (base[addr] ?? "");
                  return (
                    <td key={col} className="border border-border p-0">
                      <input
                        value={valueAt(addr)}
                        onChange={(e) => setCell(addr, e.target.value)}
                        className={`w-full bg-background px-2 py-1 text-sm outline-none focus:bg-accent/40 ${changed ? "bg-amber-50 dark:bg-amber-950/40" : ""}`}
                        spellCheck={false}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
