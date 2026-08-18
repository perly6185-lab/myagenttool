import assert from "node:assert/strict";
import { test } from "node:test";

import { parseWorkflowJobs } from "../ci-simulate.mjs";

const workflow = [
  "name: CI",
  "jobs:",
  "  verify:",
  "    steps:",
  "      - name: Checkout",
  "        uses: actions/checkout@v5",
  "      - name: Test",
  "        run: pnpm test:ci",
  "      - name: Checks",
  "        run: |",
  "          pnpm lint",
  "          pnpm typecheck",
  "",
];

for (const newline of ["\n", "\r\n"]) {
  test(`CI workflow parser executes run steps with ${JSON.stringify(newline)} line endings`, () => {
    const jobs = parseWorkflowJobs(workflow.join(newline));
    assert.deepEqual(jobs.get("verify")?.steps, [
      { name: "Checkout", run: null, uses: "actions/checkout@v5" },
      { name: "Test", run: ["pnpm test:ci"], uses: null },
      { name: "Checks", run: ["pnpm lint", "pnpm typecheck"], uses: null },
    ]);
  });
}
