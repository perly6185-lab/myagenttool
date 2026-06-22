import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const asciiPath = resolve(repoRoot, ".myagenttool/runs/flow-validation-managed-session-history/ascii-prototype.md");
const agentWorkspaceAsciiPath = resolve(repoRoot, ".myagenttool/runs/orca-inspired-agent-workspace-ui/agent-workspace-ascii-prototype.md");
const canvasRoot = resolve(repoRoot, "docs/design/prototypes/canvas");
const outPath = resolve(canvasRoot, "managed-session-history.imported.scene.json");
const agentWorkspaceOutPath = resolve(canvasRoot, "agent-workspace.imported.scene.json");

const ascii = readFileSync(asciiPath, "utf8");
const sections = parseSections(ascii);
const productFlow = parseProductFlow(ascii);
const agentWorkspaceAscii = readFileSync(agentWorkspaceAsciiPath, "utf8");
const agentWorkspaceSections = parseSections(agentWorkspaceAscii);
const agentWorkspaceProductFlow = parseProductFlow(agentWorkspaceAscii);

const scene = {
  version: "2026-06-21.phase-2-imported",
  name: "Imported Managed Session History Prototype Canvas",
  source: {
    type: "ascii",
    path: ".myagenttool/runs/flow-validation-managed-session-history/ascii-prototype.md",
  },
  productFlow: {
    roleFlow: productFlow["Role flow"] ?? "ordinary developer plus advanced developer",
    scenario: productFlow.Scenario ?? "Review managed session history UI before production implementation.",
    frequency: productFlow.Frequency ?? "high for task composer, medium for session detail",
    ownerSurface: productFlow["Owner surface"] ?? "Prototype Canvas and generated HTML prototype",
    usabilityTask: "Inspect the imported UI structure, verify ownership boundaries, and prepare it for visual editing.",
    partialAcceptanceOrFollowUp: "Gate 3 will add visual pan, zoom, drag, and label editing.",
  },
  canvas: {
    coordinateSystem: "infinite",
    viewport: { x: 0, y: 0, width: 1440, height: 1240 },
    grid: { size: 24, visible: true },
  },
  surfaces: [homeSurface(sections), sessionDetailSurface(sections)],
};

mkdirSync(canvasRoot, { recursive: true });
writeFileSync(outPath, `${JSON.stringify(scene, null, 2)}\n`);
writeFileSync(agentWorkspaceOutPath, `${JSON.stringify(agentWorkspaceScene(), null, 2)}\n`);
console.log(`[import-ascii-prototype] wrote ${relative(outPath)}`);
console.log(`[import-ascii-prototype] wrote ${relative(agentWorkspaceOutPath)}`);

