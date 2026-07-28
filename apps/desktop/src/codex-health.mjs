function text(result) {
  return `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`.trim();
}

export function evaluateCodexHealth({ helpResult, authResult, fixture = false } = {}) {
  const helpText = text(helpResult);
  const surfaceReady = helpResult?.status === 0
    && /Run Codex non-interactively|Usage:\s+codex exec/i.test(helpText);
  const authenticated = fixture || authResult?.status === 0;

  if (!surfaceReady) {
    return {
      ok: false,
      authenticated: false,
      summary: helpResult?.timedOut
        ? "Codex CLI probe timed out."
        : "Codex CLI non-interactive surface is unavailable.",
      nextAction: "Verify the Codex CLI installation and executable configured for Desktop Bridge.",
    };
  }
  if (!authenticated) {
    return {
      ok: false,
      authenticated: false,
      summary: authResult?.timedOut
        ? "Codex authentication probe timed out."
        : "Codex CLI is installed but the Desktop Bridge account is not authenticated.",
      nextAction: "Run `codex login` as the same OS account that runs Desktop Bridge, then retry the health check.",
    };
  }
  return {
    ok: true,
    authenticated: true,
    summary: "Codex CLI is installed, authenticated, and ready for non-interactive execution.",
    nextAction: null,
  };
}
