import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export const WECHAT_DRAFT_SYNC_CAPABILITY = "app.app_wechat_official.draft_sync";
export const WECHAT_DRAFT_SYNC_APPROVAL_ACTION = "agent:draft_sync";

const MAX_PACKAGE_BYTES = 1024 * 1024;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/i;

export function validateWechatDraftArticlePackage(articlePackage) {
  if (!articlePackage || typeof articlePackage !== "object" || Array.isArray(articlePackage)) {
    return failure("wechat_draft_article_package_invalid");
  }
  const title = String(articlePackage.title ?? "").trim();
  const contentHtml = String(articlePackage.contentHtml ?? "").trim();
  const packageDigest = String(articlePackage.packageDigest ?? "").trim().toLowerCase();
  if (!title || !contentHtml || !SHA256_DIGEST.test(packageDigest)) {
    return failure("wechat_draft_article_package_contract_invalid", {
      missing: [
        !title ? "title" : null,
        !contentHtml ? "contentHtml" : null,
        !SHA256_DIGEST.test(packageDigest) ? "packageDigest" : null,
      ].filter(Boolean),
    });
  }
  return { ok: true, title, packageDigest };
}

export function loadWechatDraftArticlePackage({ state, workItem } = {}) {
  const project = (state?.projects ?? []).find((candidate) => candidate.id === workItem?.projectId) ?? null;
  if (!project?.path) return failure("wechat_draft_project_missing");
  const candidates = (workItem?.inputAssets ?? []).filter((asset) =>
    asset?.id && String(asset.path ?? asset.originalName ?? "").toLowerCase().endsWith(".json"));
  if (candidates.length !== 1) return failure("wechat_draft_article_package_required", { candidateCount: candidates.length });

  try {
    const root = realpathSync(project.path);
    const requested = resolve(root, String(candidates[0].path ?? candidates[0].originalName));
    if (!inside(root, requested) || !existsSync(requested) || lstatSync(requested).isSymbolicLink()) {
      return failure("wechat_draft_article_package_outside_project");
    }
    const actual = realpathSync(requested);
    if (!inside(root, actual)) return failure("wechat_draft_article_package_outside_project");
    const size = statSync(actual).size;
    if (size <= 0 || size > MAX_PACKAGE_BYTES) return failure("wechat_draft_article_package_size_invalid", { size });
    const bytes = readFileSync(actual);
    const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (!String(candidates[0].hash ?? "").startsWith("sha256:")) {
      return failure("wechat_draft_article_package_unversioned");
    }
    if (candidates[0].hash !== hash) {
      return failure("wechat_draft_article_package_changed", { expectedHash: candidates[0].hash, actualHash: hash });
    }
    const articlePackage = JSON.parse(bytes.toString("utf8"));
    if (!articlePackage || typeof articlePackage !== "object" || Array.isArray(articlePackage)) {
      return failure("wechat_draft_article_package_invalid");
    }
    return {
      ok: true,
      articlePackage,
      asset: { ...candidates[0] },
      absolutePath: actual,
      projectRoot: root,
    };
  } catch (error) {
    return failure("wechat_draft_article_package_invalid", { reason: String(error?.message ?? error).slice(0, 300) });
  }
}