function agentWorkspaceScene() {
  return {
    version: "2026-06-21.agent-workspace-imported",
    name: "Imported Agent Workspace Prototype Canvas",
    source: {
      type: "ascii",
      path: ".myagenttool/runs/orca-inspired-agent-workspace-ui/agent-workspace-ascii-prototype.md",
    },
    productFlow: {
      roleFlow: agentWorkspaceProductFlow["Role flow"] ?? "ordinary developer, advanced developer, team administrator, auditor",
      scenario: agentWorkspaceProductFlow.Scenario ?? "Navigate a managed agent workspace without mixing role surfaces.",
      frequency: agentWorkspaceProductFlow.Frequency ?? "high for Run, medium or low critical for advanced surfaces",
      ownerSurface: agentWorkspaceProductFlow["Owner surface"] ?? "Agent Workspace shell",
      usabilityTask: "Review the Run-first workspace shell and confirm advanced surfaces stay separated.",
      partialAcceptanceOrFollowUp: "Phase C will implement the production Web Console IA shell.",
    },
    canvas: {
      coordinateSystem: "infinite",
      viewport: { x: 0, y: 0, width: 1560, height: 1720 },
      grid: { size: 24, visible: true },
    },
    surfaces: [
      runWorkspaceSurface(),
      workspaceDetailSurface({
        id: "session-surface",
        name: "Session Surface",
        role: "advanced_developer",
        section: "Desktop: Session Surface",
        scenario: "Inspect and continue managed Codex session turns.",
        frequency: "medium",
        ownerSurface: "Session workspace surface",
        states: ["no_session", "running_session", "completed_session", "continuation_guidance"],
        labels: ["Managed Codex session", "Initial task", "Follow-up", "Feedback", "Add follow-up", "Continue session", "Attach diff"],
        notShown: ["private Codex files", "integration setup controls", "imported evidence as managed proof"],
      }),
      workspaceDetailSurface({
        id: "diff-surface",
        name: "Diff Surface",
        role: "advanced_developer",
        section: "Desktop: Diff Surface",
        scenario: "Review changed files and decide whether to accept or request changes.",
        frequency: "medium",
        ownerSurface: "Diff workspace surface",
        states: ["diff_review", "review_pending", "changes_requested"],
        labels: ["Changed files", "apps/web/public/app.js", "apps/web/public/styles.css", "Review state: pending", "Accept", "Request changes"],
        notShown: ["raw event flood", "approval inbox", "integration setup controls"],
      }),
      workspaceDetailSurface({
        id: "terminal-surface",
        name: "Terminal Surface Placeholder",
        role: "advanced_developer",
        section: "Desktop: Terminal Surface Placeholder",
        scenario: "Inspect managed terminal availability without implying unmanaged shells are governed.",
        frequency: "medium",
        ownerSurface: "Terminal workspace surface",
        states: ["runtime_not_connected", "managed_pty_pending", "ssh_pending"],
        labels: ["Managed terminal is not connected yet", "Placeholder for managed PTY attach", "View runtime plan", "Runtime issue: #144-#150", "Policy: not governed yet"],
        notShown: ["raw local terminal as managed evidence", "unmanaged shell access", "private keys"],
      }),
      workspaceDetailSurface({
        id: "evidence-surface",
        name: "Evidence Surface",
        role: "auditor",
        section: "Desktop: Evidence Surface",
        scenario: "Trace managed evidence and distinguish imported supplements.",
        frequency: "low_critical",
        ownerSurface: "Evidence workspace surface",
        states: ["managed_jsonl_evidence", "approval_evidence", "file_change", "imported_evidence", "export_summary"],
        labels: ["Evidence chain", "JSONL event summary", "Approval record", "File change summary", "Imported evidence is shown separately", "Export summary"],
        notShown: ["unredacted secrets", "imported evidence as managed proof", "private Codex auth files"],
      }),
      workspaceDetailSurface({
        id: "approval-surface",
        name: "Approval Surface",
        role: "team_administrator",
        section: "Desktop: Approval Surface",
        scenario: "Review pending risky actions and approve or deny with consequence context.",
        frequency: "low_critical",
        ownerSurface: "Approval workspace surface",
        states: ["approval_pending", "approval_approved", "approval_denied", "approval_timed_out"],
        labels: ["Pending request", "Codex requests test execution", "Risk: reads and executes local repo", "Approve", "Deny", "Audit: approve/deny is recorded"],
        notShown: ["unclear allow buttons", "raw policy internals as primary copy", "approval inbox inside task composer"],
      }),
      workspaceDetailSurface({
        id: "setup-surface",
        name: "Setup Surface",
        role: "team_administrator",
        section: "Desktop: Setup Surface",
        scenario: "Connect agents and prepare runtime targets without auto-enabling unreviewed integrations.",
        frequency: "low_critical",
        ownerSurface: "Setup workspace surface",
        states: ["discovery_empty", "candidate_found", "integration_artifact_needs_review", "ssh_placeholder"],
        labels: ["Connect Agent", "Codex CLI", "Local managed runtime", "SSH target placeholder", "Review setup"],
        notShown: ["auto-enabled agents", "private keys", "unreviewed integrations as runnable agents"],
      }),
      mobileSurface(),
    ],
  };
}

function runWorkspaceSurface() {
  const runBlocks = [
    "Desktop: Run Surface Ready",
    "Desktop: Running State",
    "Desktop: Approval Needed State",
    "Desktop: Succeeded With Changes",
  ].map((sectionName) => agentWorkspaceSections.get(sectionName) ?? "");
  return {
    id: "run-workspace",
    name: "Run Workspace",
    kind: "home",
    role: "ordinary_developer",
    productFlow: {
      roleFlow: "ordinary developer",
      scenario: "Run a managed agent task from a clean first screen.",
      frequency: "high",
      ownerSurface: "Run-first Agent Workspace shell",
      usabilityTask: "Type a task, choose computer and agent, review safety, and run without seeing advanced governance internals.",
      partialAcceptanceOrFollowUp: "Phase C will implement the production shell and state wiring.",
    },
    prototypeStates: ["ready", "running", "approval_needed", "succeeded_with_changes"],
    acceptanceSignals: [
      "Findable: Run is the default active surface.",
      "Understandable: task, status, and context rail are separated.",
      "Actionable: run, cancel, approve/deny, review diff, and open session appear only when relevant.",
      "Traceable: session and evidence summaries are reachable from the context rail.",
    ],
    whatNotToShow: ["raw terminal", "raw JSONL", "hook names", "imported evidence workflow", "integration builder", "full session turns", "approval inbox", "private Codex files"],
    bounds: { x: 0, y: 0, width: 1420, height: 720 },
    regions: [
      workspaceNavRegion(runBlocks),
      runComposerRegion(runBlocks),
      runStatusRegion(runBlocks),
      workspaceContextRailRegion(runBlocks),
    ],
  };
}

