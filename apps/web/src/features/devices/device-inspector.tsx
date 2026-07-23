import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { FactList } from "@/components/common/fact-list";
import { useConsoleState } from "@/data/use-console-state";
import { readableDeviceStatus, shortTime } from "@/lib/readable-labels";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

export function DeviceInspector() {
  const { t } = useAppTranslation();
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
            { term: t("devicesPage.platform"), value: `${device.platform} / ${device.architecture}` },
            { term: t("devicesPage.lastSeen"), value: device.lastSeenAt ? shortTime(device.lastSeenAt) : t("devicesPage.notSeen") },
            { term: t("devicesPage.deviceId"), value: device.id },
          ]}
        />
      </CardContent>
    </Card>
  );
}
