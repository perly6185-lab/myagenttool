import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function normalizeAliCloudAccessKey(input) {
  const accessKeyId = String(input?.accessKeyId ?? "").trim();
  const accessKeySecret = String(input?.accessKeySecret ?? "").trim();
  const securityToken = String(input?.securityToken ?? "").trim() || undefined;
  if (!/^[A-Za-z0-9]{8,128}$/.test(accessKeyId) || !accessKeySecret || accessKeySecret.length > 4096 || (securityToken && securityToken.length > 8192)) return null;
  return { accessKeyId, accessKeySecret, ...(securityToken ? { securityToken } : {}) };
}

const PROFILES = Object.freeze({
  aliyunOss: Object.freeze({
    reference: "credential://aliyun/main",
    provider: "aliyun_oss_cdn",
    filename: "aliyun-main.json",
    statusChannel: "site-cloud:get-aliyun-oss-credential-status",
    saveChannel: "site-cloud:save-aliyun-oss-credential",
    removeChannel: "site-cloud:remove-aliyun-oss-credential",
    normalize: normalizeAliCloudAccessKey,
  }),
  alidns: Object.freeze({
    reference: "credential://alidns/main",
    provider: "alidns_acme",
    filename: "alidns-main.json",
    statusChannel: "site-cloud:get-alidns-credential-status",
    saveChannel: "site-cloud:save-alidns-credential",
    removeChannel: "site-cloud:remove-alidns-credential",
    normalize: normalizeAliCloudAccessKey,
  }),
  cloudflare: Object.freeze({
    reference: "credential://cloudflare/main",
    provider: "cloudflare_pages",
    filename: "cloudflare-main.json",
    statusChannel: "site-cloud:get-cloudflare-credential-status",
    saveChannel: "site-cloud:save-cloudflare-credential",
    removeChannel: "site-cloud:remove-cloudflare-credential",
    normalize(input) {
      const accountId = String(input?.accountId ?? "").trim();
      const apiToken = String(input?.apiToken ?? "").trim();
      if (!/^[a-f0-9]{32}$/i.test(accountId) || !apiToken || apiToken.length > 4096) return null;
      return { accountId, apiToken };
    },
  }),
});

function failure(error) { return { ok: false, error }; }

function secureStorageAvailable(safeStorage, platform) {
  if (!safeStorage?.isEncryptionAvailable?.()) return false;
  return platform !== "linux" || safeStorage.getSelectedStorageBackend?.() !== "basic_text";
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function readRecord(path, profile) {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value?.version === 1 && value?.provider === profile.provider && value?.reference === profile.reference && typeof value?.encrypted === "string" ? value : null;
  } catch {
    return null;
  }
}

export function registerSiteCloudCredentialConnector({
  ipcMain,
  safeStorage,
  platform = process.platform,
  credentialRoot,
  requestServer,
  now = () => new Date().toISOString(),
}) {
  for (const profile of Object.values(PROFILES)) {
    for (const channel of [profile.statusChannel, profile.saveChannel, profile.removeChannel]) ipcMain.removeHandler(channel);
    const credentialPath = join(credentialRoot, "site-credentials", profile.filename);

    async function hydrate(record) {
      const decoded = safeStorage.decryptString(Buffer.from(record.encrypted, "base64"));
      const credential = profile.normalize(JSON.parse(decoded));
      if (!credential) throw new Error("credential_invalid");
      await requestServer("PUT", "/api/internal/site-credentials", { reference: profile.reference, provider: profile.provider, credential });
    }

    ipcMain.handle(profile.statusChannel, async () => {
      const secureStorage = secureStorageAvailable(safeStorage, platform);
      const record = readRecord(credentialPath, profile);
      let ready = false;
      if (secureStorage && record) {
        try { await hydrate(record); ready = true; } catch { ready = false; }
      }
      return { desktop: true, secureStorage, stored: Boolean(record), ready, reference: record ? profile.reference : null };
    });

    ipcMain.handle(profile.saveChannel, async (_event, input) => {
      if (!secureStorageAvailable(safeStorage, platform)) return failure("secure_storage_unavailable");
      const credential = profile.normalize(input);
      if (!credential) return failure("credential_invalid");
      const previous = readRecord(credentialPath, profile);
      try {
        const encrypted = safeStorage.encryptString(JSON.stringify(credential)).toString("base64");
        writeJsonAtomic(credentialPath, { version: 1, provider: profile.provider, reference: profile.reference, encrypted, updatedAt: now() });
        await requestServer("PUT", "/api/internal/site-credentials", { reference: profile.reference, provider: profile.provider, credential });
        return { ok: true, reference: profile.reference };
      } catch {
        try {
          if (previous) writeJsonAtomic(credentialPath, previous);
          else if (existsSync(credentialPath)) unlinkSync(credentialPath);
        } catch { /* a later status read reports the remaining encrypted record */ }
        return failure("save_failed");
      }
    });

    ipcMain.handle(profile.removeChannel, async () => {
      try {
        await requestServer("DELETE", "/api/internal/site-credentials", { reference: profile.reference });
        if (existsSync(credentialPath)) unlinkSync(credentialPath);
        return { ok: true, disconnected: true };
      } catch {
        return failure("remove_failed");
      }
    });
  }
}
