// PR risk-evidence predicates — the single source of truth for what "carries
// the required risk-evidence route" means. Used by BOTH the per-PR governance
// gate (check-pr) and the L3 governance report (governance-report), so the
// measured coverage can never drift from what the gate enforces.
//
// Moved verbatim from index.mjs (which runs main() on import and therefore
// cannot be imported by the reporter).

export function hasVerificationEvidence(body) {
  return /Verification/i.test(body) && /(pnpm|npm|test|check|smoke|manual|pass|passed)/i.test(body);
}

export function hasAcceptanceMention(body) {
  return /Acceptance/i.test(body) || /Closes\s+#\d+/i.test(body);
}

export function reviewRiskWarnings(files, body, prNumber) {
  return reviewRiskGates(files, body, prNumber).warnings;
}

export function reviewRiskGates(files, body, prNumber, options = {}) {
  const normalizedFiles = files.map(normalizePath);
  const warnings = [];
  const failures = [];
  const prefix = prNumber ? `PR #${prNumber}` : "PR";
  const missing = (message) => {
    if (options.failOnRiskWarnings) failures.push(message);
    else warnings.push(message);
  };

  if (normalizedFiles.some(isWebFile) && !hasVisualEvidence(body)) {
    missing(`${prefix} changes web UI files but does not mention visual QA screenshot evidence`);
  }

  if (normalizedFiles.some(isProductFacingFile) && !hasProductFlowEvidence(body)) {
    missing(`${prefix} changes product-facing UI/workflow files but does not mention Product Flow coverage`);
  }

  if (normalizedFiles.some(isDesktopOrLocalExecutionFile) && !hasDesktopEvidence(body)) {
    missing(`${prefix} changes desktop or local execution files but does not mention cross-platform execution/cancellation evidence`);
  }

  if (normalizedFiles.some(isProtocolFile) && !hasProtocolEvidence(body)) {
    missing(`${prefix} changes protocol/state-machine files but does not mention state-machine or schema compatibility evidence`);
  }

  if (normalizedFiles.some(isAdapterFile) && !hasAdapterEvidence(body)) {
    missing(`${prefix} changes adapter files but does not mention success, failure, cancellation, or redaction evidence`);
  }

  if (normalizedFiles.some(isSecurityDataBillingFile) && !hasSecurityDataBillingEvidence(body)) {
    missing(`${prefix} changes security/data/billing files but does not mention security/data/privacy, billing/cost, credential, audit, or retention evidence`);
  }

  if (normalizedFiles.some(isPrivilegedExecutionFile) && !hasSecurityReviewEvidence(body)) {
    missing(`${prefix} changes a governed registry / execution surface (applications, capabilities, tools, agent wrappers, or the Desktop Bridge) but does not mention a security review (tenancy scoping, path confinement, approval enforcement, or injection)`);
  }

  if (normalizedFiles.some(isReleaseFile) && !hasReleaseEvidence(body)) {
    missing(`${prefix} changes release/deploy files but does not mention release, rollback, deploy preflight, or human approval evidence`);
  }

  return { warnings, failures };
}

export function prFilePath(file) {
  return typeof file === "string" ? file : file.path ?? file.filename ?? file.name ?? "";
}

export function isWebFile(file) {
  return file.startsWith("apps/web/") || file === "docs/engineering/VISUAL_QA.md";
}

export function isProductFacingFile(file) {
  return file.startsWith("apps/web/")
    || file === "DESIGN.md"
    || file.startsWith("docs/design/")
    || file === "docs/engineering/VISUAL_QA.md";
}

export function isDesktopOrLocalExecutionFile(file) {
  return file.startsWith("apps/desktop/") || /desktop|bridge|local-execution|process|cancel/i.test(file);
}

export function isProtocolFile(file) {
  return file.startsWith("packages/protocol/") || /state-machine|schema|protocol/i.test(file);
}

export function isAdapterFile(file) {
  return file.startsWith("packages/adapters/") || /adapter|coding-wrapper/i.test(file);
}

export function isSecurityDataBillingFile(file) {
  return /security|auth|credential|secret|billing|cost|quota|settlement|chargeback|audit|data[-_]governance|data[-_]retention|privacy/i.test(file);
}

// Governed registry / facade services + routes, agent wrappers that spawn
// processes, and the Desktop Bridge (spawns + injects governed args). These
// carry tenancy, path-confinement, approval, and injection risk that the
// prose-only gates above do not force an author to address — the class of bug
// that shipped green in the application capability registry (#270).
export function isPrivilegedExecutionFile(file) {
  return /\/(applications|capabilities|tools)\.mjs$/i.test(file)
    || /tools\/agents\/[^/]*-wrapper\.mjs$/i.test(file)
    || /apps\/desktop\/src\/index\.mjs$/i.test(file);
}

