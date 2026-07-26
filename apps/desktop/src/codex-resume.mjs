// Pure helpers for Codex CLI session resume (#163). Extracted from index.mjs so
// they can be unit-tested in CI — the bridge's own `--check` self-check is
// environment-gated (it needs a locally configured Codex CLI) and excluded from
// test:ci, so the resume/injection logic would otherwise be unverified.

// A provider session id is emitted by the codex JSONL stream (a uuid/rollout
// token). Accept only a bounded alphanumeric token that cannot begin with "-",
// so it is always a resume TARGET and can never be smuggled in as an argv flag.
export function safeCodexSessionId(value) {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(text) ? text : null;
}

// Args for an exact resume. A missing/unsafe provider id returns null so the
// caller starts a fresh session; falling back to global `--last` can attach a
// concurrent task to the wrong repository/session.
export function codexResumeArgs(options) {
  const resumeId = safeCodexSessionId(options?.codexResumeSessionId);
  return resumeId
    ? ["exec", "resume", resumeId, "--skip-git-repo-check", "--json", "{{task}}"]
    : null;
}
