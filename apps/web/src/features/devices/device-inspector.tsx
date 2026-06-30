import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { FactList } from "@/components/common/fact-list";
import { useConsoleState } from "@/data/use-console-state";
import { readableDeviceStatus, shortTime } from "@/lib/readable-labels";

export function DeviceInspector() {
  const { data: state } = useConsoleState();
  const device = state?.device;
  if (!device) return null;

  const tone = device.status === "online" ? "success" : "warning";
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{device.name}</CardTitle>
        <StatusBadge tone={tone}>{readableDeviceStatus(device.status)}</StatusBadge>
      </CardHeader>
      <CardContent>
        <FactList
          facts={[
            { term: "Platform", value: `${device.platform} / ${device.architecture}` },
            { term: "Last seen", value: device.lastSeenAt ? shortTime(device.lastSeenAt) : "Not seen yet" },
            { term: "Device ID", value: device.id },
          ]}
        />
      </CardContent>
    </Card>
  );
}