function workspaceNavRegion(blocks) {
  return agentRegion({
    id: "workspace-nav",
    name: "Workspace Navigation",
    ownerSurface: "Left workspace navigation",
    frequency: "medium",
    role: "multi_role",
    scenario: "Switch between role-owned workspace surfaces.",
    usabilityTask: "Find Run, Session, Diff, Terminal, Evidence, Approval, and Setup without crowding Run.",
    states: ["run_active", "advanced_surface_available"],
    acceptanceSignals: [
      "Findable: all surfaces are available from navigation.",
      "Understandable: Run is visually first.",
      "Actionable: surface switching does not change task composer ownership.",
    ],
    whatNotToShow: ["raw terminal", "raw JSONL", "approval inbox content", "private keys"],
    bounds: { x: 24, y: 72, width: 180, height: 560 },
    labels: ["Run", "Session", "Diff", "Terminal", "Evidence", "Approval", "Setup"],
    typeRules: [["Run", "button"], ["Session", "button"], ["Diff", "button"], ["Terminal", "button"], ["Evidence", "button"], ["Approval", "button"], ["Setup", "button"]],
  });
}

function runComposerRegion(blocks) {
  return agentRegion({
    id: "run-composer",
    name: "Run Task Composer",
    ownerSurface: "Run surface",
    frequency: "high",
    role: "ordinary_developer",
    scenario: "Describe and start a managed agent task.",
    usabilityTask: "Type task, select computer and agent, select session mode, and run.",
    states: ["ready", "running_disabled", "approval_visible", "succeeded_ready_for_next"],
    acceptanceSignals: [
      "Findable: task input is first in Run.",
      "Understandable: computer, agent, and session mode are visible.",
      "Actionable: run and cancel are clearly separated.",
    ],
    whatNotToShow: ["raw terminal", "raw JSONL", "hook names", "imported evidence workflow", "integration builder", "full session turns", "approval inbox", "private Codex files"],
    bounds: { x: 232, y: 72, width: 440, height: 560 },
    labels: ["What should your computer do?", "Fix failing tests and summarize changed files", "Computer", "This computer", "Agent", "Codex CLI", "Codex session", "New session", "Continue latest", "Safety review", "Run", "Cancel"],
    typeRules: [["What should your computer do?", "textarea"], ["Run", "button"], ["Cancel", "button"], ["Computer", "select"], ["Agent", "select"], ["New session", "radio"], ["Continue latest", "radio"], ["Safety review", "status"]],
  });
}

function runStatusRegion(blocks) {
  return agentRegion({
    id: "run-status",
    name: "Run Status And Result",
    ownerSurface: "Run surface",
    frequency: "high",
    role: "ordinary_developer",
    scenario: "Understand current task state and act on the result.",
    usabilityTask: "Tell whether the task is ready, running, waiting, or complete.",
    states: ["ready", "running", "approval_needed", "succeeded_with_changes", "failed"],
    acceptanceSignals: [
      "Findable: status appears beside the composer.",
      "Understandable: state copy is plain-language.",
      "Actionable: approval and result actions appear only when relevant.",
    ],
    whatNotToShow: ["raw terminal stream", "raw JSONL", "hook names", "private Codex files"],
    bounds: { x: 704, y: 72, width: 440, height: 560 },
    labels: ["Status", "Ready to run", "Running with Codex CLI", "Approval needed", "Approve", "Deny", "Result", "Completed", "Review diff", "Open result", "Technical details collapsed"],
    typeRules: [["Approve", "button"], ["Deny", "button"], ["Review diff", "button"], ["Open result", "button"], ["Status", "status"], ["Result", "result"]],
  });
}

function workspaceContextRailRegion(blocks) {
  return agentRegion({
    id: "workspace-context-rail",
    name: "Workspace Context Rail",
    ownerSurface: "Right context rail",
    frequency: "medium",
    role: "multi_role",
    scenario: "Summarize current session, attention, and evidence without crowding Run.",
    usabilityTask: "Open session, approval, or evidence from context.",
    states: ["session_ready", "needs_attention_empty", "needs_attention_pending", "evidence_summary"],
    acceptanceSignals: [
      "Findable: current session and attention are visible.",
      "Understandable: managed/imported evidence counts are summarized.",
      "Actionable: Open session, Open approval, and Open evidence are separate.",
      "Traceable: evidence entry stays out of task input.",
    ],
    whatNotToShow: ["raw JSONL", "hook names", "unfiltered evidence registry", "private Codex files"],
    bounds: { x: 1176, y: 72, width: 220, height: 560 },
    labels: ["Current session", "codex-215", "Managed", "Open session", "Needs attention", "Open approval", "Evidence", "Managed: 12", "Imported: 0", "Open evidence"],
    typeRules: [["Open session", "button", { interaction: { type: "open_surface", target: "session-surface" } }], ["Open approval", "button", { interaction: { type: "open_surface", target: "approval-surface" } }], ["Open evidence", "button", { interaction: { type: "open_surface", target: "evidence-surface" } }]],
  });
}

