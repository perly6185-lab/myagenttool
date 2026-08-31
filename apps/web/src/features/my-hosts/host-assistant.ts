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
  login_sessions: { action: "login_sessions", title: "检查当前交互式登录", titleEn: "Check interactive sign-in sessions", command: "who", explanation: "只读取系统登记的当前交互式会话；MyAgentTool 的短时命令连接通常不会显示在这里。用户名和来源地址只在本次技术证据中显示。", explanationEn: "Reads interactive sessions registered by the system. MyAgentTool's short command connections normally do not appear here. User names and source addresses remain session-only.", check: "系统登记的交互式登录会话", checkEn: "interactive sign-in sessions registered by the system" },
  ssh_login_audit: { action: "ssh_login_audit", title: "检查登录审计", titleEn: "Check SSH sign-in audit", command: "journalctl --no-pager --quiet --since '-24 hours' -u ssh.service -u sshd.service -n 100 -o short-iso", explanation: "只读取最近 24 小时、最多 100 条 SSH 服务日志，不修改或清理日志。用户名和来源地址只在本次技术证据中显示，诊断记录仅保留事件数量。", explanationEn: "Reads up to 100 SSH service log entries from the last 24 hours without changing or clearing logs. User names and source addresses remain session-only; stored diagnostic records contain counts only.", check: "成功、失败、无效账号及认证前异常会话数量", checkEn: "counts of successful, failed, invalid-account, and pre-authentication connection events" },
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
  if (/(?:登录|登陆).*(?:审计|日志|记录|历史|最近|情况|信息|异常|失败|成功|尝试)|(?:审计|日志|记录|历史|最近).*(?:登录|登陆)|ssh\s+(?:login|authentication|auth)\s+(?:audit|log|logs|history)|(?:recent|failed|successful)\s+ssh\s+(?:login|authentication)\s+(?:attempts?|events?)/.test(value)) return PLANS.ssh_login_audit;
  if (/谁在线|当前.*(?:登录|登陆)|(?:登录|登陆).*(?:会话|用户)|who\s+is\s+(?:logged[- ]?in|online)|(?:login|sign-in|signed-in|logged-in|ssh)\s+(?:session|sessions|user|users)|active\s+(?:login|ssh)\s+sessions?/.test(value)) return PLANS.login_sessions;
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
  PLANS.ssh_login_audit,
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
  login_sessions_none: ["未发现系统登记的交互式登录会话", "No system-registered interactive sign-in sessions were found"],
  login_sessions_found: ["系统登记了交互式登录会话", "The system has registered interactive sign-in sessions"],
  ssh_login_audit_no_visible_records: ["没有读取到可见的 SSH 登录审计记录", "No visible SSH sign-in audit records were available"],
  ssh_login_audit_failures_found: ["登录审计中有失败尝试", "Failed sign-in attempts appear in the SSH audit"],
  ssh_login_audit_activity_found: ["登录审计中有成功记录", "Successful sign-ins appear in the SSH audit"],
  ssh_login_audit_no_auth_events: ["SSH 服务日志中没有识别到登录事件", "No sign-in events were recognized in the SSH service logs"],
  process_activity_ready: ["已读取程序占用概况", "Resource-use information is available"],
  listening_ports_ready: ["已读取网络服务概况", "Network-service information is available"],
  containers_running: ["设备上有容器正在运行", "Containers are running on the device"],
  no_running_containers: ["没有发现运行中的容器", "No running containers were found"],
  recent_logs_ready: ["已读取最近系统事件", "Recent system events are available"],
  network_information_ready: ["已读取网络状态", "Network status is available"],
  system_information_ready: ["已读取系统信息", "System information is available"],
  diagnostic_result_empty: ["设备没有返回可判断的结果", "The device returned no result that can be assessed"],
  diagnostic_result_unrecognized: ["暂时无法判断检查结果", "The check result could not be assessed"],
  host_diagnostic_incomplete: ["暂时无法完成这次检查", "This check could not be completed"],
  host_critical_findings: ["发现需要尽快处理的问题", "Problems needing prompt attention were found"],
  host_warnings_found: ["发现需要留意的问题", "Items needing attention were found"],
  host_diagnostic_partial: ["已完成部分检查", "Some checks were completed"],
  host_no_obvious_issue: ["暂未发现明显问题", "No obvious problem was found"],
};

