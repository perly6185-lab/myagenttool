import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try { chmodSync(dirname(path), 0o700); } catch { /* best effort on Windows */ }
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

function writeJsonAtomic(path, value) {
  ensureParent(path);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  try { chmodSync(temp, 0o600); } catch { /* best effort on Windows */ }
  renameSync(temp, path);
  try { chmodSync(path, 0o600); } catch { /* best effort on Windows */ }
}

export function createIlinkCredentialStore({ stateStorePath }) {
  const keyPath = `${stateStorePath}.ilink.key`;
  const dataPath = `${stateStorePath}.ilink.credentials`;
  ensureParent(keyPath);
  let key;
  if (existsSync(keyPath)) {
    key = Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
  }
  if (!key || key.length !== 32) {
    key = randomBytes(32);
    writeFileSync(keyPath, key.toString("base64"), { mode: 0o600 });
    try { chmodSync(keyPath, 0o600); } catch { /* best effort on Windows */ }
  }

  function loadRecords() {
    return readJson(dataPath, { version: 1, records: {} });
  }
  // The state snapshot is single-writer locked by the server. Keep the
  // encrypted record index in memory so every readiness/public-state read does
  // not synchronously parse and decrypt the credentials file again.
  let records = loadRecords();

  function save(accountId, credential) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credential), "utf8"), cipher.final()]);
    records.records[String(accountId)] = {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: ciphertext.toString("base64"),
    };
    writeJsonAtomic(dataPath, records);
  }

  function load(accountId) {
    const record = loadRecords().records?.[String(accountId)];
    if (!record) return null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "base64"));
      decipher.setAuthTag(Buffer.from(record.tag, "base64"));
      return JSON.parse(Buffer.concat([
        decipher.update(Buffer.from(record.data, "base64")),
        decipher.final(),
      ]).toString("utf8"));
    } catch {
      return null;
    }
  }

  function remove(accountId) {
    delete records.records?.[String(accountId)];
    writeJsonAtomic(dataPath, records);
  }

  return { save, load, remove, paths: { keyPath, dataPath } };
}
