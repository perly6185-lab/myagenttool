import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { defaultCredentialPath, readCredential } from "../src/credential.mjs";

test("credential path is derived from the current user profile", () => {
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