const IMPACTS: Record<string, [string, string]> = {
  no_issue_detected: ["本项检查没有发现会影响当前操作的问题。", "This check found no issue affecting the current operation."],
  file_operations_may_fail: ["上传、保存或发布文件可能失败，已存在文件不会被自动清理。", "Uploading, saving, or publishing files may fail. Existing files were not cleaned up automatically."],
  performance_may_be_affected: ["设备可能变慢，长时间任务也可能更容易超时。", "The device may be slow and long-running tasks may time out more easily."],
  service_may_be_unavailable: ["依赖这个服务的功能可能暂时不可用。", "Features that depend on this service may be unavailable."],
  information_only: ["这是只读信息，不能仅凭这一项判断设备是否健康。", "This is read-only information and does not prove the device is healthy by itself."],
  interactive_sessions_only: ["这里只反映系统登记的交互式会话，不代表没有 SSH 命令连接，也不是历史登录审计。", "This covers only system-registered interactive sessions. It does not prove there are no SSH command connections and is not a historical sign-in audit."],
  audit_visibility_limited: ["可能确实没有记录，也可能当前登录账号无权读取系统审计日志，不能据此判断没有登录行为。", "There may be no records, or the current account may lack access to system audit logs. This does not prove that no sign-ins occurred."],
  login_attempts_need_review: ["失败尝试不等于账号已被入侵，但需要结合时间、账号和来源地址核对。", "Failed attempts do not prove an account was compromised, but their time, account, and source address should be reviewed."],
  login_activity_recorded: ["审计日志记录了成功登录；是否符合预期需要由设备所有者核对。", "The audit records successful sign-ins. The device owner should verify whether they were expected."],
  audit_records_read: ["读取到了 SSH 服务日志，但没有识别到成功或失败登录事件。", "SSH service logs were readable, but no successful or failed sign-in events were recognized."],
  result_unknown: ["本次检查没有修改设备，但目前无法确认相关功能是否正常。", "The check did not change the device, but the related function cannot currently be confirmed."],
  host_state_not_confirmed: ["没有足够结果判断设备状态。", "There were not enough results to assess the device."],
  host_operation_may_be_affected: ["设备上的部分功能可能已经受到影响。", "Some functions on the device may already be affected."],
  host_attention_recommended: ["设备仍可使用，但有项目需要进一步确认。", "The device remains usable, but some items need review."],
  host_state_partially_confirmed: ["已确认部分状态，其他项目因命令或权限限制无法完成。", "Some areas were confirmed; others were limited by command availability or permissions."],
  host_no_obvious_impact: ["本次组合检查没有发现明显影响。", "The combined checks found no obvious impact."],
};

