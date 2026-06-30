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

export function DevicesView() {
  const { data: state } = useConsoleState();
  const { execute, pending } = useAsyncAction();
  const device = state?.device;
  const current = device?.maxConcurrency ?? 3;
  const [conc, setConc] = useState(current);
  // Keep the input in sync when the server value changes (and after a save).
  useEffect(() => setConc(current), [current]);

  return (
    <Card className="max-w-xl">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{device?.name ?? "No device"}</CardTitle>
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
                { term: "Platform", value: `${device.platform} / ${device.architecture}` },
                { term: "Last seen", value: device.lastSeenAt ? shortTime(device.lastSeenAt) : "Not seen yet" },
                { term: "Device ID", value: device.id },
                {
                  term: "Execution",
                  value: "The local bridge owns final execution; the cloud only requests work.",
                },
              ]}
            />
            <Field label="Max concurrent runs">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={16}
                  value={conc}
                  onChange={(e) => setConc(Math.max(1, Math.min(16, Number(e.target.value) || 1)))}
                  className="w-24"
                  aria-label="Max concurrent runs"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending || conc === current}
                  onClick={() => void execute(() => api.updateDevice({ maxConcurrency: conc }))}
                >
                  Save
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                How many tasks this machine runs at once across distinct worktrees (1–16). The same worktree always runs one at a time.
              </p>
            </Field>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Start Desktop Bridge to register a device.</p>
        )}
      </CardContent>
    </Card>
  );
}
