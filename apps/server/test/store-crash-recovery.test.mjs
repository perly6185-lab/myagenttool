import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

let openSqliteStore;
try {
  await import("node:sqlite");
  ({ openSqliteStore } = await import("../src/runtime/store/sqlite-store.mjs"));
} catch {
  openSqliteStore = null;
}
const skip = openSqliteStore ? false : "node:sqlite unavailable in this runtime";
const writerPath = fileURLToPath(new URL("./fixtures/store-crash-writer.mjs", import.meta.url));

test("a Store commit survives SIGKILL without a graceful SQLite close", { skip }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "store-crash-recovery-"));
  const sqlitePath = join(directory, "state", "local.sqlite");
  const stateStorePath = join(directory, "state", "local.json");
  let child;
  try {
    mkdirSync(join(directory, "state"), { recursive: true });
    child = spawn(process.execPath, [writerPath, sqlitePath, stateStorePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForCommit(child);
    assert.equal(child.kill("SIGKILL"), true);
    const [code, signal] = await once(child, "exit");
    assert.equal(code, null);
    assert.equal(signal, "SIGKILL");

    const reopened = await openSqliteStore({ path: sqlitePath });
    try {
      assert.equal(
        reopened.get("invocations", "inv_committed_before_crash")?.status,
        "queued",
      );
    } finally {
      reopened.close();
    }
  } finally {
    if (child?.exitCode === null && child?.signalCode === null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});

function waitForCommit(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out waiting for durable commit; stderr=${stderr}`));
    }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!stdout.includes("STORE_COMMIT_COMPLETE")) return;
      clearTimeout(timer);
      resolve();
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (stdout.includes("STORE_COMMIT_COMPLETE")) return;
      clearTimeout(timer);
      reject(new Error(`writer exited before commit (code=${code}, signal=${signal}); stderr=${stderr}`));
    });
  });
}