function workspaceDetailSurface({ id, name, role, section, scenario, frequency, ownerSurface, states, labels, notShown }) {
  const block = agentWorkspaceSections.get(section) ?? "";
  const fallbackLabels = labels.length > 0 ? labels : extractMatchingLines(block, [/.+/]).slice(0, 8);
  return {
    id,
    name,
    kind: "detail",
    role,
    productFlow: {
      roleFlow: role.replace(/_/g, " "),
      scenario,
      frequency,
      ownerSurface,
      usabilityTask: scenario,
      partialAcceptanceOrFollowUp: "Phase C will implement this as a production workspace surface.",
    },
    prototypeStates: states,
    acceptanceSignals: [
      `Findable: ${name} is reachable from workspace navigation.`,
      `Understandable: ${name} states are distinct from Run.`,
      `Actionable: ${name} exposes only role-relevant actions.`,
      `Traceable: ${name} preserves managed session context where relevant.`,
    ],
    whatNotToShow: notShown,
    bounds: { x: 0, y: 760, width: 1120, height: 360 },
    regions: [
      agentRegion({
        id: `${id}-main`,
        name,
        ownerSurface,
        frequency,
        role,
        scenario,
        usabilityTask: scenario,
        states,
        acceptanceSignals: [`${name} has its own surface ownership.`],
        whatNotToShow: notShown,
        bounds: { x: 232, y: 72, width: 520, height: 260 },
        labels: fallbackLabels.slice(0, Math.ceil(fallbackLabels.length / 2)),
        typeRules: [["Approve", "button"], ["Deny", "button"], ["Accept", "button"], ["Request changes", "button"], ["Export summary", "button"], ["Review setup", "button"], ["View runtime plan", "button"]],
      }),
      agentRegion({
        id: `${id}-context`,
        name: `${name} Context`,
        ownerSurface: `${ownerSurface} context rail`,
        frequency,
        role,
        scenario,
        usabilityTask: scenario,
        states,
        acceptanceSignals: [`${name} context explains consequences or traceability.`],
        whatNotToShow: notShown,
        bounds: { x: 784, y: 72, width: 312, height: 260 },
        labels: fallbackLabels.slice(Math.ceil(fallbackLabels.length / 2)),
        typeRules: [["Continue session", "button"], ["Attach diff", "button"], ["Approve", "button"], ["Deny", "button"], ["Export summary", "button"]],
      }),
    ],
  };
}

function mobileSurface() {
  return {
    id: "mobile-task-first",
    name: "Mobile Task-First Layout",
    kind: "detail",
    role: "ordinary_developer",
    productFlow: {
      roleFlow: "ordinary developer",
      scenario: "Use the workspace on mobile without advanced surfaces appearing before the task.",
      frequency: "high",
      ownerSurface: "Mobile Agent Workspace",
      usabilityTask: "Run a task, see status, and open more surfaces after session context.",
      partialAcceptanceOrFollowUp: "Phase C will implement responsive production layout.",
    },
    prototypeStates: ["mobile_ready", "mobile_running", "mobile_surface_switcher"],
    acceptanceSignals: [
      "Findable: Run appears first on mobile.",
      "Understandable: status and session summary follow Run.",
      "Actionable: More exposes advanced surfaces after the primary task flow.",
    ],
    whatNotToShow: ["raw terminal", "raw JSONL", "hook names", "imported evidence workflow", "setup controls in Run composer"],
    bounds: { x: 0, y: 1160, width: 390, height: 720 },
    regions: [
      agentRegion({
        id: "mobile-run-stack",
        name: "Mobile Run Stack",
        ownerSurface: "Mobile Run surface",
        frequency: "high",
        role: "ordinary_developer",
        scenario: "Stack task, status, session, and more controls.",
        usabilityTask: "Find the task path before advanced surfaces.",
        states: ["mobile_ready", "mobile_surface_switcher"],
        acceptanceSignals: ["Mobile Run stack preserves task-first order."],
        whatNotToShow: ["raw terminal", "raw JSONL", "hook names", "imported evidence workflow", "setup controls in Run composer"],
        bounds: { x: 24, y: 72, width: 342, height: 560 },
        labels: ["Run", "What should your computer do?", "Agent: Codex CLI", "Session: Continue latest", "Run", "Cancel", "Status", "Ready to run", "Session", "Continue", "Open session", "More", "Session", "Diff", "Terminal", "Evidence", "Approval", "Setup"],
        typeRules: [["What should your computer do?", "textarea"], ["Run", "button"], ["Cancel", "button"], ["Continue", "button"], ["Open session", "button"]],
      }),
    ],
  };
}

