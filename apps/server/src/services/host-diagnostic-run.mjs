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

function safeInput(input) {
  const value = String(input ?? "").trim();
  if (!value || value.length > 500 || /(?:&&|\|\||[;`$<>])/.test(value)) return null;
  return value;
}

function plan(intent, actions) {
  return {
    version: 1,
    intent,
    risk: "read_only",
    steps: actions.slice(0, MAX_RUN_STEPS).map((action) => ({ action, parameters: {} })),
  };
}

export function hostDiagnosticRunPlanForInput(input) {
  const source = safeInput(input);
  if (!source) return null;
  const value = source.toLocaleLowerCase();
  if (/全面|整体|健康|体检|都看|全部|综合|有没有问题|是否正常|health\s*check|overall|everything/.test(value)) {
    return plan("health", RUN_PLANS.health);
  }
  if (/网站|网页|打不开|访问不了|服务不可用|网关|nginx|http|https|website|site\s+down|unavailable|bad\s+gateway/.test(value)) {
    return plan("website", RUN_PLANS.website);
  }
  if (/慢|卡|卡顿|性能|负载高|cpu|内存不足|跑不动|slow|performance|high\s+load|lag/.test(value)) {
    return plan("performance", RUN_PLANS.performance);
  }
  if (/异常登录|陌生登录|登录安全|被入侵|攻击|爆破|安全|unauthorized|security|intrusion|brute\s*force|suspicious\s+(?:login|sign-in)/.test(value)) {
    return plan("security", RUN_PLANS.security);
  }
  if (/容器|docker|container/.test(value)) return plan("containers", RUN_PLANS.containers);

  const single = sshDiagnosticPlanForInput(source);
  if (!single) return null;
  return {
    version: 1,
    intent: "targeted",
    risk: "read_only",
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