const OWNER_IMPACTS: Record<string, [string, string]> = {
  no_issue_detected: ["这一项目前正常。", "This area looks normal."],
  file_operations_may_fail: ["上传、保存或发布文件可能失败。", "Uploads, saves, or publishing may fail."],
  performance_may_be_affected: ["设备可能变慢，长时间任务也容易超时。", "The device may feel slow and long tasks may time out."],
  information_only: ["这是当前设备的状态信息。", "This is the device's current status."],
  interactive_sessions_only: ["这里显示当前在线用户；历史记录请看“最近登录”。", "This shows who is online now. Open Recent sign-ins for history."],
  audit_visibility_limited: ["当前没有可显示的记录，或者这个登录账号没有读取权限。", "There are no visible records, or this account cannot read them."],
  login_attempts_need_review: ["发现登录失败，建议核对是否来自你本人或已知设备。", "A sign-in failed. Check whether it came from you or a device you recognize."],
  login_activity_recorded: ["设备有成功登录记录，请确认是否符合你的使用情况。", "The device has successful sign-ins. Check that you recognize them."],
  audit_records_read: ["读取到了服务记录，但没有发现成功或失败登录。", "Service records were available, but no successful or failed sign-ins were found."],
  result_unknown: ["目前还不能确认这一项的状态。", "This area could not be confirmed yet."],
  host_state_not_confirmed: ["这次还没有得到足够结果。", "This check did not return enough information yet."],
  host_operation_may_be_affected: ["这台设备有功能可能已经受到影响。", "Some functions on this device may already be affected."],
  host_attention_recommended: ["设备还能使用，但有项目需要你留意。", "The device is still usable, but some items need attention."],
  host_state_partially_confirmed: ["有些项目已经看完，另一些暂时无法查看。", "Some areas were checked, while others are not available yet."],
  host_no_obvious_impact: ["暂时没有看到会影响使用的问题。", "Nothing currently appears to affect normal use."],
};

const NEXT_ACTIONS: Record<string, [string, string]> = {
  no_action_needed: ["本项无需处理；如果问题仍存在，请检查其他相关项目。", "No action is needed for this check. Check another related area if the problem continues."],
  free_device_space: ["先清理设备空间，再核对目标文件后重新开始。", "Free device space, then check the target file before starting again."],
  reduce_memory_pressure: ["先关闭不需要的高占用程序，再重新检查。", "Close unneeded high-usage apps, then check again."],
  inspect_failed_services: ["请让设备管理员检查失败服务；助手不会自动重启。", "Ask the device administrator to inspect failed services. The assistant will not restart them automatically."],
  inspect_service_setup: ["检查服务配置和最近事件，确认原因后再决定是否启动。", "Check the service setup and recent events before deciding whether to start it."],
  review_process_activity: ["如果设备仍然很慢，请展开技术证据确认高占用程序。", "If the device is still slow, open technical evidence to review high-usage apps."],
  review_login_sessions: ["如有不认识的会话，请展开技术证据核对，并联系设备管理员处理；助手不会结束会话。", "If a session is unfamiliar, review the technical evidence and contact the device administrator. The assistant will not end sessions."],
  review_login_audit: ["如需判断最近谁登录过，请改用“检查登录审计”。", "Use “Check SSH sign-in audit” to review recent sign-in activity."],
  check_login_audit_access: ["请让设备管理员确认当前账号能读取 SSH 服务日志，再重新检查。", "Ask the device administrator to confirm that this account can read SSH service logs, then retry."],
  review_login_audit_evidence: ["展开技术证据核对时间、账号和来源地址；助手不会封禁账号或修改 SSH。", "Open technical evidence to review times, accounts, and source addresses. The assistant will not block accounts or change SSH."],
  review_listening_ports: ["与预期服务清单核对；不要仅凭端口数量修改防火墙。", "Compare this with the expected service list. Do not change the firewall based on the count alone."],
  review_recent_events: ["如问题仍在发生，请展开技术证据查看脱敏事件。", "If the problem continues, open technical evidence to review redacted events."],
  review_if_unexpected: ["如果结果与你的预期不符，请查看技术证据或联系设备管理员。", "If this is unexpected, review technical evidence or contact the device administrator."],
  review_technical_evidence: ["查看技术证据，或改用另一项只读检查；不要据此自动修复。", "Review technical evidence or choose another read-only check. Do not repair automatically from this result."],
  retry_unavailable_checks: ["确认设备在线且当前账号有读取权限后，再试一次。", "Confirm the device is online and the account can read system status, then try again."],
  review_critical_findings: ["先查看标记为需要处理的项目，再生成受控修复预案。", "Review items marked as needing attention before creating a governed repair plan."],
  review_warning_findings: ["逐项查看提醒，确认它们是否与当前问题有关。", "Review each warning and confirm whether it relates to the current problem."],
  review_unavailable_checks: ["查看未完成项目；如问题仍在，补充更具体的现象。", "Review unavailable checks and describe the symptom more specifically if it continues."],
  continue_targeted_diagnosis: ["如果问题仍存在，请描述具体表现，助手会继续缩小范围。", "If the problem continues, describe the symptom so the assistant can narrow it down."],
};