function agentRegion({ id, name, ownerSurface, frequency, role, scenario, usabilityTask, states, acceptanceSignals, whatNotToShow, bounds, labels, typeRules = [] }) {
  return region({
    id,
    name,
    ownerSurface,
    frequency,
    role,
    scenario,
    usabilityTask,
    states,
    acceptanceSignals,
    whatNotToShow,
    bounds,
    elements: labelsToElements(unique(labels), { x: bounds.x + 24, y: bounds.y + 32, width: bounds.width - 48, type: "text" }, typeRules),
  });
}

function homeSurface(parsedSections) {
  const desktopReady = parsedSections.get("Desktop: Empty / Ready") ?? "";
  const running = parsedSections.get("Desktop: Running") ?? "";
  const approval = parsedSections.get("Desktop: Approval Needed") ?? "";
  const succeeded = parsedSections.get("Desktop: Succeeded With Changes") ?? "";
  const mobile = parsedSections.get("Mobile: Stacked Layout") ?? "";
  return {
    id: "home-workspace",
    name: "Home Workspace",
    kind: "home",
    role: "ordinary_developer",
    productFlow: {
      roleFlow: "ordinary developer",
      scenario: "Run or continue a managed Codex task from the home workspace.",
      frequency: "high",
      ownerSurface: "Home task workspace with right context rail",
      usabilityTask: "Use Codex to run a repository task and find the latest managed session.",
      partialAcceptanceOrFollowUp: "Session detail opens from the context rail.",
    },
    prototypeStates: importedStates([desktopReady, running, approval, succeeded, mobile]),
    acceptanceSignals: parseDraftAcceptance(ascii),
    whatNotToShow: ["raw JSONL", "hook names", "imported evidence", "integration builder", "full session turns"],
    bounds: { x: 0, y: 0, width: 1320, height: 760 },
    regions: [
      taskComposerRegion(desktopReady, running, approval, succeeded, mobile),
      executionStatusRegion(desktopReady, running, approval, succeeded),
      contextRailRegion(desktopReady, running, approval, succeeded, mobile),
    ],
  };
}

function sessionDetailSurface(parsedSections) {
  const detail = parsedSections.get("Desktop: Session Detail With Follow-up Turns") ?? "";
  return {
    id: "session-detail",
    name: "Session Detail",
    kind: "detail",
    role: "advanced_developer",
    productFlow: {
      roleFlow: "advanced developer",
      scenario: "Inspect and continue turns inside a managed Codex session.",
      frequency: "medium",
      ownerSurface: "Session detail opened from context rail",
      usabilityTask: "Review previous turns and add a follow-up without losing session context.",
      partialAcceptanceOrFollowUp: "Diff review remains a later detail flow.",
    },
    prototypeStates: ["session_open", "initial_task", "follow_up", "feedback"],
    acceptanceSignals: [
      "Findable: session detail opens from the right rail.",
      "Understandable: turns are labeled as initial task, follow-up, or feedback.",
      "Actionable: user can send follow-up or attach diff context.",
      "Traceable: follow-ups reuse managed session context and create evidence.",
    ],
    whatNotToShow: ["private Codex auth files", "private Codex session files as primary evidence", "imported evidence as managed proof"],
    bounds: { x: 0, y: 840, width: 920, height: 360 },
    regions: [sessionTurnsRegion(detail), followUpRegion(detail)],
  };
}

function taskComposerRegion(...blocks) {
  const text = blocks.map((block) => extractColumns(block).left).join("\n");
  const labels = unique([
    ...extractBracketLabels(text),
    ...extractMatchingLines(text, [/^What should your computer do\??$/i, /^Computer$/i, /^Computer: This computer$/i, /^Agent$/i, /^Agent: Codex CLI$/i, /^Codex session$/i, /^New session$/i, /^Continue latest$/i, /^Session: Continue latest$/i]),
  ]).filter((label) => !forbiddenInTask(label) && isTaskComposerLabel(label));
  return region({
    id: "task-composer",
    name: "Current Task Intent",
    ownerSurface: "Left column: current task intent",
    frequency: "high",
    role: "ordinary_developer",
    scenario: "Describe and run a local agent task.",
    usabilityTask: "Type a task, select computer and agent, review safety, and run.",
    states: ["empty", "ready", "running_disabled", "mobile_stacked"],
    acceptanceSignals: [
      "Findable: task input is first.",
      "Understandable: agent and session mode are visible.",
      "Actionable: run and cancel are visible.",
      "Traceable: latest session remains in context rail.",
    ],
    whatNotToShow: ["Evidence Center", "Import evidence", "raw JSONL", "hook names", "integration builder", "session turns", "Add follow-up"],
    bounds: { x: 32, y: 72, width: 360, height: 560 },
    elements: labelsToElements(labels, { x: 56, y: 104, width: 300, type: "text" }, [
      ["What should your computer do?", "textarea"],
      ["Run", "button"],
      ["Cancel", "button"],
      ["New session", "radio"],
      ["Continue latest", "radio"],
      ["Computer", "select"],
      ["Agent", "select"],
    ]),
  });
}

