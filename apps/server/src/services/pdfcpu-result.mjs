export function parsePdfcpuApplicationResult({ capability, text }) {
  const command = String(capability ?? "").split(".").at(-1);
  const body = String(text ?? "").trim();
  if (command === "info") {
    try { const value = JSON.parse(body); return value && typeof value === "object" ? value : null; } catch { return null; }
  }
  if (command === "validate") {
    return {
      valid: /validation ok|validating.*ok|status\s*:\s*valid/i.test(body),
      summary: body.slice(0, 2_000),
    };
  }
  return null;
}