const OWNER_NEXT_ACTIONS: Record<string, [string, string]> = {
  no_action_needed: ["目前不用处理；如果还有其他问题，可以继续问我。", "Nothing needs attention right now. Ask me if something else still feels wrong."],
  free_device_space: ["先清理一些设备空间，然后重试刚才的操作。", "Free some device space, then retry the operation."],
  reduce_memory_pressure: ["关闭暂时不用的高占用程序，然后再看一次。", "Close resource-heavy apps you do not need, then check again."],
  inspect_failed_services: ["打开失败服务详情，确认后再决定是否重启。", "Open the failed services, then decide whether any should be restarted."],
  inspect_service_setup: ["继续查看这个服务的配置和最近事件，再决定是否启动。", "Check this service's setup and recent events before starting it."],
  review_process_activity: ["如果设备仍然很慢，看看哪些程序占用最高。", "If the device still feels slow, review the apps using the most resources."],
  review_login_sessions: ["如果看到不认识的登录，查看最近登录记录并及时修改密码。", "If a sign-in is unfamiliar, review recent activity and change the password."],
  review_login_audit: ["打开“最近登录”，查看过去 24 小时的登录记录。", "Open Recent sign-ins to review activity from the last 24 hours."],
  check_login_audit_access: ["当前账号可能看不到登录记录；可以换有权限的账号重新连接。", "This account may not be able to read sign-in records. Reconnect with an account that can."],
  review_login_audit_evidence: ["核对时间、账号和来源；如果有不认识的登录，建议立即修改密码。", "Check the time, account, and source. Change the password if any sign-in is unfamiliar."],
  review_listening_ports: ["看看这些网络服务是否都是你正在使用的。", "Check whether these are all network services you expect to be running."],
  review_recent_events: ["如果问题仍在发生，可以继续告诉我具体表现。", "If the problem is still happening, tell me what you are seeing."],
  review_if_unexpected: ["如果结果不符合预期，可以换一项继续查看。", "If this is unexpected, choose another item to keep checking."],
  review_technical_evidence: ["换一种说法，或者选择其他项目继续查看。", "Try another wording or choose another item to continue."],
  retry_unavailable_checks: ["确认设备在线后再试一次。", "Confirm the device is online, then try again."],
  review_critical_findings: ["先处理下面标记为“需要处理”的项目。", "Start with the items marked as needing attention below."],
  review_warning_findings: ["看看下面哪些提醒与遇到的问题有关。", "Check which warnings below match what you are seeing."],
  review_unavailable_checks: ["可以告诉我更具体的现象，我会换一种方式继续检查。", "Tell me the specific symptom and I can try a more focused check."],
  continue_targeted_diagnosis: ["如果仍有问题，直接告诉我具体表现。", "If something is still wrong, tell me exactly what you are seeing."],
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
  ssh_login_audit_event_count: ["识别到的 SSH 会话", "Recognized SSH sessions"],
  ssh_login_audit_success_count: ["成功登录", "Successful sign-ins"],
  ssh_login_audit_failure_count: ["失败尝试", "Failed attempts"],
  ssh_login_audit_invalid_user_count: ["无效账号尝试", "Invalid-account attempts"],
  ssh_login_audit_preauth_count: ["认证前异常会话", "Pre-authentication connection events"],
  process_count: ["读取的程序数", "Processes inspected"],
  listening_entry_count: ["网络监听项", "Listening entries"],
  running_container_count: ["运行中容器", "Running containers"],
  network_interface_count: ["网卡数量", "Network interfaces"],
  network_interface_up_count: ["可用网卡", "Available interfaces"],
  log_line_count: ["读取的事件数", "Events inspected"],
  diagnostic_completed_count: ["完成检查", "Checks completed"],
  diagnostic_issue_count: ["需要留意", "Items needing attention"],
  diagnostic_unavailable_count: ["未完成检查", "Unavailable checks"],
};

