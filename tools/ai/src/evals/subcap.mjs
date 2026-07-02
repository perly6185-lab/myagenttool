// L4 sub-capability evaluation (PM brief + issue-creation apply gate).
//
// The held-out set (heldout.mjs) measures the branch/code/PR slice of L4. This
// module measures the two sub-capabilities that gate does not exercise:
//
//   kind "pm-brief"   — capability: given an idea, does the provider produce a
//                       PM brief that is structurally complete AND classifies
//                       risk the way the product's gates demand? Judged by a
//                       deterministic oracle (required risk-flag substrings,
//                       minimum acceptance criteria, allowed risk levels).
//                       Mock provider = hermetic plumbing baseline; a real
//                       provider measures real capability.
//   kind "issue-gate" — product behavior: does the issue-tree apply gate block
//                       or allow exactly when it should? No model involved —
//                       these cases pin the gate logic itself and must pass
//                       100% (a failure is a product regression, not a
//                       capability signal).
//
// Pure module: no process.exit, no argv parsing. The eval-subcap command in
// ../index.mjs owns provider calls and evidence output.

import { escapeCell, isNonEmptyString, loadCaseSet, stringArray } from "./util.mjs";

export function validateSubcapCase(raw, source) {
  const where = source ? ` (${source})` : "";
  if (!raw || typeof raw !== "object") throw new Error(`Sub-capability case must be a JSON object${where}.`);
  if (!isNonEmptyString(raw.id)) throw new Error(`Sub-capability case needs a string id${where}.`);
  if (raw.kind !== "pm-brief" && raw.kind !== "issue-gate" && raw.kind !== "review") {
    throw new Error(`Sub-capability case ${raw.id} kind must be "pm-brief", "issue-gate", or "review"${where}.`);
  }
  if (raw.kind === "review") {
    if (!isNonEmptyString(raw.pr?.title) || !isNonEmptyString(raw.pr?.diff)) {
      throw new Error(`review case ${raw.id} needs pr.title and pr.diff${where}.`);
    }
    const oracle = raw.oracle ?? {};
    const mustFlagFiles = stringArray(oracle.mustFlagFiles);
    if (mustFlagFiles.length === 0) {
      throw new Error(`review case ${raw.id} oracle needs at least one mustFlagFiles entry (the planted-defect file)${where}.`);
    }
    // mustMention: array of any-of groups — each group is satisfied when the
    // findings text contains at least one of its synonyms, so the oracle
    // demands the MECHANISM be named without dictating exact wording.
    const mustMention = Array.isArray(oracle.mustMention)
      ? oracle.mustMention.map((group) => stringArray(group).map((word) => word.toLowerCase())).filter((group) => group.length > 0)
      : [];
    return {
      id: raw.id,
      kind: raw.kind,
      pr: { title: raw.pr.title, body: isNonEmptyString(raw.pr.body) ? raw.pr.body : "", diff: raw.pr.diff },
      oracle: { mustFlagFiles, mustMention, requireApproveFalse: raw.oracle?.requireApproveFalse !== false },
    };
  }
  if (raw.kind === "pm-brief") {
    if (!isNonEmptyString(raw.idea)) throw new Error(`pm-brief case ${raw.id} needs an idea${where}.`);
    const oracle = raw.oracle ?? {};
    // typeof guard, not Number(): Number(null)/""/false coerce to 0 and would
    // silently replace the documented default of 1 with "no minimum".
    const minAcceptanceCriteria = typeof oracle.minAcceptanceCriteria === "number" && Number.isFinite(oracle.minAcceptanceCriteria)
      ? oracle.minAcceptanceCriteria
      : 1;
    return {
      id: raw.id,
      kind: raw.kind,
      idea: raw.idea,
      oracle: {
        requiredRiskFlags: stringArray(oracle.requiredRiskFlags).map((flag) => flag.toLowerCase()),
        // Product-gate categories (exact strings from humanApprovalRequiredReasons)
        // the brief must trigger when run through the REAL issue gate — demands
        // exactly what the product gates on, immune to wording variation.
        requiredGateReasons: stringArray(oracle.requiredGateReasons),
        minAcceptanceCriteria,
        allowedRiskLevels: stringArray(oracle.allowedRiskLevels).map((level) => level.toLowerCase()),
      },
    };
  }
  if (!raw.brief || typeof raw.brief !== "object") {
    throw new Error(`issue-gate case ${raw.id} needs a brief object${where}.`);
  }
  if (typeof raw.oracle?.expectBlocked !== "boolean") {
    throw new Error(`issue-gate case ${raw.id} oracle needs a boolean expectBlocked${where}.`);
  }
  return {
    id: raw.id,
    kind: raw.kind,
    brief: raw.brief,
    approval: isNonEmptyString(raw.approval) ? raw.approval : "",
    oracle: { expectBlocked: raw.oracle.expectBlocked },
  };
}