function executionStatusRegion(...blocks) {
  const text = blocks.map((block) => extractColumns(block).middle).join("\n");
  const labels = unique([
    ...extractBracketLabels(text),
    ...extractMatchingLines(text, [/Status/i, /Ready to run/i, /Running with Codex CLI/i, /Approval needed/i, /Completed/i, /Activity/i, /Result/i, /Review diff/i, /Open result/i, /Approve/i, /Deny/i]),
  ]);
  return region({
    id: "execution-status",
    name: "Current Task Execution",
    ownerSurface: "Middle column: current task execution",
    frequency: "high",
    role: "ordinary_developer",
    scenario: "Watch status and result after running a task.",
    usabilityTask: "Understand whether the task is ready, running, waiting for approval, or complete.",
    states: ["ready", "running", "approval_needed", "succeeded", "failed"],
    acceptanceSignals: [
      "Findable: current state appears in the middle column.",
      "Understandable: state copy uses plain language.",
      "Actionable: approval or result actions appear only when relevant.",
      "Traceable: result can lead to diff/session context.",
    ],
    whatNotToShow: ["raw JSONL flood", "hook event names before summaries", "private Codex session files"],
    bounds: { x: 424, y: 72, width: 456, height: 560 },
    elements: labelsToElements(labels, { x: 448, y: 104, width: 380, type: "status" }, [
      ["Approve", "button"],
      ["Deny", "button"],
      ["Review diff", "button"],
      ["Open result", "button"],
      ["Activity", "timeline"],
      ["Result", "result"],
    ]),
  });
}

function contextRailRegion(...blocks) {
  const text = blocks.map((block) => extractColumns(block).right).join("\n");
  const labels = unique([
    ...extractBracketLabels(text),
    ...extractMatchingLines(text, [/Current context/i, /Latest Managed Codex/i, /Session/i, /Repo:/i, /Agent:/i, /Mode:/i, /Last seen/i, /Status:/i, /Files changed/i, /Needs attention/i, /No approvals/i, /pending request/i, /Continue/i, /Result/i, /Open session/i, /Evidence Center/i, /Open evidence/i]),
  ]);
  return region({
    id: "context-rail",
    name: "Context, History, Governance",
    ownerSurface: "Right rail: context, history, and governance",
    frequency: "medium",
    role: "multi_role",
    scenario: "Find latest managed session and open detail without crowding the task composer.",
    usabilityTask: "Continue, view result, or open the latest managed session.",
    states: ["latest_session", "needs_attention_empty", "needs_attention_pending", "advanced_entry"],
    acceptanceSignals: [
      "Findable: latest managed session appears in the right rail.",
      "Understandable: session status and counts are summarized.",
      "Actionable: Continue, Result, and Open session are distinct.",
      "Traceable: Evidence Center is reachable as an advanced entry.",
    ],
    whatNotToShow: ["raw JSONL", "hook event names", "unfiltered evidence registry", "private Codex auth files"],
    bounds: { x: 912, y: 72, width: 376, height: 560 },
    elements: labelsToElements(labels, { x: 936, y: 104, width: 328, type: "text" }, [
      ["Continue", "button"],
      ["Result", "button"],
      ["Open session", "button", { interaction: { type: "open_surface", target: "session-detail" } }],
      ["Open evidence", "button"],
      ["Latest Managed Codex", "status"],
      ["Needs attention", "status"],
      ["Current context", "metric"],
    ]),
  });
}

