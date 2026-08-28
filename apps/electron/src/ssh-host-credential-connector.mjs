import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const HOST_ID = /^ssh_target_[A-Za-z0-9._~-]{1,80}$/;
const CHANNELS = ["ssh-host:get-credential-status", "ssh-host:save-credential", "ssh-host:remove-credential"];

function failure(error) { return { ok: false, error }; }
function referenceFor(hostId) { return `credential://ssh/${hostId}`; }

function secureStorageAvailable(safeStorage, platform) {
  if (!safeStorage?.isEncryptionAvailable?.()) return false;
  return platform !== "linux" || safeStorage.getSelectedStorageBackend?.() !== "basic_text";
}

function normalizeHostId(value) {
  const hostId = String(value ?? "").trim();
  return HOST_ID.test(hostId) ? hostId : null;
}

function normalizeCredential(input) {
  const authMethod = String(input?.authMethod ?? "").trim();
  if (authMethod === "private_key_ref" || authMethod === "managed_identity") {
    const privateKey = String(input?.privateKey ?? "");
    const passphrase = String(input?.passphrase ?? "") || undefined;
    if (!privateKey || privateKey.length > 65_536 || !/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(privateKey) || (passphrase && passphrase.length > 4096)) return null;
    return { authMethod, privateKey, ...(passphrase ? { passphrase } : {}) };
  }
  if (authMethod === "password_ref") {
    const password = String(input?.password ?? "");
    return password && password.length <= 4096 ? { authMethod, password } : null;
  }
  return null;
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function readRecord(path, hostId) {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value?.version === 1 && value?.provider === "ssh" && value?.hostId === hostId
      && value?.reference === referenceFor(hostId) && typeof value?.encrypted === "string" && ["private_key_ref", "managed_identity", "password_ref"].includes(value?.authMethod)
      ? value : null;
  } catch {
    return null;
  }
}

export function registerSshHostCredentialConnector({
  ipcMain,
  safeStorage,
  platform = process.platform,
  credentialRoot,
  requestServer,
  onError = () => {},
  now = () => new Date().toISOString(),
}) {
  for (const channel of CHANNELS) ipcMain.removeHandler(channel);

  const pathFor = (hostId) => join(credentialRoot, "ssh-host-credentials", `${hostId}.json`);
  const credentialDirectory = join(credentialRoot, "ssh-host-credentials");
  async function hydrate(record) {
    let credential;
    try {
      const decoded = safeStorage.decryptString(Buffer.from(record.encrypted, "base64"));
      credential = normalizeCredential(JSON.parse(decoded));
    } catch {
      throw new Error("credential_decrypt_failed");
    }
    if (!credential || credential.authMethod !== record.authMethod) throw new Error("credential_invalid");
    try {
      await requestServer("PUT", "/api/internal/site-credentials", { reference: record.reference, provider: "ssh", credential });
    } catch {
      throw new Error("credential_handoff_failed");
    }
  }

  ipcMain.handle("ssh-host:get-credential-status", async (_event, input) => {
    const hostId = normalizeHostId(input?.hostId);
    if (!hostId) return failure("host_id_invalid");
    const secureStorage = secureStorageAvailable(safeStorage, platform);
    const record = readRecord(pathFor(hostId), hostId);
    let ready = false;
    if (secureStorage && record) {
      try {
        await hydrate(record);
        ready = true;
      } catch (error) {
        onError("hydrate", error instanceof Error ? error.message : "credential_status_failed");
        ready = false;
      }
    }
    return { desktop: true, secureStorage, stored: Boolean(record), ready, reference: record?.reference ?? null, authMethod: record?.authMethod ?? null };
  });

  ipcMain.handle("ssh-host:save-credential", async (_event, input) => {
    const hostId = normalizeHostId(input?.hostId);
    if (!hostId) return failure("host_id_invalid");
    if (!secureStorageAvailable(safeStorage, platform)) return failure("secure_storage_unavailable");
    const credential = normalizeCredential(input);
    if (!credential) return failure("credential_invalid");
    const credentialPath = pathFor(hostId);
    const previous = readRecord(credentialPath, hostId);
    const reference = referenceFor(hostId);
    try {
      const encrypted = safeStorage.encryptString(JSON.stringify(credential)).toString("base64");
      writeJsonAtomic(credentialPath, { version: 1, provider: "ssh", hostId, authMethod: credential.authMethod, reference, encrypted, updatedAt: now() });
      await requestServer("PUT", "/api/internal/site-credentials", { reference, provider: "ssh", credential });
      return { ok: true, reference, authMethod: credential.authMethod };
    } catch (error) {
      onError("save", error instanceof Error ? error.message : "credential_save_failed");
      try {
        if (previous) writeJsonAtomic(credentialPath, previous);
        else if (existsSync(credentialPath)) unlinkSync(credentialPath);
      } catch { /* a later status read reports any remaining encrypted record */ }
      return failure("save_failed");
    }
  });

  ipcMain.handle("ssh-host:remove-credential", async (_event, input) => {
    const hostId = normalizeHostId(input?.hostId);
    if (!hostId) return failure("host_id_invalid");
    const credentialPath = pathFor(hostId);
    try {
      await requestServer("DELETE", "/api/internal/site-credentials", { reference: referenceFor(hostId) });
      if (existsSync(credentialPath)) unlinkSync(credentialPath);
      return { ok: true, disconnected: true };
    } catch (error) {
      onError("remove", error instanceof Error ? error.message : "credential_remove_failed");
      return failure("remove_failed");
    }
  });

  return {
    hydrateStoredCredentials: async () => {
      if (!secureStorageAvailable(safeStorage, platform) || !existsSync(credentialDirectory)) return { stored: 0, ready: 0, failed: 0 };
      let entries;
      try {
        entries = readdirSync(credentialDirectory, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .slice(0, 256);
      } catch {
        onError("startup-scan", "credential_directory_unreadable");
        return { stored: 0, ready: 0, failed: 0 };
      }
      let stored = 0;
      let ready = 0;
      let failed = 0;
      for (const entry of entries) {
        const hostId = normalizeHostId(entry.name.slice(0, -5));
        if (!hostId) continue;
        const record = readRecord(pathFor(hostId), hostId);
        if (!record) continue;
        stored += 1;
        try {
          await hydrate(record);
          ready += 1;
        } catch (error) {
          failed += 1;
          onError("startup-hydrate", error instanceof Error ? error.message : "credential_status_failed");
        }
      }
      return { stored, ready, failed };
    },
  };
}
