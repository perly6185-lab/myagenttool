#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const EXPECTED_OFFICECLI_VERSION = "1.0.139";
const python = process.env.MSOFFCRYPTO_PYTHON || "python3";
const encryptProgram = String.raw`
import msoffcrypto, pathlib, sys
password = sys.stdin.readline().rstrip("\n")
with pathlib.Path(sys.argv[1]).open("rb") as source, pathlib.Path(sys.argv[2]).open("wb") as output:
    msoffcrypto.OfficeFile(source).encrypt(password, output)
`;

async function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => child.kill("SIGTERM"), 15_000);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => stderr.push(Buffer.from(error.message)));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: Number.isInteger(code) ? code : 1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
    child.stdin.end(options.input ?? "");
  });
}

function errorCodeOf(output) {
  try { return JSON.parse(output).error?.code ?? null; }
  catch { return null; }
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

const root = await mkdtemp(join(tmpdir(), "officecli-encrypted-read-"));
const password = randomBytes(24).toString("base64url");
const incorrectPassword = randomBytes(24).toString("base64url");
try {
  const version = (await run("officecli", ["--version"])).stdout.trim();
  if (version !== EXPECTED_OFFICECLI_VERSION) throw new Error(`Expected OfficeCLI ${EXPECTED_OFFICECLI_VERSION}; found ${version || "unavailable"}.`);
  const matrix = [];
  for (const format of ["docx", "xlsx", "pptx"]) {
    const plain = join(root, `plain.${format}`);
    const encrypted = join(root, `encrypted.${format}`);
    const created = await run("officecli", ["create", plain]);
    if (created.exitCode !== 0) throw new Error(`Could not create the ${format} source fixture.`);
    const encryptedResult = await run(python, ["-c", encryptProgram, plain, encrypted], { input: `${password}\n` });
    if (encryptedResult.exitCode !== 0) throw new Error("Fixture encryption failed. Install msoffcrypto-tool in the selected Python environment.");
    const encryptedDigest = await sha256(encrypted);
    const before = new Set(await readdir(root));
    for (const [input, secret] of [["empty", ""], ["incorrect", incorrectPassword], ["correct", password]]) {
      const result = await run("officecli", ["view", encrypted, "text", "--json"], { input: secret ? `${secret}\n` : "" });
      const combined = `${result.stdout}${result.stderr}`;
      matrix.push({
        format,
        input,
        exitCode: result.exitCode,
        errorCode: errorCodeOf(combined),
        passwordLeaked: combined.includes(password) || combined.includes(incorrectPassword),
      });
    }
    const after = new Set(await readdir(root));
    const newFiles = [...after].filter((name) => !before.has(name));
    const sourceMutated = await sha256(encrypted) !== encryptedDigest;
    matrix.filter((row) => row.format === format).forEach((row) => { row.newFiles = newFiles; row.sourceMutated = sourceMutated; });
  }
  console.log(JSON.stringify({ officecliVersion: EXPECTED_OFFICECLI_VERSION, matrix }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
