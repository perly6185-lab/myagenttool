// Canonical pdfcpu Application for the first, strictly read-only PDF slice.
// The device keeps an independent argv allowlist; both sides must agree before
// the binary can run. Mutating verbs are intentionally absent.

import { PDFCPU_RELEASE_VERSION } from "./pdfcpu-release.mjs";

export const PDFCPU_APPLICATION_ID = "app_pdfcpu";
export const PDFCPU_DEFAULT_VERSION = PDFCPU_RELEASE_VERSION;

const PDFCPU_READ_COMMANDS = [
  {
    id: "validate",
    displayName: "Validate PDF",
    description: "Strictly validate a PDF without network or configuration writes.",
    args: ["validate", "--offline", "--conf", "disable", "--mode", "strict"],
  },
  {
    id: "info",
    displayName: "PDF information",
    description: "Read PDF metadata as JSON without network or configuration writes.",
    args: ["info", "--offline", "--conf", "disable", "--json"],
  },
];

function readCommand(command) {
  return {
    ...command,
    commandType: "bin",
    command: "pdfcpu",
    argInputs: [{ key: "file", positional: true, type: "pdf_file" }],
    status: "approved",
    riskLevel: "low",
    riskTags: ["pdf-document", "read-only"],
    requiresApproval: false,
    filePolicy: "read_only",
    networkPolicy: "forbidden",
    cwdPolicy: "invocation_root",
    outputCollection: "applicationResults",
    resultImport: { source: "pdfcpu", kind: "pdf_read" },
  };
}

export function createPdfcpuApplicationRegistration({ autoOnline = false } = {}) {
  return {
    id: PDFCPU_APPLICATION_ID,
    name: "pdfcpu",
    autoOnline,
    source: {
      type: "binary",
      binary: "pdfcpu",
      version: PDFCPU_DEFAULT_VERSION,
      wrapper: {
        mode: "installed-wrapper",
        commands: PDFCPU_READ_COMMANDS.map(readCommand),
      },
    },
  };
}
