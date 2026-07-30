import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function parseArgs(argv) {
  const options = {
    server: process.env.MYAGENTTOOL_BASE_URL ?? "http://127.0.0.1:4310",
    specPath: process.env.WORKFLOW_MEMORY_PILOT_SPEC
      ? resolve(process.env.WORKFLOW_MEMORY_PILOT_SPEC)
      : null,
    outEvidence: null,
    outManifest: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const key = {
      "--server": "server",
      "--spec": "specPath",
      "--out-evidence": "outEvidence",
      "--out-manifest": "outManifest",
    }[argument];
    if (!key) throw new Error(`unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    options[key] = key === "server" ? value : resolve(value);
    index += 1;
  }
  if (!options.specPath) {
    throw new Error(
      "pilot truth spec required: set WORKFLOW_MEMORY_PILOT_SPEC or pass --spec",
    );
  }
  const server = new URL(options.server);
  if (server.username || server.password || server.search || server.hash
    || !["", "/"].includes(server.pathname)) {
    throw new Error("pilot evidence server must be an origin without credentials, path, query, or fragment");
  }
  if (server.protocol !== "https:"
    && !(server.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(server.hostname))) {
    throw new Error("pilot evidence server must use HTTPS unless it is local");
  }
  options.server = server.toString().replace(/\/$/, "");
  return options;
}

async function readJson(path) {
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`pilot truth spec could not be read: ${error?.code ?? error?.message ?? error}`);
  }
  try {
    return JSON.parse(contents);
  } catch {
    throw new Error("pilot truth spec must be valid JSON");
  }
}

async function writePrivate(path, value) {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = process.env.MYAGENTTOOL_TOKEN;
  if (!token) throw new Error("MYAGENTTOOL_TOKEN is required");
  const spec = await readJson(options.specPath);
  const response = await fetch(
    `${options.server}/api/workflow-memory/commercial-pilot/evidence`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(spec),
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.error ?? `pilot evidence request failed with HTTP ${response.status}`);
  }
  await Promise.all([
    writePrivate(options.outEvidence, result.evidence),
    writePrivate(options.outManifest, result.manifest),
  ]);
  const incompleteCases = result.evidence.cases.filter((row) => row.state !== "complete").length;
  const incompleteSafety = result.evidence.safetyScenarios
    .filter((row) => row.state !== "complete").length;
  process.stdout.write([
    `Pilot: ${result.evidence.pilotId}`,
    `Evidence: ${result.evidence.state}`,
    `Cases: ${result.evidence.cases.length} (${incompleteCases} incomplete)`,
    `Safety scenarios: ${result.evidence.safetyScenarios.length} (${incompleteSafety} incomplete)`,
    `Preliminary gate (quality fixture pending): ${result.report.gate.decision.toUpperCase()}`,
    "",
  ].join("\n"));
  if (result.evidence.state !== "complete") process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`[commercial-pilot-evidence] ${error?.message ?? error}\n`);
  process.exitCode = 2;
});
