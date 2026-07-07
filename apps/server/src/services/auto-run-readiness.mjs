/*
 * U1 — auto-run readiness preflight. Turns "why won't this project run / what's
 * missing" into a plain checklist an operator can read before hitting [Auto]:
 * agent, bridge, verify, budget, and the autonomy brakes. Pure function of the
 * resolved signals so it's trivially testable.
 *
 * Each check: status "ok" | "warn" | "blocked" + a human detail.
 *   blocked → a run cannot start (or shouldn't).  warn → it can, but degraded
 *   (e.g. unverified / no budget brake).  ok → good.
 * `ready` = no blocked checks.
 */

function check(key, label, status, detail) {
  return { key, label, status, detail };
}

export function computeAutoRunReadiness({
  project = null,
  agent = null,
  deviceLinked = false,
  budget = null,
  verifyCommand = null,
  settings = {},
  breaker = null,
  activeCount = 0,
} = {}) {
  const checks = [];

  // 1. A default agent is set, exists, enabled, and healthy.
  if (!project) {
    checks.push(check("project", "Project", "blocked", "Project not found."));
  } else if (!project.defaultAgentId || !agent) {
    checks.push(check("agent", "Coding agent", "blocked", "No default agent set for this project. Register one and set it as the project default."));
  } else if (agent.status === "disabled" || agent.lifecycle?.state === "disabled") {
    checks.push(check("agent", "Coding agent", "blocked", `Agent "${agent.name}" is disabled.`));
  } else if ((agent.health?.status ?? "unknown") === "unhealthy") {
    checks.push(check("agent", "Coding agent", "blocked", `Agent "${agent.name}" is unhealthy — run a health check.`));
  } else if ((agent.health?.status ?? "unknown") !== "healthy") {
    checks.push(check("agent", "Coding agent", "warn", `Agent "${agent.name}" health is ${agent.health?.status ?? "unknown"} — probe it before relying on it.`));
  } else {
    checks.push(check("agent", "Coding agent", "ok", `${agent.name} is healthy.`));
  }

  // 2. The bridge/device that executes a CLI agent is linked.
  const cliAgent = agent?.location?.type === "local_device";
  if (cliAgent && !deviceLinked) {
    checks.push(check("bridge", "Bridge / device", "blocked", "No bridge is linked — a CLI agent can't run until the desktop bridge is connected."));
  } else if (cliAgent) {
    checks.push(check("bridge", "Bridge / device", "ok", "Bridge linked."));
  }

  // 3. A verification command (so the PR isn't opened unverified).
  if (verifyCommand) {
    checks.push(check("verify", "Verification", "ok", "A verify command is configured."));
  } else {
    checks.push(check("verify", "Verification", "warn", "No verify command — PRs open unverified. Configure one (env allowlist + project verify name)."));
  }

  // 4. A budget (so the cost brake can engage).
  if (budget?.over) {
    checks.push(check("budget", "Budget", "blocked", `Over budget ($${budget.spentUsd} of $${budget.limitUsd}) — runs are blocked until reset.`));
  } else if (budget?.exists) {
    checks.push(check("budget", "Budget", "ok", `Within budget${budget.remainingUsd != null ? ` ($${budget.remainingUsd} left)` : ""}.`));
  } else {
    checks.push(check("budget", "Budget", "warn", "No budget set — the cost brake can't engage. Set a project budget before unattended volume."));
  }

  // 5. Autonomy brakes that would refuse a start right now.
  if (settings?.autonomyKillSwitch) {
    checks.push(check("killSwitch", "Kill switch", "blocked", "The global kill switch is ON — all autonomous runs are halted."));
  }
  if (breaker?.openUntil && Date.parse(breaker.openUntil) > Date.now()) {
    checks.push(check("breaker", "Circuit breaker", "blocked", `Breaker open after ${breaker.consecutiveFailures} failures — paused until ${breaker.openUntil}.`));
  }
  const globalMax = Number(settings?.globalMaxConcurrent ?? 0);
  if (globalMax > 0 && activeCount >= globalMax) {
    checks.push(check("capacity", "Capacity", "blocked", `At capacity: ${activeCount}/${globalMax} auto-runs active.`));
  }

  return { checks, ready: checks.every((c) => c.status !== "blocked") };
}
