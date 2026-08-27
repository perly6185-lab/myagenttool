import assert from "node:assert/strict";
import { test } from "node:test";

import { buildHostDiagnosticSummary } from "../src/services/host-diagnostic-summary.mjs";

test("summarizes disk and memory pressure without retaining device paths", () => {
  const disk = buildHostDiagnosticSummary("disk_usage", "Filesystem Size Used Avail Use% Mounted on\n/dev/private-volume 20G 19G 1G 95% /secret/path");
  assert.deepEqual(disk, {
    version: 1,
    severity: "critical",
    finding: "disk_capacity_critical",
    impact: "file_operations_may_fail",
    nextAction: "free_device_space",
    facts: [{ key: "disk_used_percent", value: "95%", severity: "critical" }],
  });
  assert.equal(JSON.stringify(disk).includes("private-volume"), false);
  assert.equal(JSON.stringify(disk).includes("secret/path"), false);

  const memory = buildHostDiagnosticSummary("memory_usage", "              total        used        free      shared  buff/cache   available\nMem:           16Gi        15Gi       200Mi       100Mi       800Mi       700Mi");
  assert.equal(memory.finding, "memory_capacity_critical");
  assert.equal(memory.facts[0].value, "96%");
  assert.equal(memory.facts[1].value, "700Mi");
});

test("distinguishes healthy and failed service checks without retaining service names", () => {
  const failed = buildHostDiagnosticSummary("failed_services", "UNIT LOAD ACTIVE SUB DESCRIPTION\n● private-worker.service loaded failed failed Private worker");
  assert.equal(failed.finding, "failed_services_found");
  assert.deepEqual(failed.facts, [{ key: "failed_service_count", value: "1", severity: "critical" }]);
  assert.equal(JSON.stringify(failed).includes("private-worker"), false);

  const running = buildHostDiagnosticSummary("service_status", "● private.service\n Active: active (running) since today");
  assert.equal(running.finding, "service_running");
  assert.equal(JSON.stringify(running).includes("private.service"), false);
});

test("uses bounded informational counts for ports, processes, containers, logs, and networks", () => {
  assert.deepEqual(buildHostDiagnosticSummary("listening_ports", "State Local Address\nLISTEN 0.0.0.0:22\nLISTEN 127.0.0.1:5432").facts, [{ key: "listening_entry_count", value: "2", severity: "info" }]);
  assert.deepEqual(buildHostDiagnosticSummary("processes", "PID COMMAND %CPU %MEM\n1 private-process 20 3").facts, [{ key: "process_count", value: "1", severity: "info" }]);
  assert.equal(buildHostDiagnosticSummary("docker_status", "").finding, "no_running_containers");
  assert.equal(buildHostDiagnosticSummary("recent_logs", "private log one\nprivate log two").facts[0].value, "2");
  assert.deepEqual(buildHostDiagnosticSummary("network_info", "lo UNKNOWN 127.0.0.1\neth0 UP 10.0.0.2").facts.map((item) => item.value), ["2", "1"]);
});

test("does not infer health from empty or unrecognized diagnostic output", () => {
  assert.deepEqual(buildHostDiagnosticSummary("disk_usage", ""), {
    version: 1,
    severity: "unknown",
    finding: "diagnostic_result_empty",
    impact: "result_unknown",
    nextAction: "review_technical_evidence",
    facts: [],
  });
  assert.equal(buildHostDiagnosticSummary("memory_usage", "unexpected private output").finding, "diagnostic_result_unrecognized");
});
