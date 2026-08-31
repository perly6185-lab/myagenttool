import assert from "node:assert/strict";
import { test } from "node:test";

import { buildHostDiagnosticRunSummary, hostDiagnosticRunPlanForInput, primaryHostDiagnosticAction } from "../src/services/host-diagnostic-run.mjs";

test("plans bounded problem-oriented host checks", () => {
  assert.deepEqual(hostDiagnosticRunPlanForInput("网站打开很慢")?.steps.map((step) => step.action), [
    "network_info", "listening_ports", "failed_services", "docker_status", "recent_logs",
  ]);
  assert.deepEqual(hostDiagnosticRunPlanForInput("全面检查")?.steps.map((step) => step.action), [
    "system_info", "uptime", "disk_usage", "memory_usage", "failed_services", "network_info",
  ]);
  assert.equal(hostDiagnosticRunPlanForInput("delete logs && reboot"), null);
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
