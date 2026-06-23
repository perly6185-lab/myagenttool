import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { FactList } from "@/components/common/fact-list";
import { useConsoleState } from "@/data/use-console-state";
import { readableDeviceStatus, shortTime } from "@/lib/readable-labels";

export function DevicesView() {
  const { data: state } = useConsoleState();
  const device = state?.device;

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
      <CardContent>
        {device ? (
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
        ) : (
          <p className="text-sm text-muted-foreground">Start Desktop Bridge to register a device.</p>
        )}
      </CardContent>
    </Card>
  );
}
