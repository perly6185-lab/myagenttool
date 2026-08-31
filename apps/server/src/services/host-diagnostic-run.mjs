import { sshDiagnosticPlanForInput } from "./ssh-host-connector.mjs";

const MAX_RUN_STEPS = 6;

const RUN_PLANS = Object.freeze({
  health: ["system_info", "uptime", "disk_usage", "memory_usage", "failed_services", "network_info"],
  performance: ["uptime", "disk_usage", "memory_usage", "processes", "failed_services"],
  website: ["network_info", "listening_ports", "failed_services", "docker_status", "recent_logs"],
  security: ["ssh_login_audit", "login_sessions", "listening_ports"],
  containers: ["docker_status", "disk_usage", "memory_usage", "recent_logs"],
});

const SEVERITY_RANK = Object.freeze({ healthy: 0, info: 1, unknown: 2, warning: 3, critical: 4 });

const DOMAIN_PATTERNS = Object.freeze([
  ["website", /网站|网页|站点|打不开|访问不了|网关|\b(?:nginx|https?|website)\b|site\s+down|bad\s+gateway/],
  ["security", /异常登录|陌生登录|登录安全|登陆安全|登录不了|登陆不了|无法登录|无法登陆|被入侵|攻击|爆破|封禁|拉黑|安全|\b(?:unauthorized|security|intrusion)\b|brute\s*force|suspicious\s+(?:login|sign-in)|who\s+(?:signed|logged)\s+in|recent\s+sign-ins?|cannot\s+(?:login|sign\s*in)|block\s+(?:an?\s+)?ip/],
  ["containers", /容器|\b(?:docker|containers?)\b/],
  ["storage", /磁盘|硬盘|空间|容量|\b(?:disk|storage)\b/],
  ["memory", /内存|交换空间|\b(?:memory|ram|swap)\b/],
  ["network", /网络|网卡|端口|监听|防火墙|\b(?:network|interface|port|listen|firewall)\b/],
  ["performance", /慢|卡|卡顿|性能|负载高|跑不动|\b(?:cpu|slow|performance|lag)\b|high\s+load/],
  ["service", /服务|\b(?:systemd|service)\b/],
  ["logs", /日志|事件|\b(?:logs?|journal)\b/],
]);

const ACTION_DOMAIN = Object.freeze({
  disk_usage: "storage",
  memory_usage: "memory",
  system_info: "device",
  uptime: "performance",
  login_sessions: "security",
  ssh_login_audit: "security",
  failed_services: "service",
  processes: "performance",
  listening_ports: "network",
  docker_status: "containers",
  service_status: "service",
  recent_logs: "logs",
  network_info: "network",
});

