import type { HostDiagnosticAction, HostDiagnosticParameters, HostDiagnosticSummary } from "./host-types";

export interface HostDiagnosticPlan {
  action: HostDiagnosticAction;
  title: string;
  titleEn: string;
  command: string;
  explanation: string;
  explanationEn: string;
  check: string;
  checkEn: string;
  parameters?: HostDiagnosticParameters;
}

const PLANS: Record<HostDiagnosticAction, HostDiagnosticPlan> = {
  disk_usage: { action: "disk_usage", title: "检查磁盘空间", titleEn: "Check device space", command: "df -h", explanation: "只读取空间使用比例，不修改或清理文件。", explanationEn: "Reads storage usage only. It does not change or clean up files.", check: "剩余空间和最高使用比例", checkEn: "remaining space and the highest usage level" },
  memory_usage: { action: "memory_usage", title: "检查内存使用", titleEn: "Check memory use", command: "free -h", explanation: "只读取内存使用情况，不结束程序或修改系统。", explanationEn: "Reads memory use only. It does not stop apps or change the system.", check: "可用内存和内存压力", checkEn: "available memory and memory pressure" },
  system_info: { action: "system_info", title: "检查系统信息", titleEn: "Check system information", command: "uname -a", explanation: "只读取系统标识，不安装或配置软件。", explanationEn: "Reads system identity only. It does not install or configure software.", check: "操作系统和内核信息", checkEn: "operating-system and kernel information" },
  uptime: { action: "uptime", title: "检查运行状态", titleEn: "Check running status", command: "uptime", explanation: "只读取在线时长和负载，不修改系统。", explanationEn: "Reads uptime and load only. It does not change the system.", check: "在线时长和当前负载", checkEn: "uptime and current load" },
  login_sessions: { action: "login_sessions", title: "检查登录情况", titleEn: "Check sign-in sessions", command: "who", explanation: "只读取当前登录会话，不登录其他账号、不结束会话。用户名和来源地址只在本次技术证据中显示，不写入诊断记录。", explanationEn: "Reads current sign-in sessions only. It does not sign in as another user or end sessions. User names and source addresses appear only in this session's technical evidence and are not written to diagnostic records.", check: "当前登录会话数和登录用户数", checkEn: "current sign-in session and user counts" },
  failed_services: { action: "failed_services", title: "检查失败服务", titleEn: "Check failed services", command: "systemctl --failed --no-pager", explanation: "只读取失败服务数量，不重启或修复服务。", explanationEn: "Reads failed-service status only. It does not restart or repair services.", check: "是否存在失败的系统服务", checkEn: "whether any system services have failed" },
  processes: { action: "processes", title: "检查程序占用", titleEn: "Check resource-heavy apps", command: "ps -eo pid,comm,%cpu,%mem --sort=-%cpu | head -n 15", explanation: "只读取高占用程序，不结束或修改进程。", explanationEn: "Reads high-usage processes only. It does not stop or change them.", check: "当前高占用程序概况", checkEn: "a summary of high-usage processes" },
  listening_ports: { action: "listening_ports", title: "检查网络服务", titleEn: "Check network services", command: "ss -lntup", explanation: "只读取监听状态，不修改防火墙或网络配置。", explanationEn: "Reads listening services only. It does not change firewall or network settings.", check: "当前提供网络连接的服务数量", checkEn: "how many services are accepting network connections" },
  docker_status: { action: "docker_status", title: "检查容器状态", titleEn: "Check containers", command: "docker ps --format '{{.Names}}\\t{{.Status}}'", explanation: "只读取运行中容器，不启动、停止或重启容器。", explanationEn: "Reads running containers only. It does not start, stop, or restart them.", check: "正在运行的容器数量", checkEn: "the number of running containers" },
  recent_logs: { action: "recent_logs", title: "检查最近事件", titleEn: "Check recent events", command: "journalctl -n 40 --no-pager", explanation: "只读取有限且脱敏的最近事件，不修改日志。", explanationEn: "Reads a bounded, redacted set of recent events. It does not change logs.", check: "最近系统事件是否需要进一步查看", checkEn: "whether recent system events need review" },
  network_info: { action: "network_info", title: "检查网络状态", titleEn: "Check network status", command: "ip -brief address", explanation: "只读取网卡状态，不修改网络配置。", explanationEn: "Reads network-interface status only. It does not change network settings.", check: "网卡数量和可用状态", checkEn: "network-interface count and availability" },
  service_status: { action: "service_status", title: "检查指定服务", titleEn: "Check a service", command: "", explanation: "只读取指定服务状态，不启动、停止或重启服务。", explanationEn: "Reads one service status only. It does not start, stop, or restart it.", check: "指定服务是否正在运行", checkEn: "whether the selected service is running" },
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
  if (/(?:&&|\|\||[;`$<>])/.test(value)) return null;
  if (/磁盘|硬盘|空间|容量|disk|storage/.test(value)) return PLANS.disk_usage;
  if (/内存|memory|ram|交换/.test(value)) return PLANS.memory_usage;
  if (/登录|登陆|谁在线|who\s+is\s+(?:logged[- ]?in|online)|(?:login|sign-in|signed-in|logged-in|ssh)\s+(?:status|session|sessions|user|users)|active\s+(?:login|ssh)\s+sessions?/.test(value)) return PLANS.login_sessions;
  if (/日志|事件|log|journal/.test(value)) return PLANS.recent_logs;
  if (/网络|网卡|地址|network|interface/.test(value)) return PLANS.network_info;
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
  return null;
}

export const HOST_DIAGNOSTIC_QUICK_ACTIONS = [
  PLANS.disk_usage,
  PLANS.memory_usage,
  PLANS.system_info,
  PLANS.uptime,
  PLANS.login_sessions,
  PLANS.processes,
  PLANS.listening_ports,
  PLANS.docker_status,
  PLANS.network_info,
] as const;

export function hostDiagnosticPlanCopy(plan: HostDiagnosticPlan, zh: boolean) {
  return {
    title: zh ? plan.title : plan.titleEn,
    explanation: zh ? plan.explanation : plan.explanationEn,
    check: zh ? plan.check : plan.checkEn,
  };
}

const FINDINGS: Record<string, [string, string]> = {
  disk_capacity_healthy: ["设备空间充足", "Device space looks sufficient"],
  disk_capacity_low: ["设备空间已经不多", "Device space is running low"],
  disk_capacity_critical: ["设备空间严重不足", "Device space is critically low"],
  memory_capacity_healthy: ["可用内存充足", "Available memory looks sufficient"],
  memory_capacity_low: ["可用内存已经不多", "Available memory is running low"],
  memory_capacity_critical: ["设备内存压力很高", "The device is under high memory pressure"],
  failed_services_none: ["没有发现失败的系统服务", "No failed system services were found"],
  failed_services_found: ["发现失败的系统服务", "Failed system services were found"],
  service_running: ["服务正在运行", "The service is running"],
  service_failed: ["服务运行失败", "The service has failed"],
  service_not_running: ["服务当前没有运行", "The service is not running"],
  service_state_unknown: ["无法确认服务状态", "The service state could not be confirmed"],
  uptime_information_ready: ["已读取设备运行状态", "Device running status is available"],
  login_sessions_none: ["没有发现活动登录会话", "No active sign-in sessions were found"],
  login_sessions_found: ["设备当前有活动登录会话", "The device has active sign-in sessions"],
  process_activity_ready: ["已读取程序占用概况", "Resource-use information is available"],
  listening_ports_ready: ["已读取网络服务概况", "Network-service information is available"],
  containers_running: ["设备上有容器正在运行", "Containers are running on the device"],
  no_running_containers: ["没有发现运行中的容器", "No running containers were found"],
  recent_logs_ready: ["已读取最近系统事件", "Recent system events are available"],
  network_information_ready: ["已读取网络状态", "Network status is available"],
  system_information_ready: ["已读取系统信息", "System information is available"],
  diagnostic_result_empty: ["设备没有返回可判断的结果", "The device returned no result that can be assessed"],
  diagnostic_result_unrecognized: ["暂时无法判断检查结果", "The check result could not be assessed"],
};

const IMPACTS: Record<string, [string, string]> = {
  no_issue_detected: ["本项检查没有发现会影响当前操作的问题。", "This check found no issue affecting the current operation."],
  file_operations_may_fail: ["上传、保存或发布文件可能失败，已存在文件不会被自动清理。", "Uploading, saving, or publishing files may fail. Existing files were not cleaned up automatically."],
  performance_may_be_affected: ["设备可能变慢，长时间任务也可能更容易超时。", "The device may be slow and long-running tasks may time out more easily."],
  service_may_be_unavailable: ["依赖这个服务的功能可能暂时不可用。", "Features that depend on this service may be unavailable."],
  information_only: ["这是只读信息，不能仅凭这一项判断设备是否健康。", "This is read-only information and does not prove the device is healthy by itself."],
  result_unknown: ["本次检查没有修改设备，但目前无法确认相关功能是否正常。", "The check did not change the device, but the related function cannot currently be confirmed."],
};

const NEXT_ACTIONS: Record<string, [string, string]> = {
  no_action_needed: ["本项无需处理；如果问题仍存在，请检查其他相关项目。", "No action is needed for this check. Check another related area if the problem continues."],
  free_device_space: ["先清理设备空间，再核对目标文件后重新开始。", "Free device space, then check the target file before starting again."],
  reduce_memory_pressure: ["先关闭不需要的高占用程序，再重新检查。", "Close unneeded high-usage apps, then check again."],
  inspect_failed_services: ["请让设备管理员检查失败服务；助手不会自动重启。", "Ask the device administrator to inspect failed services. The assistant will not restart them automatically."],
  inspect_service_setup: ["检查服务配置和最近事件，确认原因后再决定是否启动。", "Check the service setup and recent events before deciding whether to start it."],
  review_process_activity: ["如果设备仍然很慢，请展开技术证据确认高占用程序。", "If the device is still slow, open technical evidence to review high-usage apps."],
  review_login_sessions: ["如有不认识的会话，请展开技术证据核对，并联系设备管理员处理；助手不会结束会话。", "If a session is unfamiliar, review the technical evidence and contact the device administrator. The assistant will not end sessions."],
  review_listening_ports: ["与预期服务清单核对；不要仅凭端口数量修改防火墙。", "Compare this with the expected service list. Do not change the firewall based on the count alone."],
  review_recent_events: ["如问题仍在发生，请展开技术证据查看脱敏事件。", "If the problem continues, open technical evidence to review redacted events."],
  review_if_unexpected: ["如果结果与你的预期不符，请查看技术证据或联系设备管理员。", "If this is unexpected, review technical evidence or contact the device administrator."],
  review_technical_evidence: ["查看技术证据，或改用另一项只读检查；不要据此自动修复。", "Review technical evidence or choose another read-only check. Do not repair automatically from this result."],
};

const FACTS: Record<string, [string, string]> = {
  disk_used_percent: ["最高空间使用", "Highest storage use"],
  disk_available: ["可用空间", "Available storage"],
  memory_used_percent: ["内存使用", "Memory use"],
  memory_available: ["可用内存", "Available memory"],
  failed_service_count: ["失败服务", "Failed services"],
  service_state: ["服务状态", "Service state"],
  load_average: ["系统负载", "System load"],
  login_session_count: ["登录会话", "Sign-in sessions"],
  login_user_count: ["登录用户", "Signed-in users"],
  process_count: ["读取的程序数", "Processes inspected"],
  listening_entry_count: ["网络监听项", "Listening entries"],
  running_container_count: ["运行中容器", "Running containers"],
  network_interface_count: ["网卡数量", "Network interfaces"],
  network_interface_up_count: ["可用网卡", "Available interfaces"],
  log_line_count: ["读取的事件数", "Events inspected"],
};

export function hostDiagnosticSummaryCopy(summary: HostDiagnosticSummary, zh: boolean) {
  const pick = (table: Record<string, [string, string]>, key: string, fallback: [string, string]) => (table[key] ?? fallback)[zh ? 0 : 1];
  return {
    finding: pick(FINDINGS, summary.finding, ["暂时无法判断检查结果", "The check result could not be assessed"]),
    impact: pick(IMPACTS, summary.impact, ["本次检查没有修改设备，但影响仍需确认。", "The check did not change the device, but its impact still needs confirmation."]),
    nextAction: pick(NEXT_ACTIONS, summary.nextAction, ["请查看技术证据或联系设备管理员。", "Review technical evidence or contact the device administrator."]),
    facts: summary.facts.map((item) => ({ ...item, label: pick(FACTS, item.key, ["检查结果", "Check result"]) })),
  };
}
