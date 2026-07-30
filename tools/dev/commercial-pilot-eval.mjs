import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateCommercialPilotManifest,
  renderCommercialPilotMarkdown,
} from "../../apps/server/src/services/business-pilot-evaluation.mjs";
import {
  evaluateCommercialRoutineFixture,
} from "../../apps/server/src/services/business-routine-evaluation.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultQualityFixturePath = resolve(
  root,
  "apps/server/test/fixtures/workflow-memory/commercial-routine-v1.4.json",
);
const rehearsalManifestPath = resolve(
  root,
  "apps/server/test/fixtures/workflow-memory/commercial-pilot-v1.5-rehearsal.json",
);

function parseArgs(argv) {
  const options = {
    manifestPath: process.env.WORKFLOW_MEMORY_PILOT_MANIFEST
      ? resolve(process.env.WORKFLOW_MEMORY_PILOT_MANIFEST)
      : null,
    qualityFixturePath: defaultQualityFixturePath,
    outJson: null,
    outMarkdown: null,
    rehearsal: false,
    server: process.env.MYAGENTTOOL_BASE_URL ?? "http://127.0.0.1:4310",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--rehearsal") {
      options.rehearsal = true;
      continue;
    }
    const key = {
      "--manifest": "manifestPath",
      "--quality-fixture": "qualityFixturePath",
      "--out-json": "outJson",
      "--out-md": "outMarkdown",
      "--server": "server",
    }[arg];
    if (!key) throw new Error(`unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    options[key] = key === "server" ? value : resolve(value);
    index += 1;
  }
  if (options.rehearsal && !options.manifestPath) {
    options.manifestPath = rehearsalManifestPath;
  }
  if (!options.manifestPath) {
    throw new Error(
      "formal pilot manifest required: set WORKFLOW_MEMORY_PILOT_MANIFEST or pass --manifest",
    );
  }
  if (!options.rehearsal) {
    const server = new URL(options.server);
    if (server.username || server.password || server.search || server.hash
      || !["", "/"].includes(server.pathname)) {
      throw new Error("pilot verification server must be an origin without credentials, path, query, or fragment");
    }
    if (server.protocol !== "https:"
      && !(server.protocol === "http:"
        && ["127.0.0.1", "localhost", "::1"].includes(server.hostname))) {
      throw new Error("pilot verification server must use HTTPS unless it is local");
    }
    options.server = server.toString().replace(/\/$/, "");
  }
  return options;
}

async function readJson(path, label) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`${label} could not be read: ${error?.code ?? error?.message ?? error}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

async function writeReport(path, content) {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

async function verifyProvenance(server, token, manifest) {
  const response = await fetch(
    `${server}/api/workflow-memory/commercial-pilot/evidence/verify`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ manifest }),
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.verified !== true) {
    throw new Error(result?.error ?? `pilot evidence verification failed with HTTP ${response.status}`);
  }
  return true;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [manifest, qualityFixture] = await Promise.all([
    readJson(options.manifestPath, "pilot manifest"),
    readJson(options.qualityFixturePath, "quality fixture"),
  ]);
  const qualityReport = evaluateCommercialRoutineFixture(qualityFixture);
  const token = process.env.MYAGENTTOOL_TOKEN;
  if (!options.rehearsal && !token) {
    throw new Error("MYAGENTTOOL_TOKEN is required for formal evaluation");
  }
  const provenanceVerified = options.rehearsal
    ? false
    : await verifyProvenance(options.server, token, manifest);
  const report = evaluateCommercialPilotManifest(manifest, {
    qualityGatePassed: qualityReport.gate.passed,
    provenanceVerified,
  });
  const markdown = renderCommercialPilotMarkdown(report);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  await Promise.all([
    writeReport(options.outJson, json),
    writeReport(options.outMarkdown, markdown),
  ]);
  process.stdout.write(markdown);
  if (options.rehearsal) {
    if (!report.gate.rehearsalPassed) process.exitCode = 1;
    return;
  }
  if (!report.gate.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`[commercial-pilot-eval] ${error?.message ?? error}\n`);
  process.exitCode = 2;
});