export function isReleaseFile(file) {
  return file.startsWith("tools/release/") || file.startsWith("tools/deploy/") || /\.github\/workflows\/(release|deploy)\.yml$/i.test(file) || /release|deploy|rollback|version/i.test(file);
}

export function hasVisualEvidence(body) {
  return /visual qa.*(screenshot|desktop|mobile|viewport)|screenshot.*(desktop|mobile|viewport)|desktop viewport.*mobile viewport/i.test(body);
}

export function hasProductFlowEvidence(body) {
  const flow = parseProductFlowEvidence(body);
  return Boolean(flow)
    && /^(ordinary developer|advanced developer|team administrator|auditor|multi-role)/i.test(flow.roleFlow)
    && [flow.scenario, flow.frequency, flow.ownerSurface, flow.usabilityTask, flow.whatNotToShow, flow.partialAcceptanceOrFollowUp]
      .every((value) => value && !isPlaceholderProductFlowValue(value));
}

export function parseProductFlowEvidence(body) {
  if (!/##\s+Product Flow/i.test(body)) return null;
  const section = body.match(/##\s+Product Flow\s*([\s\S]*?)(?:\n##\s+|$)/i)?.[1] ?? "";
  const field = (label) => section.match(new RegExp(`${label}:\\s*(.+)`, "i"))?.[1]?.trim() ?? "";
  return {
    roleFlow: field("Role flow"),
    scenario: field("Scenario"),
    frequency: field("Frequency"),
    ownerSurface: field("Owner surface"),
    usabilityTask: field("Usability task"),
    whatNotToShow: field("What not to show"),
    partialAcceptanceOrFollowUp: field("Partial acceptance or follow-up"),
  };
}

export function isPlaceholderProductFlowValue(value) {
  return /not applicable|requires product-flow triage|update if|must cite docs\/design\/product_flows|todo|n\/a/i.test(String(value ?? ""));
}

export function hasDesktopEvidence(body) {
  return /(windows|macos|linux|cross-platform).*(execution|process|cancel)|cancel.*(windows|macos|linux|cross-platform)|desktop bridge/i.test(body);
}

export function hasProtocolEvidence(body) {
  return /state-machine|schema|compatibility|protocol/i.test(body);
}

export function hasAdapterEvidence(body) {
  return /adapter.*(success|failure|cancel|redaction)|success.*failure.*cancel|adapter-result/i.test(body);
}

export function hasSecurityDataBillingEvidence(body) {
  return /security\/data review|security review|privacy.*(retention|impact|review)|data.*(retention|privacy|audit|impact)|credential.*(redaction|rotation|review)|billing.*(cost|quota|review)|cost.*(quota|billing|impact)|audit evidence/i.test(body);
}

// A registry/execution PR must carry a structured `## Security Review` section
// that explicitly addresses each class of bug that shipped green in #270:
// tenancy scoping, filesystem/path confinement, approval enforcement, and
// process/command injection. A prose blurb is not enough (#270 had one, and it
// was wrong) — each field must be a specific, non-placeholder statement.
export function parseSecurityReviewEvidence(body) {
  if (!/##\s+Security Review/i.test(body ?? "")) return null;
  const section = (body ?? "").match(/##\s+Security Review\s*([\s\S]*?)(?:\n##\s+|$)/i)?.[1] ?? "";
  const field = (label) => section.match(new RegExp(`${label}:\\s*(.+)`, "i"))?.[1]?.trim() ?? "";
  return {
    tenancy: field("Tenancy"),
    filesystem: field("Filesystem"),
    approval: field("Approval"),
    injection: field("Injection"),
  };
}

export function isPlaceholderSecurityReviewValue(value) {
  return /^(?:not applicable|n\/a|na|none|todo|tbd|update if|\.|-)?$/i.test(String(value ?? "").trim());
}

export function hasSecurityReviewEvidence(body) {
  const review = parseSecurityReviewEvidence(body);
  return Boolean(review)
    && [review.tenancy, review.filesystem, review.approval, review.injection]
      .every((value) => value && !isPlaceholderSecurityReviewValue(value));
}

export function hasReleaseEvidence(body) {
  return /release.*(rollback|notes|evidence)|rollback.*(plan|notes|evidence)|deploy preflight|deployment preflight|human approval.*(release|deploy|production)|environment approval|production gate/i.test(body);
}

export function normalizePath(path) {
  return path.replace(/\\/g, "/");
}
