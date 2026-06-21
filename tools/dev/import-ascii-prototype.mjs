import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const asciiPath = resolve(repoRoot, ".myagenttool/runs/flow-validation-managed-session-history/ascii-prototype.md");
const canvasRoot = resolve(repoRoot, "docs/design/prototypes/canvas");
const outPath = resolve(canvasRoot, "managed-session-history.imported.scene.json");

const ascii = readFileSync(asciiPath, "utf8");
const sections = parseSections(ascii);
const productFlow = parseProductFlow(ascii);

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
console.log(`[import-ascii-prototype] wrote ${relative(outPath)}`);

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