function safeInput(input) {
  const value = String(input ?? "").trim();
  if (!value || value.length > 500 || /(?:&&|\|\||[;`$<>])/.test(value)) return null;
  return value;
}

function requestedChangeForInput(value) {
  if (/清理|删除|删掉|释放空间|清空|cleanup|clean\s*up|delete|remove|free\s+(?:up\s+)?space/.test(value)) return "cleanup_storage";
  if (/重启|重新启动|重新加载|启动服务|restart|reboot|reload|start\s+(?:the\s+)?(?:service|container)/.test(value)) return "restart_service";
  if (/杀掉|结束进程|停止进程|关闭程序|kill|terminate|stop\s+(?:the\s+)?(?:process|app|container)/.test(value)) return "stop_process";
  if (/封禁|拉黑|修改密码|更换密码|修改\s*ssh|关闭\s*ssh|block|ban|change\s+(?:the\s+)?password|disable\s+(?:ssh|user)|modify\s+(?:ssh|firewall)/.test(value)) return "change_access";
  if (/安装|卸载|升级|更新软件|修改配置|install|uninstall|upgrade|change\s+(?:the\s+)?config/.test(value)) return "other_change";
  return "none";
}

function symptomForInput(value) {
  if (/异常登录|陌生登录|失败登录|登陆失败|被入侵|攻击|爆破|unauthorized|intrusion|brute\s*force|suspicious\s+(?:login|sign-in)|failed\s+(?:login|sign-in)/.test(value)) return "suspicious_access";
  if (/磁盘满|硬盘满|空间不足|没空间|容量不足|disk\s+(?:is\s+)?full|out\s+of\s+(?:disk\s+)?space|low\s+storage/.test(value)) return "storage_pressure";
  if (/内存不足|内存满|爆内存|oom|out\s+of\s+memory|low\s+memory|memory\s+pressure/.test(value)) return "memory_pressure";
  if (/负载高|cpu\s*(?:满|高)|high\s+(?:load|cpu)/.test(value)) return "high_load";
  if (/慢|卡|卡顿|跑不动|slow|lag|sluggish/.test(value)) return "slow";
  if (/打不开|访问不了|登录不了|登陆不了|不可用|挂了|宕机|离线|断开|断了|连不上|没反应|无法连接|无法登录|无法登陆|down|offline|unavailable|not\s+(?:working|running|reachable)|cannot\s+(?:open|connect|access|login|sign\s*in)/.test(value)) return "unavailable";
  return "unspecified";
}

function desiredOutcomeFor({ domain, symptom, requestedChange }) {
  if (domain === "security" && symptom === "suspicious_access") return "verify_security";
  if (domain === "storage" && (symptom === "storage_pressure" || requestedChange === "cleanup_storage")) return "free_space";
  if (["slow", "memory_pressure", "high_load"].includes(symptom) || (requestedChange === "stop_process" && ["performance", "memory"].includes(domain))) return "improve_performance";
  if (symptom === "unavailable" || requestedChange === "restart_service") return "restore_availability";
  if (domain === "security") return "verify_security";
  return "understand_state";
}

function goalFor(desiredOutcome) {
  if (desiredOutcome === "verify_security") return "secure";
  if (desiredOutcome === "improve_performance") return "improve";
  if (["free_space", "restore_availability"].includes(desiredOutcome)) return "restore";
  return "inspect";
}

function understandingForInput(value, action = null) {
  const explicitDomain = DOMAIN_PATTERNS.find(([, pattern]) => pattern.test(value))?.[0] ?? null;
  const domain = explicitDomain ?? ACTION_DOMAIN[action] ?? "device";
  const symptom = symptomForInput(value);
  const requestedChange = requestedChangeForInput(value);
  const desiredOutcome = desiredOutcomeFor({ domain, symptom, requestedChange });
  return {
    version: 1,
    goal: goalFor(desiredOutcome),
    domain,
    symptom,
    desiredOutcome,
    requestedChange,
    handling: requestedChange === "none" ? "read_only_diagnosis" : "diagnose_before_change",
    confidence: explicitDomain || symptom !== "unspecified" || action ? "high" : "medium",
  };
}

function requestedServicePlan(value) {
  const serviceName = value.match(/(?:重启|重新启动|重新加载|启动|restart|reload|start)\s+([A-Za-z0-9][A-Za-z0-9_.@:-]{0,63})/i)?.[1];
  if (!serviceName || /^(?:service|container|server|device|machine|系统|服务)$/i.test(serviceName)) return null;
  return { action: "service_status", parameters: { serviceName } };
}

function plan(intent, actions, understanding) {
  return {
    version: 1,
    intent,
    risk: "read_only",
    understanding,
    steps: actions.slice(0, MAX_RUN_STEPS).map((action) => ({ action, parameters: {} })),
  };
}

export function hostDiagnosticRunPlanForInput(input) {
  const source = safeInput(input);
  if (!source) return null;
  const value = source.toLocaleLowerCase();
  const understanding = understandingForInput(value);
  if (/全面|整体|健康|体检|都看|全部|综合|有没有问题|是否正常|health\s*check|overall|everything/.test(value)) {
    return plan("health", RUN_PLANS.health, understanding);
  }
  if (understanding.domain === "website") {
    return plan("website", RUN_PLANS.website, understanding);
  }
  if (understanding.domain === "security") {
    return plan("security", RUN_PLANS.security, understanding);
  }
  if (understanding.domain === "containers") {
    return plan("containers", RUN_PLANS.containers, understanding);
  }
  if (understanding.domain === "service" && understanding.symptom === "unavailable") {
    return plan("targeted", ["failed_services", "recent_logs"], understanding);
  }
  if (["performance", "storage", "memory"].includes(understanding.domain)
    && (understanding.symptom !== "unspecified" || understanding.requestedChange !== "none")) {
    return plan("performance", RUN_PLANS.performance, understanding);
  }

  const single = sshDiagnosticPlanForInput(source) ?? requestedServicePlan(value);
  if (!single) {
    if (understanding.requestedChange !== "none" || understanding.symptom !== "unspecified") return plan("health", RUN_PLANS.health, understanding);
    return null;
  }
  return {
    version: 1,
    intent: "targeted",
    risk: "read_only",
    understanding: understandingForInput(value, single.action),
    steps: [{ action: single.action, parameters: single.parameters ?? {} }],
  };
}

function aggregateSeverity(completed) {
  return completed.reduce((highest, step) => {
    const severity = step.summary?.severity ?? "unknown";
    return SEVERITY_RANK[severity] > SEVERITY_RANK[highest] ? severity : highest;
  }, "healthy");
}

export function buildHostDiagnosticRunSummary(steps) {
  const completed = steps.filter((step) => step.status === "completed" && step.summary);
  const unavailable = steps.length - completed.length;
  const issueCount = completed.filter((step) => ["warning", "critical"].includes(step.summary.severity)).length;
  const unknownCount = completed.filter((step) => step.summary.severity === "unknown").length;
  const highest = aggregateSeverity(completed);
  const facts = [
    { key: "diagnostic_completed_count", value: String(completed.length), severity: completed.length ? "info" : "unknown" },
    { key: "diagnostic_issue_count", value: String(issueCount), severity: issueCount ? highest : "healthy" },
    { key: "diagnostic_unavailable_count", value: String(unavailable), severity: unavailable ? "unknown" : "healthy" },
  ];

  if (!completed.length) {
    return { version: 1, severity: "unknown", finding: "host_diagnostic_incomplete", impact: "host_state_not_confirmed", nextAction: "retry_unavailable_checks", facts };
  }
  if (highest === "critical") {
    return { version: 1, severity: "critical", finding: "host_critical_findings", impact: "host_operation_may_be_affected", nextAction: "review_critical_findings", facts };
  }
  if (highest === "warning") {
    return { version: 1, severity: "warning", finding: "host_warnings_found", impact: "host_attention_recommended", nextAction: "review_warning_findings", facts };
  }
  if (unavailable || unknownCount) {
    return { version: 1, severity: "unknown", finding: "host_diagnostic_partial", impact: "host_state_partially_confirmed", nextAction: "review_unavailable_checks", facts };
  }
  return { version: 1, severity: "healthy", finding: "host_no_obvious_issue", impact: "host_no_obvious_impact", nextAction: "continue_targeted_diagnosis", facts };
}

export function primaryHostDiagnosticAction(steps) {
  const completed = steps.filter((step) => step.status === "completed" && step.summary);
  return completed.sort((left, right) => SEVERITY_RANK[right.summary.severity] - SEVERITY_RANK[left.summary.severity])[0]?.action ?? null;
}