function sessionTurnsRegion(block) {
  const text = extractSessionDetailColumns(block).left;
  const labels = unique(extractMatchingLines(text, [/Session turns/i, /Initial task/i, /Fix failing tests/i, /Follow-up/i, /Adjust result copy/i, /Feedback/i, /Respond to review comment/i, /ready to continue/i]));
  return region({
    id: "session-turns",
    name: "Session Turns",
    ownerSurface: "Session detail",
    frequency: "medium",
    role: "advanced_developer",
    scenario: "Inspect managed session turns.",
    usabilityTask: "Find prior turns and understand their status.",
    states: ["initial_task", "follow_up", "feedback"],
    acceptanceSignals: [
      "Findable: turn list is visible in session detail.",
      "Understandable: turn labels are plain language.",
      "Actionable: user can choose next follow-up.",
      "Traceable: each turn remains tied to managed session context.",
    ],
    whatNotToShow: ["raw JSONL flood", "private Codex session files", "imported evidence as managed proof"],
    bounds: { x: 32, y: 912, width: 420, height: 232 },
    elements: labelsToElements(labels, { x: 56, y: 944, width: 360, type: "text" }, [["Session turns", "heading"]]),
  });
}

function followUpRegion(block) {
  const text = extractSessionDetailColumns(block).right;
  const labels = unique(splitCompoundLabels([...extractBracketLabels(text), ...extractMatchingLines(text, [/Add follow-up/i, /Ask the next step/i, /Send follow-up/i, /Attach diff/i, /Follow-ups reuse/i])]));
  return region({
    id: "follow-up-composer",
    name: "Add Follow-up",
    ownerSurface: "Session detail follow-up composer",
    frequency: "medium",
    role: "advanced_developer",
    scenario: "Send feedback or a follow-up inside an existing managed session.",
    usabilityTask: "Ask the next step in this session and attach diff context if needed.",
    states: ["follow_up_ready", "diff_context_attached"],
    acceptanceSignals: [
      "Findable: Add follow-up appears only in session detail.",
      "Understandable: copy says the follow-up reuses managed session context.",
      "Actionable: send follow-up and attach diff context are separate.",
      "Traceable: follow-up creates its own evidence record.",
    ],
    whatNotToShow: ["Evidence Center as task input", "raw JSONL", "hook names", "private Codex auth files"],
    bounds: { x: 484, y: 912, width: 392, height: 232 },
    elements: labelsToElements(labels, { x: 508, y: 944, width: 336, type: "text" }, [
      ["Add follow-up", "heading"],
      ["Ask the next step", "textarea"],
      ["Send follow-up", "button"],
      ["Attach diff", "button"],
    ]),
  });
}

function region({ id, name, ownerSurface, frequency, role, scenario, usabilityTask, states, acceptanceSignals, whatNotToShow, bounds, elements }) {
  return {
    id,
    name,
    ownerSurface,
    frequency,
    role,
    productFlow: {
      roleFlow: role.replace(/_/g, " "),
      scenario,
      frequency,
      ownerSurface,
      usabilityTask,
      partialAcceptanceOrFollowUp: "Generated by ASCII import; later gates may refine layout and labels.",
    },
    prototypeStates: states,
    acceptanceSignals,
    whatNotToShow,
    bounds,
    elements: elements.length > 0 ? elements : labelsToElements([name], { x: bounds.x + 24, y: bounds.y + 32, width: bounds.width - 48, type: "text" }),
  };
}

function labelsToElements(labels, layout, typeRules = []) {
  return labels.map((rawLabel, index) => {
    const label = cleanLabel(rawLabel);
    const rule = typeRules.find(([match]) => label.toLowerCase().includes(match.toLowerCase()));
    const type = rule?.[1] ?? layout.type;
    const extra = rule?.[2] ?? {};
    return {
      id: slug(label || `element-${index + 1}`),
      type,
      label,
      ...(type === "button" ? { variant: label.toLowerCase().includes("run") || label.toLowerCase().includes("continue") || label.toLowerCase().includes("send") ? "primary" : "secondary" } : {}),
      ...extra,
      bounds: {
        x: layout.x,
        y: layout.y + index * 48,
        width: layout.width,
        height: type === "textarea" ? 88 : 36,
      },
    };
  });
}

