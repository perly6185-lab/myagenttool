import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { defaultCredentialPath, readCredential } from "../src/credential.mjs";

test("credential path prefers APPDATA — matches where setup-163.ps1 writes (#1199)", () => {
  // Redirected/roaming APPDATA: the reader must follow it, not rebuild
  // USERPROFILE\AppData\Roaming, or the stored credential is unreadable.
  assert.equal(
    defaultCredentialPath({ APPDATA: "D:\\Redirected\\AppData\\Roaming", USERPROFILE: "C:\\Users\\mail-user" }),
    join("D:\\Redirected\\AppData\\Roaming", "myagenttool", "mail", "163.json"),
  );
});

test("credential path falls back to USERPROFILE when APPDATA is unset", () => {
  assert.equal(
    defaultCredentialPath({ USERPROFILE: "C:\\Users\\mail-user" }),
    join("C:\\Users\\mail-user", "AppData", "Roaming", "myagenttool", "mail", "163.json"),
  );
});

test("missing credential refuses with an actionable authorization state", () => {
  assert.throws(
    () => readCredential(join(process.cwd(), "does-not-exist", "163.json")),
    /not_authorized: run tools\/mail-mcp\/setup-163\.ps1/,
  );
});
