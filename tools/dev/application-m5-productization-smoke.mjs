import { spawnSync } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const checks = [
  {
    name: "web Application productization regressions",
    command: pnpm,
    args: [
      "--filter",
      "@myagenttool/web",
      "test",
      "--",
      "ui-store",
      "deep-links",
      "applications-view",
      "applications-inspector",
    ],
  },
  {
    name: "web typecheck",
    command: pnpm,
    args: ["--filter", "@myagenttool/web", "typecheck"],
  },
  {
    name: "Application mixed fleet smoke",
    command: pnpm,
    args: ["smoke:application-fleet"],
  },
  {
    name: "engineering docs links",
    command: pnpm,
    args: ["docs:check"],
  },
];

let passed = 0;
const startedAt = Date.now();

for (const check of checks) {
  const label = `[application-m5-productization] ${check.name}`;
  console.log(`\n${label}`);
  console.log(`  $ ${[check.command, ...check.args].join(" ")}`);
  const result = spawnSync(check.command, check.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(`  failed to start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    printTail(result.stdout, "stdout");
    printTail(result.stderr, "stderr");
    console.error(`\n${label} FAILED with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
  passed += 1;
  printTail(result.stdout, "stdout", 8);
  console.log(`  ok - ${check.name}`);
}

const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\napplication-m5-productization-smoke: ${passed} checks passed in ${seconds}s`);

function printTail(value, label, lineCount = 30) {
  const text = (value ?? "").trim();
  if (!text) return;
  const lines = text.split(/\r?\n/);
  const tail = lines.slice(-lineCount).join("\n");
  console.log(`  ${label}:\n${indent(tail)}`);
}

function indent(value) {
  return value.split(/\r?\n/).map((line) => `    ${line}`).join("\n");
}
