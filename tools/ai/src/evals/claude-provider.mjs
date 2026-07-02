#!/usr/bin/env node
// Claude Code CLI structured provider (command-provider protocol).
//
// Implements the `--provider command` contract from providers/structured.mjs:
// reads {agentName, schema, systemPrompt, userPrompt} JSON on stdin, prints a
// single schema-conformant JSON object on stdout. No tools are needed — this
// is a pure structured-generation call. Wire it up with an ABSOLUTE path:
//
//   MYAGENTTOOL_AI_COMMAND="node \"$PWD/tools/ai/src/evals/claude-provider.mjs\"" \
//   pnpm ai:eval-subcap -- --provider command
//
// Env: MYAGENTTOOL_CLAUDE_CLI (default "claude"), MYAGENTTOOL_CLAUDE_MODEL,
//      MYAGENTTOOL_CLAUDE_PROVIDER_TIMEOUT_MS (default 300000 — detailed
//      briefs can run long; the baseline's only miss was a 180s timeout that
//      passed cleanly on retry).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";

function main() {
  const request = JSON.parse(readFileSync(0, "utf8"));
  const cli = process.env.MYAGENTTOOL_CLAUDE_CLI ?? "claude";
  const model = process.env.MYAGENTTOOL_CLAUDE_MODEL ?? "";
  // Guard the coercion: Number("") is 0 (spawnSync reads 0 as "no timeout")
  // and garbage is NaN (spawnSync throws) — both fall back to the default.
  const timeoutRaw = Number(process.env.MYAGENTTOOL_CLAUDE_PROVIDER_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 300000;

  const prompt = [
    request.systemPrompt ?? "",
    "",
    request.userPrompt ?? "",
    "",
    "Respond with ONLY one JSON object that conforms to this JSON Schema.",
    "No markdown fences, no commentary, no leading or trailing text.",
    "",
    JSON.stringify(request.schema?.schema ?? {}, null, 2),
  ].join("\n");

  const args = ["-p", prompt, "--allowedTools", "Read"];
  if (model) args.push("--model", model);

  const run = spawnSync(cli, args, {
    // Neutral cwd: structured generation needs no repo context, and running in
    // the repo makes the CLI load project config (sessions, MCP servers) —
    // an unauthenticated MCP connector there hangs startup past any timeout.
    cwd: tmpdir(),
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  if (run.error?.code === "ETIMEDOUT") {
    throw new Error(`Claude provider timed out after ${timeoutMs}ms.`);
  }
  if (run.status !== 0) {
    throw new Error(`Claude CLI exited ${run.status ?? "unknown"}: ${(run.stderr ?? "").slice(-400)}`);
  }

  const parsed = extractJson(run.stdout ?? "");
  process.stdout.write(JSON.stringify(parsed));
}

// Models occasionally wrap JSON in fences or prose despite instructions. Try
// the clean forms first; the greedy outermost-brace slice is the last resort
// (it breaks when prose outside the object also contains braces).
function extractJson(text) {
  const trimmed = String(text ?? "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Claude output contained no JSON object: ${trimmed.slice(0, 200)}`);
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
}
