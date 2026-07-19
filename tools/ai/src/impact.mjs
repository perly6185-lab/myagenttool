// ai:impact — generate the Change Impact & Risk Assessment (CONTRIBUTING.md) from
// a git diff. Deterministic and offline by default so it is testable and works
// without a model; `--provider openai|command` refines the judgment fields.
//
// Pure functions only — the command wiring (git, gh, provider) lives in index.mjs.

// A source file under a runnable app/package `src/` tree — i.e. on the runtime
// import graph, not tooling or docs.
const RUNTIME_SRC_RE = /^(apps\/(server|desktop|web)|packages\/(protocol|adapters))\/src\//;
// Product-runtime business-flow surfaces (invocation → dispatch → bridge, etc.).
const BUSINESS_FLOW_RE =
  /^(apps\/server\/src\/(services|routes|runtime)\/|apps\/desktop\/src\/|packages\/protocol\/src\/)/;
// Paths whose change is inherently higher-risk regardless of size.
const HIGH_RISK_RE = /(security|auth|credential|secret|billing|adapter|local-execution|bridge|approval|elevation)/i;

export function classifyKind(path) {
  if (/(^|\/)test\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) return "test";
  if (path.startsWith("docs/") || path.endsWith(".md")) return "docs";
  if (
    /\.(json|ya?ml|lock)$/.test(path) ||
    path.startsWith(".github/") ||
    path.endsWith(".gitignore") ||
    /(^|\/)tsconfig[^/]*\.json$/.test(path)
  )
    return "config";
  if (/\.(mjs|cjs|js|tsx?|jsx)$/.test(path)) return "source";
  return "other";
}

export function onRuntimeImportGraph(path, kind = classifyKind(path)) {
  return kind === "source" && RUNTIME_SRC_RE.test(path);
}

export function touchesBusinessFlow(path, kind = classifyKind(path)) {
  return kind === "source" && BUSINESS_FLOW_RE.test(path);
}

// git status letters → our change verb. Rename (R)/copy (C) report the new path.
const CHANGE_BY_CODE = { A: "add", M: "edit", D: "delete", R: "edit", C: "add", T: "edit" };

export function parseNameStatus(text) {
  const changes = [];
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\t/);
    const code = (parts[0] ?? "").trim()[0];
    const path = (parts[parts.length - 1] ?? "").trim(); // new path for renames
    if (!path) continue;
    changes.push({ path, change: CHANGE_BY_CODE[code] ?? "edit", kind: classifyKind(path) });
  }
  return changes;
}

function topArea(path) {
  const parts = path.split("/");
  if (["apps", "packages", "tools"].includes(parts[0]) && parts.length > 1) {
    return parts.slice(0, 2).join("/");
  }
  return parts[0] || path;
}

export function assessChanges(changes) {
  const list = Array.isArray(changes) ? changes : [];
  const anyBusiness = list.some((c) => touchesBusinessFlow(c.path, c.kind));
  const anyRuntime = list.some((c) => onRuntimeImportGraph(c.path, c.kind));
  const anyHighRisk = list.some((c) => HIGH_RISK_RE.test(c.path));
  const onlySafe =
    list.length > 0 && list.every((c) => c.kind === "docs" || c.kind === "test" || c.kind === "config");

  const risk = anyHighRisk ? "high" : anyBusiness ? "medium" : onlySafe ? "low" : "medium";
  const riskReason = anyHighRisk
    ? "touches a security / credential / adapter / local-execution / bridge path"
    : anyBusiness
      ? "changes product-runtime source (services / routes / runtime / bridge / protocol)"
      : onlySafe
        ? "docs / test / config only"
        : "source change outside the product-runtime path (e.g. tooling)";

  return {
    changes: list,
    touchesBusinessFlow: anyBusiness,
    onRuntimeImportGraph: anyRuntime,
    risk,
    riskReason,
    blastRadius: [...new Set(list.map((c) => topArea(c.path)))],
    rollback: onlySafe || !anyBusiness ? "low" : "medium",
    heuristic: true,
  };
}

export function renderImpactMarkdown(assessment, { note } = {}) {
  const a = assessment ?? {};
  const changes = Array.isArray(a.changes) ? a.changes : [];
  const lines = ["## Change Impact & Risk Assessment", ""];
  if (note) lines.push(`_${note}_`, "");
  lines.push("- Changes:");
  if (changes.length === 0) {
    lines.push("    - (none)");
  } else {
    for (const c of changes) lines.push(`    - \`${c.path}\` · ${c.change} · ${c.kind}`);
  }
  const bizNote = a.businessFlowNote ? ` — ${a.businessFlowNote}` : "";
  lines.push(`- Touches business flow: ${a.touchesBusinessFlow ? "yes" : "no"}${bizNote}`);
  lines.push(`- On the runtime import graph: ${a.onRuntimeImportGraph ? "yes" : "no"}`);
  lines.push(`- Risk: ${a.risk ?? "unknown"}${a.riskReason ? ` — ${a.riskReason}` : ""}`);
  lines.push(`- Blast radius: ${(a.blastRadius ?? []).join(", ") || "none"}`);
  lines.push(`- Rollback cost: ${a.rollback ?? "unknown"}`);
  return `${lines.join("\n")}\n`;
}
