// #1051: the server-side bound on a completed claude.plan.change result. The
// wrapper caps its own output too, but the wrapper is device-side code whose
// output the server must not trust to self-limit — the AUTHORITATIVE cap is
// applied here, at completion, before the result is persisted or read: the
// public state can never carry an unbounded plan (same posture as the proposal
// patch preview bound / #913 stamps).

import { CLAUDE_PLAN_CHANGE_TOOL_CONTRACT } from "./claude-plan-change-agent.mjs";

const CAPS = {
  summary: 400,
  testStrategy: 1200,
  steps: { count: 16, title: 200, detail: 600 },
  affectedFiles: { count: 24, length: 300 },
  risks: { count: 12, length: 400 },
  outOfScope: { count: 8, length: 300 },
};

const boundedText = (value, max) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, max) : null;
};

const boundedStringList = (value, { count, length }) =>
  (Array.isArray(value) ? value : [])
    .map((item) => boundedText(item, length))
    .filter(Boolean)
    .slice(0, count);

/**
 * Cap a completed plan result in place. No-ops for anything that is not a
 * succeeded claude.plan.change output object. Returns the capped output or null.
 */
export function capClaudePlanResult({ invocation, result }) {
  const meta = invocation?.options?.metadata ?? {};
  if (meta.tool !== CLAUDE_PLAN_CHANGE_TOOL_CONTRACT.name) return null;
  const output = result?.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  output.summary = boundedText(output.summary, CAPS.summary);
  output.testStrategy = boundedText(output.testStrategy, CAPS.testStrategy);
  output.steps = (Array.isArray(output.steps) ? output.steps : [])
    .map((step) => {
      if (!step || typeof step !== "object" || Array.isArray(step)) return null;
      const title = boundedText(step.title, CAPS.steps.title);
      return title ? { title, detail: boundedText(step.detail, CAPS.steps.detail) ?? "" } : null;
    })
    .filter(Boolean)
    .slice(0, CAPS.steps.count);
  output.affectedFiles = boundedStringList(output.affectedFiles, CAPS.affectedFiles);
  output.risks = boundedStringList(output.risks, CAPS.risks);
  output.outOfScope = boundedStringList(output.outOfScope, CAPS.outOfScope);
  return output;
}