export function parseWechatDraftInvocationResult(invocation) {
  const output = invocation?.result?.output;
  const text = typeof output === "string"
    ? output
    : output && typeof output === "object" && typeof output.output === "string"
      ? output.output
      : null;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseWechatDraftResultText(text) {
  try {
    const parsed = JSON.parse(String(text ?? ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const status = String(parsed.status ?? "");
    const sideEffectState = String(parsed.sideEffectState ?? "");
    if (!["succeeded", "failed", "needs_user_action", "unconfirmed", "session_expired", "site_layout_changed"].includes(status)
      || !["not_started", "started", "confirmed", "unknown"].includes(sideEffectState)) return null;
    return {
      status,
      sideEffectState,
      summary: String(parsed.summary ?? "").slice(0, 1_000),
      errorCode: parsed.errorCode ? String(parsed.errorCode).slice(0, 200) : null,
      retryable: parsed.retryable === true,
      userAction: parsed.userAction && typeof parsed.userAction === "object"
        ? {
            kind: String(parsed.userAction.kind ?? "").slice(0, 80),
            message: String(parsed.userAction.message ?? "").slice(0, 500),
          }
        : null,
      receipt: parsed.receipt && typeof parsed.receipt === "object"
        ? {
            packageDigest: String(parsed.receipt.packageDigest ?? "").slice(0, 100),
            title: String(parsed.receipt.title ?? "").slice(0, 100),
            editorUrl: parsed.receipt.editorUrl ? String(parsed.receipt.editorUrl).slice(0, 2_048) : null,
            pageContractVersion: String(parsed.receipt.pageContractVersion ?? "").slice(0, 100),
          }
        : null,
    };
  } catch {
    return null;
  }
}

export function validateWechatDraftSuccessReceipt({ result, expectedPackageDigest = null, expectedTitle = null } = {}) {
  if (result?.status !== "succeeded" || result?.sideEffectState !== "confirmed") {
    return failure(result?.errorCode ?? "wechat_draft_receipt_unconfirmed", { result });
  }
  const receipt = result.receipt;
  const packageDigest = String(receipt?.packageDigest ?? "").trim().toLowerCase();
  const title = String(receipt?.title ?? "").trim();
  if (!receipt || !title || !SHA256_DIGEST.test(packageDigest)) {
    return failure("wechat_draft_receipt_invalid", {
      result,
      failedChecks: [
        !receipt ? "receipt_missing" : null,
        !title ? "receipt_title_missing" : null,
        !SHA256_DIGEST.test(packageDigest) ? "receipt_package_digest_invalid" : null,
      ].filter(Boolean),
    });
  }
  if (expectedPackageDigest && packageDigest !== String(expectedPackageDigest).trim().toLowerCase()) {
    return failure("wechat_draft_receipt_package_mismatch", {
      result,
      expectedPackageDigest,
      actualPackageDigest: packageDigest,
      failedChecks: ["receipt_package_digest_mismatch"],
    });
  }
  if (expectedTitle && title !== String(expectedTitle).trim()) {
    return failure("wechat_draft_receipt_title_mismatch", {
      result,
      expectedTitle,
      actualTitle: title,
      failedChecks: ["receipt_title_mismatch"],
    });
  }
  const checks = ["status_confirmed", "receipt_present"];
  if (expectedPackageDigest) checks.push("package_digest_match");
  if (expectedTitle) checks.push("title_match");
  return { ok: true, result, checks };
}

export function materializeWechatDraftReceipt({ state, invocation, workItem, expectedPackageDigest = null, expectedTitle = null } = {}) {
  const result = parseWechatDraftInvocationResult(invocation);
  if (invocation?.status !== "succeeded") {
    return failure(result?.errorCode ?? "wechat_draft_receipt_unconfirmed", { result });
  }
  const validation = validateWechatDraftSuccessReceipt({ result, expectedPackageDigest, expectedTitle });
  if (!validation.ok) {
    return validation;
  }
  const project = (state?.projects ?? []).find((candidate) => candidate.id === workItem?.projectId) ?? null;
  if (!project?.path) return failure("wechat_draft_project_missing");
  try {
    const root = realpathSync(project.path);
    const relativePath = join(".myagenttool", "receipts", "wechat-official", `${invocation.id}.json`);
    const target = resolve(root, relativePath);
    if (!inside(root, target)) return failure("wechat_draft_receipt_path_invalid");
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const payload = `${JSON.stringify({
      schemaVersion: 1,
      invocationId: invocation.id,
      workItemId: workItem.id,
      completedAt: invocation.completedAt ?? null,
      status: result.status,
      sideEffectState: result.sideEffectState,
      summary: result.summary ?? null,
      receipt: result.receipt ?? null,
    }, null, 2)}\n`;
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, payload, { mode: 0o600 });
    renameSync(temporary, target);
    const hash = `sha256:${createHash("sha256").update(payload).digest("hex")}`;
    return {
      ok: true,
      result,
      asset: {
        id: `wechat_receipt_${createHash("sha256").update(invocation.id).digest("hex").slice(0, 24)}`,
        originalName: `${invocation.id}.json`,
        path: relative(root, target).split(sep).join("/"),
        family: "text",
        mimeType: "application/json",
        terminalId: workItem.terminalId,
        size: Buffer.byteLength(payload),
        resourceClass: "small",
        hash,
        version: invocation.id,
        worktreeId: null,
        capabilities: ["discover", "preview", "inspect", "attach_evidence"],
        readiness: { state: "ready", reason: "wechat_draft_save_confirmed" },
      },
    };
  } catch (error) {
    return failure("wechat_draft_receipt_write_failed", { reason: String(error?.message ?? error).slice(0, 300) });
  }
}

export function materializeWechatDraftReconciliationReceipt({ state, invocation, workItem, decision } = {}) {
  if (decision?.outcome !== "confirmed_saved" || !decision?.sourceDecisionId) {
    return failure("wechat_draft_reconciliation_invalid");
  }
  const project = (state?.projects ?? []).find((candidate) => candidate.id === workItem?.projectId) ?? null;
  if (!project?.path) return failure("wechat_draft_project_missing");
  try {
    const root = realpathSync(project.path);
    const receiptId = `reconciled-${invocation.id}-${createHash("sha256").update(decision.sourceDecisionId).digest("hex").slice(0, 12)}`;
    const relativePath = join(".myagenttool", "receipts", "wechat-official", `${receiptId}.json`);
    const target = resolve(root, relativePath);
    if (!inside(root, target)) return failure("wechat_draft_receipt_path_invalid");
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const payload = `${JSON.stringify({
      schemaVersion: 1,
      invocationId: invocation.id,
      workItemId: workItem.id,
      reconciledAt: decision.decidedAt ?? null,
      status: "succeeded",
      sideEffectState: "confirmed",
      verificationSource: "user_draft_box_reconciliation",
      sourceDecisionId: decision.sourceDecisionId,
      decidedBy: decision.decidedBy ?? null,
      summary: "用户已在公众号草稿箱中确认草稿存在。",
    }, null, 2)}\n`;
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, payload, { mode: 0o600 });
    renameSync(temporary, target);
    const hash = `sha256:${createHash("sha256").update(payload).digest("hex")}`;
    return {
      ok: true,
      asset: {
        id: `wechat_receipt_${createHash("sha256").update(receiptId).digest("hex").slice(0, 24)}`,
        originalName: `${receiptId}.json`,
        path: relative(root, target).split(sep).join("/"),
        family: "text",
        mimeType: "application/json",
        terminalId: workItem.terminalId,
        size: Buffer.byteLength(payload),
        resourceClass: "small",
        hash,
        version: receiptId,
        worktreeId: null,
        capabilities: ["discover", "preview", "inspect", "attach_evidence"],
        readiness: { state: "ready", reason: "wechat_draft_save_user_confirmed" },
      },
    };
  } catch (error) {
    return failure("wechat_draft_receipt_write_failed", { reason: String(error?.message ?? error).slice(0, 300) });
  }
}

function inside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function failure(error, details = {}) {
  return { ok: false, error, ...details };
}
