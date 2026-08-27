const MAX_FACTS = 6;

function fact(key, value, severity = "info") {
  return { key, value: String(value).slice(0, 80), severity };
}

function result(severity, finding, impact, nextAction, facts = []) {
  return { version: 1, severity, finding, impact, nextAction, facts: facts.slice(0, MAX_FACTS) };
}

function unknown(finding = "diagnostic_result_unrecognized") {
  return result("unknown", finding, "result_unknown", "review_technical_evidence");
}

function linesOf(output) {
  return String(output ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

function parseSize(value) {
  const match = String(value ?? "").trim().match(/^(\d+(?:\.\d+)?)\s*([kmgtpe]?i?b?)?$/i);
  if (!match) return null;
  const units = { "": 1, b: 1, k: 1e3, kb: 1e3, ki: 1024, kib: 1024, m: 1e6, mb: 1e6, mi: 1024 ** 2, mib: 1024 ** 2, g: 1e9, gb: 1e9, gi: 1024 ** 3, gib: 1024 ** 3, t: 1e12, tb: 1e12, ti: 1024 ** 4, tib: 1024 ** 4, p: 1e15, pb: 1e15, pi: 1024 ** 5, pib: 1024 ** 5, e: 1e18, eb: 1e18, ei: 1024 ** 6, eib: 1024 ** 6 };
  const multiplier = units[String(match[2] ?? "").toLowerCase()];
  return multiplier ? Number(match[1]) * multiplier : null;
}

function capacitySummary(kind, usedPercent, available = null) {
  const prefix = kind === "disk" ? "disk_capacity" : "memory_capacity";
  const impact = kind === "disk" ? "file_operations_may_fail" : "performance_may_be_affected";
  const action = kind === "disk" ? "free_device_space" : "reduce_memory_pressure";
  const facts = [fact(`${kind}_used_percent`, `${usedPercent}%`, usedPercent >= 90 ? "critical" : usedPercent >= 80 ? "warning" : "healthy")];
  if (available) facts.push(fact(`${kind}_available`, available));
  if (usedPercent >= 90) return result("critical", `${prefix}_critical`, impact, action, facts);
  if (usedPercent >= 80) return result("warning", `${prefix}_low`, impact, action, facts);
  return result("healthy", `${prefix}_healthy`, "no_issue_detected", "no_action_needed", facts);
}

export function buildHostDiagnosticSummary(action, output) {
  const lines = linesOf(output);
  if (action === "docker_status" && !lines.length) return result("info", "no_running_containers", "information_only", "review_if_unexpected", [fact("running_container_count", 0)]);
  if (!lines.length) return unknown("diagnostic_result_empty");

  if (action === "disk_usage") {
    const percentages = lines.flatMap((line) => [...line.matchAll(/(?:^|\s)(\d{1,3})%(?:\s|$)/g)].map((match) => Number(match[1]))).filter((value) => value >= 0 && value <= 100);
    return percentages.length ? capacitySummary("disk", Math.max(...percentages)) : unknown();
  }

  if (action === "memory_usage") {
    const memory = lines.find((line) => /^Mem:/i.test(line));
    const fields = memory?.split(/\s+/) ?? [];
    const total = parseSize(fields[1]);
    const available = parseSize(fields[6] ?? fields[3]);
    if (!total || available === null || available < 0 || available > total) return unknown();
    return capacitySummary("memory", Math.round(((total - available) / total) * 100), fields[6] ?? fields[3]);
  }

  if (action === "failed_services") {
    if (lines.some((line) => /^0 loaded units listed\.?$/i.test(line))) return result("healthy", "failed_services_none", "no_issue_detected", "no_action_needed", [fact("failed_service_count", 0, "healthy")]);
    const count = lines.filter((line) => !/^UNIT\s/i.test(line) && !/loaded units listed/i.test(line) && /\bfailed\b/i.test(line)).length;
    return count > 0
      ? result("critical", "failed_services_found", "service_may_be_unavailable", "inspect_failed_services", [fact("failed_service_count", count, "critical")])
      : unknown();
  }

  if (action === "service_status") {
    if (lines.some((line) => /Active:\s+active\s+\(running\)/i.test(line))) return result("healthy", "service_running", "no_issue_detected", "no_action_needed", [fact("service_state", "running", "healthy")]);
    if (lines.some((line) => /Active:\s+failed/i.test(line))) return result("critical", "service_failed", "service_may_be_unavailable", "inspect_service_setup", [fact("service_state", "failed", "critical")]);
    if (lines.some((line) => /Active:\s+(?:inactive|deactivating|activating)/i.test(line))) return result("warning", "service_not_running", "service_may_be_unavailable", "inspect_service_setup", [fact("service_state", "not_running", "warning")]);
    return unknown("service_state_unknown");
  }

  if (action === "uptime") {
    const loads = lines.join(" ").match(/load averages?:\s*([0-9.,]+(?:\s*,\s*[0-9.,]+){0,2})/i)?.[1];
    return result("info", "uptime_information_ready", "information_only", "review_if_unexpected", loads ? [fact("load_average", loads)] : []);
  }

  if (action === "processes") {
    const count = Math.max(0, lines.length - (/^(?:PID|USER)\b/i.test(lines[0]) ? 1 : 0));
    return result("info", "process_activity_ready", "information_only", "review_process_activity", [fact("process_count", count)]);
  }

  if (action === "listening_ports") {
    const count = Math.max(0, lines.length - (/^(?:State|Netid)\b/i.test(lines[0]) ? 1 : 0));
    return result("info", "listening_ports_ready", "information_only", "review_listening_ports", [fact("listening_entry_count", count)]);
  }

  if (action === "docker_status") {
    const count = lines.length;
    return result("info", count ? "containers_running" : "no_running_containers", "information_only", "review_if_unexpected", [fact("running_container_count", count)]);
  }

  if (action === "network_info") {
    const up = lines.filter((line) => /\bUP\b/i.test(line)).length;
    return result("info", "network_information_ready", "information_only", "review_if_unexpected", [fact("network_interface_count", lines.length), fact("network_interface_up_count", up)]);
  }

  if (action === "recent_logs") return result("info", "recent_logs_ready", "information_only", "review_recent_events", [fact("log_line_count", lines.length)]);
  if (action === "system_info") return result("info", "system_information_ready", "information_only", "review_if_unexpected");
  return unknown();
}
