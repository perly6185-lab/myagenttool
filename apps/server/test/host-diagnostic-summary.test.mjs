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

test("summarizes login sessions as counts without retaining users or source addresses", () => {
  const active = buildHostDiagnosticSummary("login_sessions", "devagent pts/0 2026-08-27 17:00 (10.10.10.10)\noperator pts/1 2026-08-27 17:10 (10.10.10.11)\ndevagent pts/2 2026-08-27 17:20 (10.10.10.12)");
  assert.equal(active.finding, "login_sessions_found");
  assert.deepEqual(active.facts.map((item) => item.value), ["3", "2"]);
  assert.equal(JSON.stringify(active).includes("devagent"), false);
  assert.equal(JSON.stringify(active).includes("10.10.10.10"), false);

  const empty = buildHostDiagnosticSummary("login_sessions", "");
  assert.equal(empty.finding, "login_sessions_none");
  assert.equal(empty.impact, "interactive_sessions_only");
  assert.equal(empty.nextAction, "review_login_audit");
  assert.deepEqual(empty.facts.map((item) => item.value), ["0", "0"]);
});

test("summarizes SSH login audit events without retaining users or source addresses", () => {
  const output = [
    "2026-08-28T08:00:00+0000 host sshd[100]: Accepted publickey for devagent from 10.10.10.20 port 51000 ssh2",
    "2026-08-28T08:01:00+0000 host sshd[101]: Failed password for root from 10.10.10.30 port 51001 ssh2",
    "2026-08-28T08:02:00+0000 host sshd[102]: Invalid user guest from 10.10.10.40 port 51002",
    "2026-08-28T08:03:00+0000 host sshd[103]: error: Received disconnect from 10.10.10.50 port 51003:3: [preauth]",
    "2026-08-28T08:03:00+0000 host sshd[103]: Disconnected from 10.10.10.50 port 51003 [preauth]",
  ].join("\n");
  const summary = buildHostDiagnosticSummary("ssh_login_audit", output);
  assert.equal(summary.finding, "ssh_login_audit_failures_found");
  assert.equal(summary.severity, "warning");
  assert.deepEqual(summary.facts.map((item) => item.value), ["4", "1", "2", "1", "1"]);
  assert.equal(JSON.stringify(summary).includes("devagent"), false);
  assert.equal(JSON.stringify(summary).includes("10.10.10.20"), false);

  const accepted = buildHostDiagnosticSummary("ssh_login_audit", "host sshd[100]: Accepted password for deploy from 203.0.113.10 port 22 ssh2");
  assert.equal(accepted.finding, "ssh_login_audit_activity_found");
  assert.deepEqual(accepted.facts.map((item) => item.value), ["1", "1", "0", "0", "0"]);

  const unavailable = buildHostDiagnosticSummary("ssh_login_audit", "-- No entries --");
  assert.equal(unavailable.finding, "ssh_login_audit_no_visible_records");
  assert.equal(unavailable.impact, "audit_visibility_limited");
  assert.equal(unavailable.severity, "unknown");

  const serviceOnly = buildHostDiagnosticSummary("ssh_login_audit", "host systemd[1]: Started OpenSSH server daemon.");
  assert.equal(serviceOnly.finding, "ssh_login_audit_no_auth_events");
  assert.deepEqual(serviceOnly.facts.map((item) => item.value), ["0", "0", "0", "0", "0"]);

  const repeatedPreauth = buildHostDiagnosticSummary("ssh_login_audit", [
    "host sshd-session[200]: Failed password for root from 203.0.113.20 port 52000 ssh2 [preauth]",
    "host sshd-session[200]: Connection closed by authenticating user root 203.0.113.20 port 52000 [preauth]",
  ].join("\n"));
  assert.deepEqual(repeatedPreauth.facts.map((item) => item.value), ["1", "0", "1", "0", "1"]);
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
