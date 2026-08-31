import assert from "node:assert/strict";
import { test } from "node:test";

import { buildHostDiagnosticRunSummary, hostDiagnosticRunPlanForInput, primaryHostDiagnosticAction } from "../src/services/host-diagnostic-run.mjs";

test("plans bounded problem-oriented host checks", () => {
  const website = hostDiagnosticRunPlanForInput("网站打开很慢");
  assert.deepEqual(website?.steps.map((step) => step.action), [
    "network_info", "listening_ports", "failed_services", "docker_status", "recent_logs",
  ]);
  assert.deepEqual(website?.understanding, {
    version: 1, goal: "improve", domain: "website", symptom: "slow", desiredOutcome: "improve_performance",
    requestedChange: "none", handling: "read_only_diagnosis", confidence: "high",
  });
  assert.deepEqual(hostDiagnosticRunPlanForInput("全面检查")?.steps.map((step) => step.action), [
    "system_info", "uptime", "disk_usage", "memory_usage", "failed_services", "network_info",
  ]);
  assert.equal(hostDiagnosticRunPlanForInput("delete logs && reboot"), null);
});

test("understands colloquial outcomes and routes requested changes to diagnosis first", () => {
  const cleanup = hostDiagnosticRunPlanForInput("磁盘满了，帮我清理一下");
  assert.equal(cleanup?.intent, "performance");
  assert.deepEqual(cleanup?.understanding, {
    version: 1, goal: "restore", domain: "storage", symptom: "storage_pressure", desiredOutcome: "free_space",
    requestedChange: "cleanup_storage", handling: "diagnose_before_change", confidence: "high",
  });

  const restart = hostDiagnosticRunPlanForInput("重启 nginx 让网站恢复");
  assert.equal(restart?.intent, "website");
  assert.equal(restart?.understanding.requestedChange, "restart_service");
  assert.equal(restart?.understanding.desiredOutcome, "restore_availability");

  const process = hostDiagnosticRunPlanForInput("杀掉占内存最高的进程");
  assert.equal(process?.intent, "performance");
  assert.equal(process?.understanding.requestedChange, "stop_process");
  assert.equal(process?.understanding.domain, "memory");
  assert.equal(process?.understanding.desiredOutcome, "improve_performance");

  const access = hostDiagnosticRunPlanForInput("封禁陌生登录 IP");
  assert.equal(access?.intent, "security");
  assert.equal(access?.understanding.requestedChange, "change_access");
  assert.equal(access?.understanding.desiredOutcome, "verify_security");

  const offline = hostDiagnosticRunPlanForInput("这台机器离线了，没反应");
  assert.equal(offline?.intent, "health");
  assert.equal(offline?.understanding.desiredOutcome, "restore_availability");

  const service = hostDiagnosticRunPlanForInput("服务不可用");
  assert.deepEqual(service?.steps.map((step) => step.action), ["failed_services", "recent_logs"]);
});

test("turns a named service restart request into a fixed status check", () => {
  const result = hostDiagnosticRunPlanForInput("restart redis");
  assert.equal(result?.intent, "targeted");
  assert.deepEqual(result?.steps, [{ action: "service_status", parameters: { serviceName: "redis" } }]);
  assert.equal(result?.understanding.domain, "service");
  assert.equal(result?.understanding.handling, "diagnose_before_change");

  const signIns = hostDiagnosticRunPlanForInput("who signed in recently?");
  assert.equal(signIns?.understanding.domain, "security");
  assert.equal(signIns?.steps[0]?.action, "ssh_login_audit");
});

test("keeps partial evidence and prioritizes the strongest finding", () => {
  const steps = [
    { action: "disk_usage", status: "completed", summary: { severity: "critical" } },
    { action: "memory_usage", status: "completed", summary: { severity: "healthy" } },
    { action: "failed_services", status: "unavailable", error: "ssh_fixed_command_failed" },
  ];
  const summary = buildHostDiagnosticRunSummary(steps);
  assert.equal(summary.severity, "critical");
  assert.equal(summary.finding, "host_critical_findings");
  assert.equal(summary.facts.find((fact) => fact.key === "diagnostic_unavailable_count")?.value, "1");
  assert.equal(primaryHostDiagnosticAction(steps), "disk_usage");
});
