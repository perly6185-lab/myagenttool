// L4 held-out evaluation harness.
//
// Purpose: replace L4's structural "does an adapter contract slot exist" check
// with a measured pass rate on a local held-out set of real issues. See
// docs/engineering/L4_HELDOUT_EVAL.md and docs/engineering/MATURITY_CALIBRATION.md.
//
// This module is pure/testable: no process.exit, no argv parsing. The command
// wrapper in ../index.mjs handles CLI concerns and evidence output.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// A resolver turns one held-out case into a resolution attempt. The mock
// resolver stands in for current coding capability so the harness stays
// hermetic; real capability plugs in via a command resolver (see index.mjs).
//   resolver(caseObj) -> { changedFiles: string[], notes?: string }

export function validateHeldoutCase(raw, source) {
  const where = source ? ` (${source})` : "";
  if (!raw || typeof raw !== "object") throw new Error(`Held-out case must be a JSON object${where}.`);
  if (!isNonEmptyString(raw.id)) throw new Error(`Held-out case needs a string id${where}.`);
  if (!isNonEmptyString(raw.title)) throw new Error(`Held-out case ${raw.id} needs a title${where}.`);
  if (!isNonEmptyString(raw.spec)) throw new Error(`Held-out case ${raw.id} needs a spec${where}.`);
  const oracle = raw.oracle ?? {};
  const expectedFiles = stringArray(oracle.expectedFiles);
  const forbiddenFiles = stringArray(oracle.forbiddenFiles);
  if (expectedFiles.length === 0) {
    throw new Error(`Held-out case ${raw.id} oracle needs at least one expectedFiles entry${where}.`);
  }
  const verify = validateVerifyOracle(raw.id, oracle.verify, where);
  return {
    id: raw.id,
    issue: isNonEmptyString(raw.issue) ? raw.issue : String(raw.id),
    title: raw.title,
    spec: raw.spec,
    risk: isNonEmptyString(raw.risk) ? raw.risk : "unknown",
    // Optional git ref the resolver should base its worktree on. Real cases
    // mined from history pin this to the parent of the original fix commit so
    // the change does not already exist in the tree being evaluated.
    base: isNonEmptyString(raw.base) ? raw.base : "",
    oracle: { expectedFiles, forbiddenFiles, verify },
    mock: {
      changedFiles: stringArray(raw.mock?.changedFiles),
      note: isNonEmptyString(raw.mock?.note) ? raw.mock.note : "",
      verify: normalizeVerifyResult(raw.mock?.verify),
    },
  };
}

