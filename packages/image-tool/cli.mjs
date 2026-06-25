#!/usr/bin/env node
// CLI entry point — what codex runs directly to edit/generate an image.
//   node cli.mjs --input <path> --prompt <text> --output <path> [--size 1024x1024]
// --input is optional: omit it to generate from scratch.

import { editImage, resolveProvider } from "./core.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { help: true };
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else { out[key] = next; i++; }
    }
  }
  return out;
}

const HELP = `myagent-image — edit or generate an image.

Usage:
  node cli.mjs --prompt <text> --output <path> [--input <path>] [--size 1024x1024]

Options:
  --input    Reference image to edit (omit to generate from scratch)
  --prompt   Instruction text (required)
  --output   Where to write the result (required)
  --size     Optional size hint, e.g. 1024x1024

Provider via env: IMAGE_PROVIDER=openai|gemini (default openai).
  openai: OPENAI_API_KEY [OPENAI_IMAGE_MODEL]
  gemini: GEMINI_API_KEY [GEMINI_IMAGE_MODEL]
`;

const args = parseArgs(process.argv.slice(2));
if (args.help || (!args.prompt && !args.output)) {
  process.stdout.write(HELP + `\nActive provider: ${resolveProvider()}\n`);
  process.exit(args.help ? 0 : 1);
}

try {
  const result = await editImage({
    inputPath: typeof args.input === "string" ? args.input : undefined,
    prompt: typeof args.prompt === "string" ? args.prompt : "",
    outputPath: typeof args.output === "string" ? args.output : "",
    size: typeof args.size === "string" ? args.size : undefined
  });
  process.stdout.write(`OK [${result.provider}] wrote ${result.bytes} bytes -> ${result.outputPath}\n`);
} catch (error) {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