export function loadSubcapSet(dir) {
  return loadCaseSet(dir, { validate: validateSubcapCase, label: "Sub-capability" });
}

// PM-brief oracle: structural completeness + risk classification. The primary
// risk check is `requiredGateReasons`: the brief is run through the real
// product issue gate and must trigger the named categories — so the eval
// demands exactly what the product gates on. `requiredRiskFlags` substring
// matching remains as a weaker secondary for cases with no gate category.
export function judgePmBrief(caseObj, brief, { gateReasons = [] } = {}) {
  if (!brief || typeof brief !== "object") {
    return { id: caseObj.id, kind: caseObj.kind, resolved: false, reason: "Provider returned no brief object." };
  }
  const problems = [];
  for (const field of ["outcome", "primaryUser", "problem", "userStory"]) {
    const value = brief[field];
    if (!isNonEmptyString(value) || value.trim() === "TODO") problems.push(`${field} is empty or TODO`);
  }
  const criteria = stringArray(brief.acceptanceCriteria);
  if (criteria.length < caseObj.oracle.minAcceptanceCriteria) {
    problems.push(`acceptanceCriteria ${criteria.length} < required ${caseObj.oracle.minAcceptanceCriteria}`);
  }
  for (const reason of caseObj.oracle.requiredGateReasons) {
    if (!gateReasons.includes(reason)) {
      problems.push(`brief does not trigger the product gate category "${reason}" (triggered: ${gateReasons.join(", ") || "none"})`);
    }
  }
  const riskText = stringArray(brief.riskFlags).join("\n").toLowerCase();
  for (const flag of caseObj.oracle.requiredRiskFlags) {
    if (!riskText.includes(flag)) problems.push(`risk flags do not name "${flag}"`);
  }
  if (caseObj.oracle.allowedRiskLevels.length > 0) {
    const level = String(brief.projectFields?.risk ?? "").toLowerCase().replace(/^risk\//, "");
    if (!caseObj.oracle.allowedRiskLevels.includes(level)) {
      problems.push(`projectFields.risk "${level || "missing"}" not in [${caseObj.oracle.allowedRiskLevels.join(", ")}]`);
    }
  }
  const resolved = problems.length === 0;
  return {
    id: caseObj.id,
    kind: caseObj.kind,
    resolved,
    reason: resolved ? "Brief is structurally complete with the demanded risk classification." : problems.join("; "),
  };
}

// Review oracle (planted-defect detection): the case's pr.diff contains known
// defects; the review must flag every planted file, name each defect mechanism
// (any-of synonym groups), and — by default — not approve the PR. The mock
// provider finds nothing, so the review kind's mock baseline is 0%: only a
// real reviewer can score, mirroring the held-out real set's structure.
export function judgeReview(caseObj, review) {
  if (!review || typeof review !== "object" || !Array.isArray(review.findings)) {
    return { id: caseObj.id, kind: caseObj.kind, resolved: false, reason: "Provider returned no review with a findings array." };
  }
  const problems = [];
  for (const file of caseObj.oracle.mustFlagFiles) {
    if (!review.findings.some((finding) => String(finding?.file ?? "").includes(file))) {
      problems.push(`no finding flags planted file "${file}"`);
    }
  }
  const findingsText = review.findings
    .map((finding) => [finding?.title, finding?.rationale, finding?.recommendation].filter(Boolean).join("\n"))
    .join("\n")
    .toLowerCase();
  for (const group of caseObj.oracle.mustMention) {
    if (!group.some((word) => findingsText.includes(word))) {
      problems.push(`findings do not name the defect mechanism (none of: ${group.join(", ")})`);
    }
  }
  if (caseObj.oracle.requireApproveFalse && review.approve !== false) {
    problems.push("review approved a PR with planted defects");
  }
  const resolved = problems.length === 0;
  return {
    id: caseObj.id,
    kind: caseObj.kind,
    resolved,
    reason: resolved
      ? `Review flagged the planted defect(s) and withheld approval (${review.findings.length} finding(s)).`
      : problems.join("; "),
  };
}

// Issue-gate oracle: blocked-ness must match expectation exactly.
export function judgeIssueGate(caseObj, gateResult) {
  if (!gateResult || typeof gateResult.blocked !== "boolean") {
    return { id: caseObj.id, kind: caseObj.kind, resolved: false, reason: "Gate runner returned no blocked verdict." };
  }
  const resolved = gateResult.blocked === caseObj.oracle.expectBlocked;
  const reasons = stringArray(gateResult.reasons);
  const detail = reasons.length > 0 ? ` (gate reasons: ${reasons.join(", ")})` : "";
  return {
    id: caseObj.id,
    kind: caseObj.kind,
    resolved,
    reason: resolved
      ? `Gate ${gateResult.blocked ? "blocked" : "allowed"} as expected${detail}.`
      : `Gate ${gateResult.blocked ? "blocked" : "allowed"} but expected ${caseObj.oracle.expectBlocked ? "blocked" : "allowed"}${detail}.`,
  };
}

export async function evaluateSubcapSet({ cases, pmRunner, gateRunner, briefGateReasons, reviewRunner }) {
  if (typeof pmRunner !== "function" || typeof gateRunner !== "function") {
    throw new Error("evaluateSubcapSet requires pmRunner and gateRunner functions.");
  }
  if (typeof briefGateReasons !== "function") {
    throw new Error("evaluateSubcapSet requires a briefGateReasons function (brief -> product gate categories).");
  }
  if (cases.some((caseObj) => caseObj.kind === "review") && typeof reviewRunner !== "function") {
    throw new Error("evaluateSubcapSet requires a reviewRunner function when the set contains review cases.");
  }
  const results = [];
  for (const caseObj of cases) {
    try {
      if (caseObj.kind === "pm-brief") {
        const brief = await pmRunner(caseObj);
        results.push(judgePmBrief(caseObj, brief, { gateReasons: brief && typeof brief === "object" ? briefGateReasons(brief) : [] }));
      } else if (caseObj.kind === "review") {
        results.push(judgeReview(caseObj, await reviewRunner(caseObj)));
      } else {
        results.push(judgeIssueGate(caseObj, await gateRunner(caseObj)));
      }
    } catch (error) {
      results.push({ id: caseObj.id, kind: caseObj.kind, resolved: false, reason: `Runner threw: ${error.message}` });
    }
  }
  const total = results.length;
  const resolved = results.filter((r) => r.resolved).length;
  const byKind = {};
  for (const result of results) {
    const kind = (byKind[result.kind] ??= { total: 0, resolved: 0 });
    kind.total += 1;
    if (result.resolved) kind.resolved += 1;
  }
  return { total, resolved, passRate: total === 0 ? 0 : resolved / total, byKind, results };
}

export function formatSubcapReport(summary, { setDir, provider } = {}) {
  const pct = (summary.passRate * 100).toFixed(1);
  const kinds = Object.entries(summary.byKind ?? {})
    .map(([kind, k]) => `${kind} ${k.resolved}/${k.total}`)
    .join(" · ");
  const lines = [
    "# L4 Sub-capability Evaluation",
    "",
    `Pass rate: ${pct}% (${summary.resolved}/${summary.total})`,
    kinds ? `By kind: ${kinds}` : null,
    provider ? `PM provider: ${provider} (issue-gate cases are provider-independent product checks)` : null,
    setDir ? `Set: ${setDir}` : null,
    "",
    "| Case | Kind | Resolved | Reason |",
    "| --- | --- | --- | --- |",
    ...summary.results.map((r) => `| ${r.id} | ${r.kind} | ${r.resolved ? "yes" : "no"} | ${escapeCell(r.reason)} |`),
    "",
  ].filter((line) => line !== null);
  return `${lines.join("\n")}\n`;
}