export function hostDiagnosticSummaryCopy(summary: HostDiagnosticSummary, zh: boolean, ownerMode = false) {
  const pick = (table: Record<string, [string, string]>, key: string, fallback: [string, string]) => (table[key] ?? fallback)[zh ? 0 : 1];
  return {
    finding: pick(FINDINGS, summary.finding, ["暂时无法判断检查结果", "The check result could not be assessed"]),
    impact: pick(ownerMode ? { ...IMPACTS, ...OWNER_IMPACTS } : IMPACTS, summary.impact, ownerMode ? ["目前还不能确认这一项的状态。", "This area could not be confirmed yet."] : ["本次检查没有修改设备，但影响仍需确认。", "The check did not change the device, but its impact still needs confirmation."]),
    nextAction: pick(ownerMode ? { ...NEXT_ACTIONS, ...OWNER_NEXT_ACTIONS } : NEXT_ACTIONS, summary.nextAction, ownerMode ? ["可以换一项继续查看，或者打开专业模式了解详情。", "Choose another item or open Professional mode for more detail."] : ["请查看技术证据或联系设备管理员。", "Review technical evidence or contact the device administrator."]),
    facts: summary.facts.map((item) => ({ ...item, label: pick(FACTS, item.key, ["检查结果", "Check result"]) })),
  };
}

export interface HostLoginAuditEvent {
  time: string;
  status: "success" | "failed" | "invalid_user" | "preauth";
  user: string;
  source: string;
}

export function parseHostLoginAuditEvents(output: string, limit = 20): HostLoginAuditEvent[] {
  const events = new Map<string, HostLoginAuditEvent>();
  for (const rawLine of String(output ?? "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const time = line.match(/^(\d{4}-\d{2}-\d{2}[T ][^\s]+)/)?.[1] ?? "—";
    const processId = line.match(/\bsshd(?:-session)?\[(\d+)\]/i)?.[1] ?? `${events.size}`;
    const accepted = line.match(/\bAccepted\s+\S+\s+for\s+(\S+)\s+from\s+(\S+)/i);
    const failed = line.match(/\bFailed\s+\S+\s+for\s+(?:invalid user\s+)?(\S+)\s+from\s+(\S+)/i);
    const invalid = line.match(/:\s+Invalid user\s+(\S+)\s+from\s+(\S+)/i);
    const pamUser = line.match(/\buser=(\S+)/i)?.[1] ?? "";
    const pamSource = line.match(/\brhost=(\S+)/i)?.[1] ?? "";
    const disconnected = line.match(/\b(?:Connection closed|Disconnected)\s+(?:by\s+)?(?:authenticating user\s+(\S+)\s+)?(\S+).*\[preauth\]/i);
    let event: HostLoginAuditEvent | null = null;
    if (accepted) event = { time, status: "success", user: accepted[1], source: accepted[2] };
    else if (invalid) event = { time, status: "invalid_user", user: invalid[1], source: invalid[2] };
    else if (failed) event = { time, status: "failed", user: failed[1], source: failed[2] };
    else if (/authentication failure/i.test(line)) event = { time, status: "failed", user: pamUser, source: pamSource };
    else if (disconnected) event = { time, status: "preauth", user: disconnected[1] ?? "", source: disconnected[2] ?? "" };
    if (!event) continue;
    const existing = events.get(processId);
    if (!existing || event.status === "success" || (event.status === "invalid_user" && existing.status !== "success")) events.set(processId, event);
  }
  return [...events.values()].reverse().slice(0, Math.max(1, Math.min(50, limit)));
}
