import type { HostDiagnosticAction, HostDiagnosticParameters } from "./host-types";

export interface HostDiagnosticPlan {
  action: HostDiagnosticAction;
  title: string;
  command: string;
  explanation: string;
  parameters?: HostDiagnosticParameters;
}

const PLANS: Record<HostDiagnosticAction, HostDiagnosticPlan> = {
  disk_usage: { action: "disk_usage", title: "查看磁盘空间", command: "df -h", explanation: "只读取各挂载点的使用情况，不修改文件。" },
  memory_usage: { action: "memory_usage", title: "查看内存使用", command: "free -h", explanation: "只读取内存和交换分区使用情况，不修改系统。" },
  system_info: { action: "system_info", title: "查看系统信息", command: "uname -a", explanation: "只读取内核和系统标识，不执行安装或配置。" },
  uptime: { action: "uptime", title: "查看运行时间", command: "uptime", explanation: "只读取主机在线时长和负载，不修改系统。" },
  failed_services: { action: "failed_services", title: "查看失败服务", command: "systemctl --failed --no-pager", explanation: "只读取 systemd 失败服务列表，不重启或修复服务。" },
  processes: { action: "processes", title: "查看高占用进程", command: "ps -eo pid,comm,%cpu,%mem --sort=-%cpu | head -n 15", explanation: "只读取前 14 个高 CPU 进程，不结束或修改进程。" },
  listening_ports: { action: "listening_ports", title: "查看监听端口", command: "ss -lntup", explanation: "只读取当前监听端口，不修改防火墙或网络配置。" },
  docker_status: { action: "docker_status", title: "查看容器状态", command: "docker ps --format '{{.Names}}\\t{{.Status}}'", explanation: "只读取正在运行的 Docker 容器，不启动、停止或重启容器。" },
  recent_logs: { action: "recent_logs", title: "查看最近日志", command: "journalctl -n 40 --no-pager", explanation: "只读取最近 40 条系统日志，结果会限制长度并在界面展示。" },
  network_info: { action: "network_info", title: "查看网络信息", command: "ip -brief address", explanation: "只读取主机网卡和地址，不修改网络配置。" },
  service_status: { action: "service_status", title: "查看服务状态", command: "", explanation: "只读取指定 systemd 服务状态，不启动、停止或重启服务。" },
};

export function hostDiagnosticPlan(action: HostDiagnosticAction, parameters: HostDiagnosticParameters = {}): HostDiagnosticPlan {
  const plan = PLANS[action];
  if (action !== "service_status") return plan;
  const serviceName = parameters.serviceName ?? "";
  return { ...plan, parameters, command: serviceName ? `systemctl status --no-pager --lines=30 ${serviceName} || true` : "" };
}

export function suggestHostDiagnostic(input: string): HostDiagnosticPlan | null {
  const value = String(input ?? "").trim().toLocaleLowerCase();
  if (!value) return null;
  if (/磁盘|硬盘|空间|容量|disk|storage/.test(value)) return PLANS.disk_usage;
  if (/内存|memory|ram|交换/.test(value)) return PLANS.memory_usage;
  if (/系统|内核|版本|system|kernel|os/.test(value)) return PLANS.system_info;
  if (/服务状态|服务运行|service status|service health/.test(value)) {
    const serviceName = value.match(/(?:^|\s)([a-z0-9][a-z0-9_.@:-]{0,63})\s*(?:服务|service)/i)?.[1]
      ?? value.match(/(?:服务|service)\s+([a-z0-9][a-z0-9_.@:-]{0,63})/i)?.[1];
    return serviceName ? hostDiagnosticPlan("service_status", { serviceName }) : null;
  }
  if (/运行|在线|uptime|负载|load/.test(value)) return PLANS.uptime;
  if (/失败服务|服务失败|systemd|failed service/.test(value)) return PLANS.failed_services;
  if (/进程|process|cpu|占用/.test(value)) return PLANS.processes;
  if (/端口|监听|port|listen/.test(value)) return PLANS.listening_ports;
  if (/docker|容器|container/.test(value)) return PLANS.docker_status;
  if (/日志|log/.test(value)) return PLANS.recent_logs;
  if (/网络|网卡|地址|network|interface/.test(value)) return PLANS.network_info;
  return null;
}

export const HOST_DIAGNOSTIC_QUICK_ACTIONS = [
  PLANS.disk_usage,
  PLANS.memory_usage,
  PLANS.system_info,
  PLANS.uptime,
  PLANS.processes,
  PLANS.listening_ports,
  PLANS.docker_status,
  PLANS.network_info,
] as const;
