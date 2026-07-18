import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const policy = JSON.parse(readFileSync(resolve(root, "tools/dev/provider-contracts.json"), "utf8"));
const providers = Object.entries(policy.providers ?? {});
if (policy.schemaVersion !== 1 || providers.length !== 5) throw new Error("provider contract matrix must declare all five shipped providers");

const tests = new Set();
for (const [provider, contract] of providers) {
  for (const key of ["gateway", "client"]) {
    const path = resolve(root, contract[key]);
    if (!existsSync(path)) throw new Error(`${provider}: missing ${key} ${contract[key]}`);
    const source = readFileSync(path, "utf8");
    if (key === "gateway" && !source.includes("MAX_BODY_BYTES")) throw new Error(`${provider}: gateway has no bounded request body`);
    if (key === "client" && !source.includes("AbortSignal.timeout(10_000)")) throw new Error(`${provider}: client has no 10s provider timeout`);
  }
  for (const test of contract.tests ?? []) {
    if (!existsSync(resolve(root, test))) throw new Error(`${provider}: missing contract test ${test}`);
    tests.add(test);
  }
}

const result = spawnSync(process.execPath, ["--test", "--test-reporter=dot", ...tests], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 120_000 });
if (result.status !== 0) {
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exit(result.status ?? 1);
}
console.log(`[provider-contract] ${providers.length} providers passed ${policy.requiredContracts.join(", ")} contracts across ${tests.size} test files.`);