// Behavior oracle: a command run inside the resolved worktree.
//   mode "fail-to-pass": SWE-bench discipline — the command must FAIL at the
//     case's base (proving it probes the missing behavior) and PASS after the
//     agent's change. A command that already passes at base is vacuous and the
//     case is marked unresolved so the set author fixes the probe.
//   mode "regression": the command must pass after the change (passing at base
//     is fine). Weaker — guards "the agent broke the tool", not "the behavior
//     is correct". Labeled as such in results.
function validateVerifyOracle(id, raw, where) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") throw new Error(`Held-out case ${id} oracle.verify must be an object${where}.`);
  const mode = raw.mode;
  if (mode !== "fail-to-pass" && mode !== "regression") {
    throw new Error(`Held-out case ${id} oracle.verify.mode must be "fail-to-pass" or "regression"${where}.`);
  }
  const command = stringArray(raw.command);
  if (command.length === 0) {
    throw new Error(`Held-out case ${id} oracle.verify.command must be a non-empty string array${where}.`);
  }
  const timeoutMs = raw.timeoutMs === undefined ? 120000 : Number(raw.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Held-out case ${id} oracle.verify.timeoutMs must be a positive number${where}.`);
  }
  return { mode, command, timeoutMs };
}

function normalizeVerifyResult(raw) {
  if (raw === undefined || raw === null || typeof raw !== "object") return null;
  const baseStatus = Number.isFinite(Number(raw.baseStatus)) ? Number(raw.baseStatus) : null;
  const status = Number.isFinite(Number(raw.status)) ? Number(raw.status) : null;
  return { baseStatus, status };
}

export function loadHeldoutSet(dir) {
  if (!existsSync(dir)) throw new Error(`Held-out set directory not found: ${dir}`);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (files.length === 0) throw new Error(`Held-out set has no *.json cases: ${dir}`);
  const cases = [];
  const seen = new Set();
  for (const name of files) {
    const full = resolve(dir, name);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(full, "utf8"));
    } catch (error) {
      throw new Error(`Held-out case ${name} is not valid JSON: ${error.message}`);
    }
    const validated = validateHeldoutCase(parsed, name);
    if (seen.has(validated.id)) throw new Error(`Duplicate held-out case id: ${validated.id} (${name})`);
    seen.add(validated.id);
    cases.push(validated);
  }
  return cases;
}

// Oracle: a case is resolved when the resolver touched every expected file,
// touched nothing under a forbidden prefix (scope discipline), touched at
// least one file — and, when a verify oracle is present, the behavior probe
// holds (see validateVerifyOracle for the fail-to-pass / regression modes).
// Deterministic, no glob dependency.
export function judgeCase(caseObj, resolution) {
  const changed = stringArray(resolution?.changedFiles);
  const { expectedFiles, forbiddenFiles, verify } = caseObj.oracle;
  const missing = expectedFiles.filter((file) => !changed.includes(file));
  const violated = changed.filter((file) => forbiddenFiles.some((prefix) => underPrefix(file, prefix)));
  const filesOk = changed.length > 0 && missing.length === 0 && violated.length === 0;
  const verifyOutcome = judgeVerify(verify, resolution?.verify);
  const resolved = filesOk && verifyOutcome.ok;
  let reason;
  if (!filesOk) {
    if (changed.length === 0) reason = "Resolver produced no file changes.";
    else if (missing.length > 0) reason = `Missing expected files: ${missing.join(", ")}.`;
    else reason = `Touched forbidden files: ${violated.join(", ")}.`;
  } else if (!verifyOutcome.ok) {
    reason = verifyOutcome.reason;
  } else {
    reason = verify
      ? `All expected files changed, no scope violations, ${verifyOutcome.reason}`
      : "All expected files changed with no scope violations.";
  }
  return { id: caseObj.id, resolved, reason, changedFiles: changed, missing, violated, verify: verifyOutcome.detail };
}

function judgeVerify(verifyOracle, verifyResult) {
  if (!verifyOracle) return { ok: true, reason: "", detail: null };
  const detail = normalizeVerifyResult(verifyResult);
  if (!detail || detail.status === null) {
    return { ok: false, reason: "Verify oracle present but the resolver returned no verify result.", detail };
  }
  if (verifyOracle.mode === "fail-to-pass") {
    if (detail.baseStatus === null) {
      return { ok: false, reason: "fail-to-pass verify needs a base run; resolver returned none.", detail };
    }
    if (detail.baseStatus === 0) {
      return { ok: false, reason: "Verify command already passes at base (vacuous probe — fix the case).", detail };
    }
    if (detail.status !== 0) {
      return { ok: false, reason: `Verify command still fails after the change (exit ${detail.status}).`, detail };
    }
    return { ok: true, reason: "verify went fail(base)->pass.", detail };
  }
  if (detail.status !== 0) {
    return { ok: false, reason: `Regression verify failed after the change (exit ${detail.status}).`, detail };
  }
  return { ok: true, reason: "regression verify passed (behavior-correctness not proven).", detail };
}

export async function evaluateHeldoutSet({ cases, resolver }) {
  if (typeof resolver !== "function") throw new Error("evaluateHeldoutSet requires a resolver function.");
  const results = [];
  for (const caseObj of cases) {
    let resolution;
    try {
      resolution = await resolver(caseObj);
    } catch (error) {
      results.push({ id: caseObj.id, resolved: false, reason: `Resolver threw: ${error.message}`, changedFiles: [], missing: caseObj.oracle.expectedFiles, violated: [] });
      continue;
    }
    results.push({ ...judgeCase(caseObj, resolution), notes: resolution?.notes ?? "" });
  }
  const total = results.length;
  const resolved = results.filter((r) => r.resolved).length;
  const passRate = total === 0 ? 0 : resolved / total;
  return { total, resolved, passRate, results };
}

export function mockResolver(caseObj) {
  return {
    changedFiles: caseObj.mock.changedFiles,
    notes: caseObj.mock.note || "mock resolver",
    verify: caseObj.mock.verify,
  };
}

export function formatHeldoutReport(summary, { setDir, resolverName } = {}) {
  const pct = (summary.passRate * 100).toFixed(1);
  const lines = [
    "# L4 Held-out Evaluation",
    "",
    `Pass rate: ${pct}% (${summary.resolved}/${summary.total})`,
    resolverName ? `Resolver: ${resolverName}` : null,
    setDir ? `Set: ${setDir}` : null,
    "",
    "| Case | Resolved | Reason |",
    "| --- | --- | --- |",
    ...summary.results.map((r) => `| ${r.id} | ${r.resolved ? "yes" : "no"} | ${escapeCell(r.reason)} |`),
    "",
  ].filter((line) => line !== null);
  return `${lines.join("\n")}\n`;
}

function underPrefix(file, prefix) {
  if (file === prefix) return true;
  const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return file.startsWith(normalized);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value) {
  return Array.isArray(value) ? value.map(String).filter((item) => item.length > 0) : [];
}

function escapeCell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
}
