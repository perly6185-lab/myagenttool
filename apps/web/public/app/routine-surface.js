export function createRoutineRunSurface({
  els,
  emptyMiniCard,
  getRoutineRunsState,
  getSelectedRoutineRunId,
  isRoutineRunsRefreshInFlight,
  setSelectedRoutineRunId,
  shortTime,
}) {
  function renderTaskList(state) {
    const routineState = getRoutineRunsState() ?? state?.loopRoutines ?? null;
    const runs = [...(routineState?.runs ?? [])]
      .sort((a, b) => String(b.startedAt ?? b.routineRunId).localeCompare(String(a.startedAt ?? a.routineRunId)))
      .slice(0, 50);
    if (!runs.length) {
      els.taskListRows.replaceChildren(emptyMiniCard(isRoutineRunsRefreshInFlight() ? "Loading routine runs..." : "No routine runs found for this project."));
      els.routineRunDetail.replaceChildren(emptyMiniCard("Routine evidence appears here after a local routine run completes."));
      return;
    }
    if (!getSelectedRoutineRunId() || !runs.some((run) => run.routineRunId === getSelectedRoutineRunId())) {
      setSelectedRoutineRunId(runs[0]?.routineRunId ?? null);
    }
    els.taskListRows.replaceChildren(...runs.map(routineRunRow));
    renderRoutineRunDetail(runs.find((run) => run.routineRunId === getSelectedRoutineRunId()) ?? runs[0]);
  }

  function renderRoutineRunDetail(run) {
    if (!run) {
      els.routineRunDetail.replaceChildren(emptyMiniCard("Select a routine run to inspect local evidence."));
      return;
    }
    const shell = document.createElement("section");
    shell.className = "routine-run-detail-card";

    const header = document.createElement("div");
    header.className = "routine-run-detail-header";
    const title = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "step-label";
    eyebrow.textContent = run.routineId ?? "routine";
    const heading = document.createElement("h3");
    heading.textContent = run.name ?? run.routineRunId;
    title.append(eyebrow, heading);
    const status = document.createElement("span");
    status.className = "task-list-status";
    status.dataset.status = run.status;
    status.textContent = routineRunStatusText(run.status);
    header.append(title, status);

    const metrics = document.createElement("div");
    metrics.className = "routine-run-metrics";
    metrics.append(
      routineMetric("Findings", run.summary?.findingCount ?? 0),
      routineMetric("Suggested", run.summary?.suggestedRunCount ?? 0),
      routineMetric("Checks", run.summary?.checkCount ?? 0),
      routineMetric("Fanout", run.summary?.fanoutCandidateCount ?? "none")
    );

    const findings = document.createElement("div");
    findings.className = "routine-run-section";
    findings.append(sectionTitle("Findings"));
    findings.append(routineFindingList(run.findings ?? []));

    const commands = document.createElement("div");
    commands.className = "routine-run-section";
    commands.append(sectionTitle("Commands"));
    commands.append(routineCommandList(run));

    const boundaries = document.createElement("p");
    boundaries.className = "routine-boundary-note";
    boundaries.textContent = "This panel is read-only. Mutation commands are shown for manual CLI use and still require explicit operator approval.";

    shell.append(header, metrics, findings, commands, boundaries);
    els.routineRunDetail.replaceChildren(shell);
  }

  function routineRunRow(run) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "task-list-row";
    row.dataset.routineRunId = run.routineRunId;
    row.dataset.active = String(run.routineRunId === getSelectedRoutineRunId());

    const id = document.createElement("span");
    id.className = "task-list-id";
    id.textContent = shortRoutineRunId(run.routineRunId);

    const body = document.createElement("span");
    body.className = "task-list-body";
    const title = document.createElement("strong");
    title.textContent = run.name ?? run.routineId ?? run.routineRunId;
    const meta = document.createElement("small");
    meta.textContent = [
      run.routineId,
      `${run.summary?.findingCount ?? 0} findings`,
      `${run.summary?.suggestedRunCount ?? 0} suggested`,
      run.runDir
    ].filter(Boolean).join(" · ");
    body.append(title, meta);

    const owner = document.createElement("span");
    owner.className = "task-list-owner";
    owner.textContent = run.summary?.failedCheckCount ? `${run.summary.failedCheckCount} failed` : `${run.summary?.checkCount ?? 0} checks`;

    const status = document.createElement("span");
    status.className = "task-list-status";
    status.dataset.status = run.status;
    status.textContent = routineRunStatusText(run.status);

    const updated = document.createElement("span");
    updated.className = "task-list-updated";
    updated.textContent = run.completedAt || run.startedAt ? shortTime(run.completedAt ?? run.startedAt) : "-";

    const action = document.createElement("span");
    action.className = "task-list-action";
    action.textContent = "Inspect";

    row.append(id, body, owner, status, updated, action);
    return row;
  }

  return {
    renderRoutineRunDetail,
    renderTaskList,
  };
}

function routineRunStatusText(status) {
  const labels = {
    completed: "Completed",
    failed: "Failed",
    running: "Running",
    unknown: "Unknown"
  };
  return labels[status] ?? status ?? "Unknown";
}

function shortRoutineRunId(id) {
  const value = String(id ?? "");
  const match = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
  return match?.[1] ?? value.slice(0, 18);
}

function routineMetric(label, value) {
  const item = document.createElement("span");
  item.className = "routine-run-metric";
  const strong = document.createElement("strong");
  strong.textContent = String(value);
  const small = document.createElement("small");
  small.textContent = label;
  item.append(strong, small);
  return item;
}

function sectionTitle(text) {
  const title = document.createElement("h4");
  title.textContent = text;
  return title;
}

function routineFindingList(findings) {
  const list = document.createElement("ul");
  list.className = "routine-finding-list";
  const visible = findings.slice(0, 5);
  if (visible.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No findings recorded.";
    list.append(item);
    return list;
  }
  for (const finding of visible) {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = `[${finding.severity ?? "unknown"}] ${finding.title ?? finding.id}`;
    const action = document.createElement("span");
    action.textContent = finding.proposedAction ?? "No proposed action recorded.";
    item.append(title, action);
    list.append(item);
  }
  return list;
}

function routineCommandList(run) {
  const list = document.createElement("ul");
  list.className = "routine-command-list";
  for (const command of routineRunCommands(run)) {
    const item = document.createElement("li");
    item.textContent = command;
    list.append(item);
  }
  return list;
}

function routineRunCommands(run) {
  const findings = (run.findings ?? []).slice(0, 5);
  const suggested = findings.filter((finding) => finding.suggestedRun);
  const commands = [
    `pnpm ai:loop-routine-show -- --routine-run ${run.routineRunId}`,
    `pnpm ai:loop-routine-findings -- --routine-run ${run.routineRunId} --with-suggested-run`
  ];
  if (suggested.length > 0) {
    commands.push(`pnpm ai:loop-routine-fanout-plan -- --routine-run ${run.routineRunId}`);
    commands.push(`pnpm ai:loop-routine-fanout-execute -- --routine-run ${run.routineRunId} --approval "operator approved planning-only fanout"`);
  }
  return commands;
}
