import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateCommercialRoutineFixture,
} from "../../apps/server/src/services/business-routine-evaluation.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = resolve(
  root,
  "apps/server/test/fixtures/workflow-memory/commercial-routine-v1.4.json",
);
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const report = evaluateCommercialRoutineFixture(fixture);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.gate.passed) process.exitCode = 1;
