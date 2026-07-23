import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { api, type ObservabilityDeletionResult } from "@/lib/api-client";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

export interface SubjectOption {
  id: string;
  label: string;
}

export type SubjectOptionsByScope = Partial<Record<"user" | "team" | "device", SubjectOption[]>>;

// ADR 0018 console affordance: an owner/admin erases a subject's observability
// data. Irreversible, so it goes through a typed confirm. The server enforces the
// owner gate (403) and the shielded-safe erase; this UI just drives it and shows
// the result. `subjects` supplies pick-from-list options per scope; when a scope
// has no known subjects the field falls back to a free-text id input.
export function ObservabilityDeletionCard({ subjects }: { subjects?: SubjectOptionsByScope } = {}) {
  const { t } = useAppTranslation();
  const [scope, setScope] = useState<"user" | "team" | "device">("user");
  const [subjectId, setSubjectId] = useState("");
  const [tier, setTier] = useState("operational");

  const options = subjects?.[scope] ?? [];

  // Switching scope invalidates the current subject: default to the first known
  // subject of the new scope, else clear for the free-text fallback.
  function changeScope(next: "user" | "team" | "device") {
    setScope(next);
    setSubjectId((subjects?.[next] ?? [])[0]?.id ?? "");
    setResult(null);
    setError(null);
  }
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ObservabilityDeletionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmedSubject = subjectId.trim();
  const canSubmit = trimmedSubject.length > 0 && !pending;

  async function run() {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const next = await api.deleteObservabilityData({ scope, subjectId: trimmedSubject, tier });
      setResult(next);
      setConfirmOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setConfirmOpen(false);
    } finally {
      setPending(false);
    }
  }

  const activeCounts = result
    ? Object.entries(result.counts).filter(([, count]) => count > 0)
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("deletion.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("deletion.description")}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">{t("deletion.scope")}</span>
            <Select
              value={scope}
              onChange={(event) => changeScope(event.target.value as "user" | "team" | "device")}
            >
              <option value="user">{t("deletion.user")}</option>
              <option value="team">{t("deletion.team")}</option>
              <option value="device">{t("deletion.device")}</option>
            </Select>
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-muted-foreground">{t("deletion.subject")}</span>
            {options.length > 0 ? (
              <Select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                <option value="">{t("deletion.selectSubject")}</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                value={subjectId}
                onChange={(event) => setSubjectId(event.target.value)}
                placeholder="usr_… / team_… / dev_…"
              />
            )}
          </label>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">{t("deletion.tier")}</span>
            <Select value={tier} onChange={(event) => setTier(event.target.value)}>
              <option value="operational">{t("deletion.operational")}</option>
              <option value="full">{t("deletion.full")}</option>
            </Select>
          </label>
          <Button variant="destructive" disabled={!canSubmit} onClick={() => setConfirmOpen(true)}>
            {t("deletion.delete")}
          </Button>
        </div>

        {result ? (
          <div className="rounded-lg border border-border px-3 py-2 text-sm" role="status">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success">{t("deletion.deleted")}</Badge>
              <span className="text-muted-foreground">
                {result.scope} · {result.subjectId} · {result.tier} · {result.invocationCount}{" "}
                invocation(s)
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {activeCounts.length
                ? activeCounts.map(([key, count]) => `${key}: ${count}`).join(" · ")
                : t("deletion.nothing")}
            </p>
          </div>
        ) : null}
        {error ? (
          <p
            className="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </CardContent>

      <Modal
        open={confirmOpen}
        onClose={() => (pending ? undefined : setConfirmOpen(false))}
        closeDisabled={pending}
        title={t("deletion.confirmTitle")}
        description={t("deletion.confirmDescription")}
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-border px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              {scope} · {trimmedSubject || "—"} · {tier}
            </span>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={pending} onClick={() => setConfirmOpen(false)}>
              {t("deletion.cancel")}
            </Button>
            <Button variant="destructive" disabled={pending || !trimmedSubject} onClick={run}>
              {t(pending ? "deletion.deleting" : "deletion.deletePermanently")}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
