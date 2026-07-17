/*
 * Device-side credential readiness (#977, ADR 0010).
 *
 * The exact shape #802 gave a missing binary: the device resolves a precondition
 * it alone can see and REPORTS it, so the control plane can refuse precisely
 * ("this device holds no Gmail credential — run the login flow") instead of a run
 * failing opaquely later. It resolves; it never obtains.
 *
 * What it reads is credential METADATA, never a credential. Each application the
 * device has been authorized for leaves a non-secret sidecar record in the
 * credential directory:
 *
 *   { applicationId, provider, scope, obtainedAt }
 *
 * The secret itself lives in the OS credential store, written out of band by the
 * user's one-time login, and is read only by the process that uses it (the MCP
 * server). Nothing in this module — and nothing in what it reports — can carry
 * it. SECRET_SHAPED_KEYS is the belt to that braces: even a malformed or hostile
 * sidecar cannot smuggle a token into a bridge report.
 *
 * The device reports what it HOLDS; it is never told what the server WANTS. The
 * scope comparison happens server-side, against the immutable descriptor. Two
 * independently-sourced facts, compared in one place — so a compromised sidecar
 * cannot claim a match it does not have.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SECRET_SHAPED_KEYS = /token|secret|password|credential|key|authorization|cookie|assertion/i;
const APPLICATION_ID = /^app_[a-z0-9_]{1,48}$/;
const PROVIDER = /^[a-z][a-z0-9_.-]{0,31}$/;
const SCOPE = /^[a-z][a-z0-9_.-]{0,63}$/;

export function collectApplicationCredentialReadiness(
  credentialDir,
  { now = () => new Date().toISOString(), readDir = defaultReadDir, readRecord = defaultReadRecord } = {},
) {
  if (!credentialDir) return [];
  const checkedAt = now();
  return readDir(credentialDir).flatMap((file) => {
    const record = readRecord(join(credentialDir, file));
    const applicationId = String(record?.applicationId ?? "").trim();
    const provider = String(record?.provider ?? "").trim().toLowerCase();
    const scope = String(record?.scope ?? "").trim();
    // A record that does not describe itself cleanly is not a credential we will
    // vouch for. Dropped, not guessed — a fabricated "authorized" is worse than
    // no signal at all.
    if (!APPLICATION_ID.test(applicationId) || !PROVIDER.test(provider) || !SCOPE.test(scope)) return [];
    return [{ applicationId, provider, scope, status: "present", checkedAt }];
  });
}

// Anything secret-shaped in a sidecar is a bug in whatever wrote it, and must
// never reach the wire. Strip at the boundary rather than trusting the writer.
export function stripSecretShapedKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key, entry]) => !SECRET_SHAPED_KEYS.test(key) && typeof entry !== "object"),
  );
}

function defaultReadDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => file.endsWith(".json"));
}

function defaultReadRecord(path) {
  try {
    return stripSecretShapedKeys(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}
