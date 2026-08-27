import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { registerPrivateTutorMaterialPicker } from "../src/private-tutor-material-picker.mjs";

test("private tutor local picker keeps the path inside Electron and requests a managed import", async () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-private-tutor-picker-"));
  const path = join(root, "textbook.pdf");
  writeFileSync(path, "%PDF-fixture");
  let handler;
  let request;
  registerPrivateTutorMaterialPicker({
    ipcMain: {
      removeHandler: () => {},
      handle: (_channel, value) => { handler = value; },
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [path] }),
    },
    getWindow: () => null,
    requestServer: async (body) => {
      request = body;
      return { material: { id: "mat_local" }, job: { id: "ptocr_local" }, replayed: false };
    },
  });
  try {
    const result = await handler(null, { startOcr: true, cloudAllowed: true });
    assert.equal(result.material.id, "mat_local");
    assert.equal(request.path, path);
    assert.equal(request.startOcr, true);
    assert.equal(request.cloudAllowed, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
