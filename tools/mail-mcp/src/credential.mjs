import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

export function defaultCredentialPath(env = process.env) {
  // #1199: setup-163.ps1 writes under $env:APPDATA, so the reader MUST resolve
  // the same base — using it directly when set. Rebuilding USERPROFILE\AppData\
  // Roaming diverges from APPDATA under folder redirection / roaming profiles /
  // Known-Folder Move, which left the credential stored but permanently
  // unreadable (not_authorized). Fall back to the rebuild only when APPDATA is
  // absent (non-Windows dev shells).
  const base = env.APPDATA
    || (env.USERPROFILE && join(env.USERPROFILE, "AppData", "Roaming"))
    || (env.HOME && join(env.HOME, "AppData", "Roaming"));
  if (!base) throw new Error("not_authorized: user profile is unavailable");
  return join(base, "myagenttool", "mail", "163.json");
}

export function defaultOrganizeCredentialPath(env = process.env) {
  return join(dirname(defaultCredentialPath(env)), "163-organize.json");
}

export function readCredential(path = defaultCredentialPath()) {
  if (!existsSync(path)) {
    throw new Error(`not_authorized: run tools/mail-mcp/setup-163.ps1 on this device`);
  }
  const record = JSON.parse(readFileSync(path, "utf8"));
  if (record.provider !== "netease" || !["imap.readonly", "imap.mail"].includes(record.scope) || !record.username || !record.protectedAuthorizationCode) {
    throw new Error("not_authorized: the 163 Mail credential record is invalid");
  }
  return {
    username: String(record.username),
    authorizationCode: unprotectForCurrentUser(String(record.protectedAuthorizationCode)),
  };
}

export function readOrganizeCredential(path = defaultOrganizeCredentialPath()) {
  if (!existsSync(path)) throw new Error("not_authorized: connect folder organization on this device");
  const record = JSON.parse(readFileSync(path, "utf8"));
  if (record.provider !== "netease" || record.scope !== "imap.organize" || !record.username || !record.protectedAuthorizationCode) {
    throw new Error("not_authorized: the 163 Mail organize credential record is invalid");
  }
  return { username: String(record.username), authorizationCode: unprotectForCurrentUser(String(record.protectedAuthorizationCode)) };
}

function unprotectForCurrentUser(protectedValue) {
  if (process.platform !== "win32") {
    throw new Error("not_authorized: 163 Mail credential decryption currently requires Windows DPAPI");
  }
  const script = [
    "$ErrorActionPreference='Stop'",
    "$s=ConvertTo-SecureString $env:MAT_PROTECTED_SECRET",
    "$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)",
    "try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b))} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}",
  ].join(";");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    env: { SYSTEMROOT: process.env.SYSTEMROOT, windir: process.env.windir, MAT_PROTECTED_SECRET: protectedValue },
  });
  if (result.status !== 0 || !result.stdout) throw new Error("not_authorized: the 163 Mail authorization code could not be decrypted");
  return result.stdout;
}