function parseSections(content) {
  const map = new Map();
  const matches = [...content.matchAll(/^##\s+(.+)\n([\s\S]*?)(?=^##\s+|\z)/gm)];
  for (const match of matches) {
    map.set(match[1].trim(), match[2].trim());
  }
  return map;
}

function parseProductFlow(content) {
  const productFlowSection = content.match(/Product Flow:\s*\n([\s\S]*?)(?=\n##\s+)/)?.[1] ?? "";
  const result = {};
  let currentKey = "";
  for (const line of productFlowSection.split(/\r?\n/)) {
    const match = line.match(/^-\s*([^:]+):\s*(.+)$/);
    if (match) {
      currentKey = match[1].trim();
      result[currentKey] = match[2].trim();
      continue;
    }
    if (currentKey && /^\s{2,}\S/.test(line)) {
      result[currentKey] = `${result[currentKey]} ${line.trim()}`.trim();
    }
  }
  return result;
}

function parseDraftAcceptance(content) {
  const section = content.match(/## Draft Acceptance\s*\n([\s\S]*)$/)?.[1] ?? "";
  const items = section
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const item = line.match(/^-\s*(.+)$/)?.[1];
      if (item) acc.push(item);
      else if (acc.length > 0 && /^\s{2,}\S/.test(line)) acc[acc.length - 1] = `${acc[acc.length - 1]} ${line.trim()}`;
      return acc;
    }, []);
  return items.length > 0
    ? items
    : [
        "Findable: user can find the previous Codex session in the right rail.",
        "Understandable: user can tell whether the session can continue or only be inspected.",
        "Actionable: user can continue, open result, review diff, or cancel with clear consequence.",
        "Traceable: evidence remains reachable from context without dominating task flow.",
      ];
}

function importedStates(blocks) {
  const text = blocks.join("\n").toLowerCase();
  return [
    ["ready", /ready/.test(text)],
    ["running", /running/.test(text)],
    ["approval_needed", /approval needed/.test(text)],
    ["succeeded", /succeeded|completed/.test(text)],
    ["mobile_stacked", /mobile|stacked/.test(text)],
  ]
    .filter(([, present]) => present)
    .map(([state]) => state);
}

function extractMatchingLines(block, patterns) {
  return block
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean)
    .filter((line) => patterns.some((pattern) => pattern.test(line)));
}

function extractColumns(block) {
  const lines = fencedText(block);
  const header = lines.find((line) => line.includes("LEFT:") && line.includes("MIDDLE:") && line.includes("RIGHT:"));
  if (!header) return { left: lines.join("\n"), middle: "", right: "" };
  const leftStart = header.indexOf("LEFT:");
  const middleStart = header.indexOf("MIDDLE:");
  const rightStart = header.indexOf("RIGHT:");
  return {
    left: lines.map((line) => cleanLine(line.slice(leftStart, middleStart))).filter(Boolean).join("\n"),
    middle: lines.map((line) => cleanLine(line.slice(middleStart, rightStart))).filter(Boolean).join("\n"),
    right: lines.map((line) => cleanLine(line.slice(rightStart))).filter(Boolean).join("\n"),
  };
}

function extractSessionDetailColumns(block) {
  const lines = fencedText(block);
  const header = lines.find((line) => line.includes("Session turns") && line.includes("Add follow-up"));
  if (!header) return { left: lines.join("\n"), right: "" };
  const leftStart = header.indexOf("Session turns");
  const rightStart = header.indexOf("Add follow-up");
  return {
    left: lines.map((line) => cleanLine(line.slice(leftStart, rightStart))).filter(Boolean).join("\n"),
    right: lines.map((line) => cleanLine(line.slice(rightStart))).filter(Boolean).join("\n"),
  };
}

function fencedText(block) {
  const fenced = block.match(/```text\s*([\s\S]*?)```/)?.[1] ?? block;
  return fenced.split(/\r?\n/);
}

function extractBracketLabels(block) {
  const labels = [];
  for (const match of block.matchAll(/\[([^\]]+)\]/g)) {
    labels.push(match[1].trim());
  }
  return labels;
}

function cleanLine(line) {
  return line
    .replace(/[┌┐└┘├┤┬┴┼─│]/g, " ")
    .replace(/[()[\]●]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLabel(label) {
  return cleanLine(label)
    .replace(/\s+v$/i, "")
    .trim();
}

function forbiddenInTask(label) {
  const lower = label.toLowerCase();
  return ["evidence center", "import evidence", "jsonl", "hook names", "hook event", "integration builder", "session turns", "add follow-up", "latest managed codex", "needs attention", "status:"].some((term) => lower.includes(term));
}

function isTaskComposerLabel(label) {
  const normalized = label.toLowerCase().replace(/\s+/g, " ").trim();
  return [
    "what should your computer do?",
    "computer",
    "computer: this computer",
    "agent",
    "agent: codex cli",
    "codex session",
    "new session",
    "continue latest",
    "session: continue latest",
    "run",
    "run disabled",
    "cancel",
    "cancel disabled",
  ].includes(normalized);
}

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = cleanLabel(value).toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function splitCompoundLabels(values) {
  return values.flatMap((value) => {
    const label = cleanLabel(value);
    if (/send follow-up attach diff/i.test(label)) return ["Send follow-up", "Attach diff"];
    if (/continue result open session/i.test(label)) return ["Continue", "Result", "Open session"];
    if (/run disabled cancel/i.test(label)) return ["Run disabled", "Cancel"];
    if (/run cancel disabled/i.test(label)) return ["Run", "Cancel disabled"];
    if (/run cancel/i.test(label)) return ["Run", "Cancel"];
    return [label];
  });
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "element";
}

function relative(path) {
  return path.replace(`${repoRoot}\\`, "").replaceAll("\\", "/");
}
