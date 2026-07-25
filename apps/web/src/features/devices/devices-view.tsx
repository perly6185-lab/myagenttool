import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { FactList } from "@/components/common/fact-list";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { readableDeviceStatus, shortTime } from "@/lib/readable-labels";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

export function DevicesView() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const { execute, pending } = useAsyncAction();
  const device = state?.device;
  const current = device?.maxConcurrency ?? 3;
  const [conc, setConc] = useState(current);
  // Keep the input in sync when the server value changes (and after a save).
  useEffect(() => setConc(current), [current]);

  return (
    <div className="flex flex-col gap-4">
    <Card className="max-w-xl">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{device?.name ?? t("devicesPage.noDevice")}</CardTitle>
        {device ? (
          <StatusBadge tone={device.status === "online" ? "success" : "warning"}>
            {readableDeviceStatus(device.status)}
          </StatusBadge>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {device ? (
          <>
            <FactList
              facts={[
                { term: t("devicesPage.platform"), value: `${device.platform} / ${device.architecture}` },
                { term: t("devicesPage.lastSeen"), value: device.lastSeenAt ? shortTime(device.lastSeenAt) : t("devicesPage.notSeen") },
                { term: t("devicesPage.deviceId"), value: device.id },
                {
                  term: t("devicesPage.execution"),
                  value: t("devicesPage.executionHint"),
                },
              ]}
            />
            <Field label={t("devicesPage.maxRuns")}>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={16}
                  value={conc}
                  onChange={(e) => setConc(Math.max(1, Math.min(16, Number(e.target.value) || 1)))}
                  className="w-24"
                  aria-label={t("devicesPage.maxRuns")}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending || conc === current}
                  onClick={() => void execute(() => api.updateDevice({ maxConcurrency: conc }))}
                >
                  {t("devicesPage.save")}
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("devicesPage.concurrencyHint")}
              </p>
            </Field>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("devicesPage.startBridge")}</p>
        )}
      </CardContent>
    </Card>
    </div>
  );
}
