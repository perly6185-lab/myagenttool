import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Client } from "ssh2";

const DEFAULT_TIMEOUT_MS = 15_000;

export class SshHostConnectorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SshHostConnectorError";
    this.code = code;
  }
}

export function sshHostFingerprint(key) {
  if (!Buffer.isBuffer(key) || !key.length) throw new SshHostConnectorError("ssh_host_key_invalid", "The remote host key is invalid.");
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

export function normalizeSshFingerprint(value) {
  const fingerprint = String(value ?? "").trim().replace(/\s+/g, "");
  return /^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint) ? fingerprint : null;
}

function ipv4Parts(address) {
  if (isIP(address) !== 4) return null;
  return address.split(".").map(Number);
}

function ipv6Words(address) {
  const withoutZone = String(address).toLowerCase().split("%", 1)[0];
  if (isIP(withoutZone) !== 6) return null;
  let source = withoutZone;
  if (source.includes(".")) {
    const separator = source.lastIndexOf(":");
    const v4 = ipv4Parts(source.slice(separator + 1));
    if (!v4) return null;
    source = `${source.slice(0, separator)}:${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  return [...left, ...Array(missing).fill("0"), ...right].map((part) => Number.parseInt(part, 16));
}

function embeddedIpv4(words, offset) {
  return [words[offset] >> 8, words[offset] & 255, words[offset + 1] >> 8, words[offset + 1] & 255].join(".");
}

export function classifySshAddress(address) {
  const normalized = String(address ?? "").trim().toLowerCase();
  const v4 = ipv4Parts(normalized);
  if (v4) {
    const [a, b, c] = v4;
    if (a === 127 || a === 0) return "forbidden";
    if (a === 169 && b === 254) return "forbidden";
    if (a >= 224 || (a === 192 && b === 0 && [0, 2].includes(c)) || (a === 198 && ([18, 19].includes(b) || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113)) return "forbidden";
    if (a === 10 || (a === 100 && b >= 64 && b <= 127) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "private";
    return "public";
  }
  const words = ipv6Words(normalized);
  if (!words) return "invalid";
  const firstSixZero = words.slice(0, 6).every((word) => word === 0);
  if (words.every((word) => word === 0) || (words.slice(0, 7).every((word) => word === 0) && words[7] === 1)) return "forbidden";
  if ((words[0] & 0xffc0) === 0xfe80 || (words[0] & 0xff00) === 0xff00 || (words[0] === 0x2001 && words[1] === 0x0db8)) return "forbidden";
  if (firstSixZero || (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff)) return classifySshAddress(embeddedIpv4(words, 6));
  if (words[0] === 0x0064 && words[1] === 0xff9b && words.slice(2, 6).every((word) => word === 0)) return classifySshAddress(embeddedIpv4(words, 6));
  if (words[0] === 0x2002) return classifySshAddress(embeddedIpv4(words, 1));
  if ((words[0] & 0xfe00) === 0xfc00) return "private";
  return "public";
}

export async function resolveSshHostAddress(host, { networkPolicy = "public_only", lookup = dnsLookup } = {}) {
  const requested = String(host ?? "").trim();
  let addresses;
  try {
    addresses = isIP(requested) ? [{ address: requested, family: isIP(requested) }] : await lookup(requested, { all: true, verbatim: true });
  } catch {
    throw new SshHostConnectorError("ssh_host_unresolvable", "The SSH host could not be resolved.");
  }
  const unique = [...new Map((addresses ?? []).map((item) => [String(item.address), item])).values()];
  if (!unique.length) throw new SshHostConnectorError("ssh_host_unresolvable", "The SSH host could not be resolved.");
  const classified = unique.map((item) => ({ ...item, classification: classifySshAddress(item.address) }));
  if (classified.some((item) => item.classification === "forbidden" || item.classification === "invalid")) {
    throw new SshHostConnectorError("ssh_host_address_forbidden", "The SSH host resolves to a forbidden network address.");
  }
  if (networkPolicy !== "allow_private_network" && classified.some((item) => item.classification === "private")) {
    throw new SshHostConnectorError("ssh_host_private_network_blocked", "Private-network SSH hosts require explicit approval.");
  }
  const allowed = classified.filter((item) => networkPolicy === "allow_private_network" || item.classification === "public");
  if (!allowed.length) throw new SshHostConnectorError("ssh_host_address_forbidden", "The SSH host has no allowed network address.");
  return { address: allowed[0].address, family: allowed[0].family, resolvedAddresses: classified.map((item) => item.address) };
}

function connectionOptions(target, address, credential, hostVerifier, timeoutMs) {
  const options = {
    host: address,
    port: target.port,
    username: target.user,
    readyTimeout: timeoutMs,
    keepaliveInterval: 0,
    agentForward: false,
    tryKeyboard: false,
    hostVerifier,
  };
  if (target.authMethod === "private_key_ref" || target.authMethod === "managed_identity") {
    if (!credential?.privateKey) throw new SshHostConnectorError("ssh_credential_invalid", "The SSH private key is unavailable.");
    options.privateKey = credential.privateKey;
    if (credential.passphrase) options.passphrase = credential.passphrase;
  } else if (target.authMethod === "password_ref") {
    if (!credential?.password) throw new SshHostConnectorError("ssh_credential_invalid", "The SSH password is unavailable.");
    options.password = credential.password;
  } else if (target.authMethod === "ssh_agent") {
    const agent = String(credential?.agentSocket ?? process.env.SSH_AUTH_SOCK ?? "").trim();
    if (!agent) throw new SshHostConnectorError("ssh_agent_unavailable", "The SSH agent is unavailable.");
    options.agent = agent;
  } else {
    throw new SshHostConnectorError("ssh_auth_method_unsupported", "The SSH authentication method is unsupported.");
  }
  return options;
}

function sanitizedConnectionError(error) {
  if (error instanceof SshHostConnectorError) return error;
  const level = String(error?.level ?? "");
  if (level === "client-authentication") return new SshHostConnectorError("ssh_authentication_failed", "SSH authentication failed.");
  if (level === "client-timeout") return new SshHostConnectorError("ssh_connection_timeout", "The SSH connection timed out.");
  return new SshHostConnectorError("ssh_connection_failed", "The SSH connection could not be established.");
}

function sanitizedSftpOperationError(error) {
  if (error instanceof SshHostConnectorError) return error;
  if (error?.safeForSftpBoundary === true && /^site_deployment_[a-z0-9_]+$/.test(String(error?.code ?? ""))) return error;
  return new SshHostConnectorError("ssh_sftp_operation_failed", "The remote file operation did not complete.");
}

export function createSshHostConnector({
  ClientClass = Client,
  lookup = dnsLookup,
  resolveAddress = resolveSshHostAddress,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  async function observeFingerprint(target) {
    const resolved = await resolveAddress(target.host, { networkPolicy: target.networkPolicy, lookup });
    return new Promise((resolve, reject) => {
      const client = new ClientClass();
      let observed = null;
      let settled = false;
      let timer;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { client.end(); } catch { /* connection may not have opened */ }
        if (error) reject(error);
        else resolve(value);
      };
      timer = setTimeout(() => finish(new SshHostConnectorError("ssh_connection_timeout", "The SSH connection timed out.")), timeoutMs);
      timer.unref?.();
      client.once("error", (error) => {
        if (!settled) finish(observed ? null : sanitizedConnectionError(error), observed);
      });
      try {
        client.connect({
          host: resolved.address,
          port: target.port,
          username: target.user,
          readyTimeout: timeoutMs,
          agentForward: false,
          tryKeyboard: false,
          hostVerifier: (key) => {
            try {
              const fingerprint = sshHostFingerprint(key);
              observed = { fingerprint, resolvedAddress: resolved.address, resolvedAddresses: resolved.resolvedAddresses };
              queueMicrotask(() => finish(null, observed));
            } catch (error) {
              queueMicrotask(() => finish(sanitizedConnectionError(error)));
            }
            return false;
          },
        });
      } catch (error) {
        finish(sanitizedConnectionError(error));
      }
    });
  }

  async function verifyConnection(target, credential) {
    const expectedFingerprint = normalizeSshFingerprint(target.knownHostFingerprint);
    if (!expectedFingerprint) throw new SshHostConnectorError("ssh_host_fingerprint_required", "Confirm the SSH host fingerprint before connecting.");
    const resolved = await resolveAddress(target.host, { networkPolicy: target.networkPolicy, lookup });
    return new Promise((resolve, reject) => {
      const client = new ClientClass();
      let observedFingerprint = null;
      let settled = false;
      let timer;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { client.end(); } catch { /* connection may already be closed */ }
        if (error) reject(error);
        else resolve(value);
      };
      timer = setTimeout(() => finish(new SshHostConnectorError("ssh_connection_timeout", "The SSH connection timed out.")), timeoutMs);
      timer.unref?.();
      client.once("error", (error) => {
        if (!settled) finish(observedFingerprint && observedFingerprint !== expectedFingerprint
          ? new SshHostConnectorError("ssh_host_fingerprint_changed", "The SSH host fingerprint does not match the confirmed value.")
          : sanitizedConnectionError(error));
      });
      client.once("ready", () => {
        client.sftp((error, sftp) => {
          if (error) {
            finish(new SshHostConnectorError("ssh_sftp_unavailable", "The host does not provide SFTP access."));
            return;
          }
          finish(null, {
            fingerprint: observedFingerprint,
            resolvedAddress: resolved.address,
            capabilities: {
              sftp: true,
              sftpVersion: Number.isInteger(sftp?._version) ? sftp._version : null,
              posixRename: sftp?._extensions?.["posix-rename@openssh.com"] === "1",
              symlink: Number.isInteger(sftp?._version) && sftp._version >= 3 && typeof sftp?.symlink === "function",
            },
          });
        });
      });
      try {
        client.connect(connectionOptions(target, resolved.address, credential, (key) => {
          observedFingerprint = sshHostFingerprint(key);
          return observedFingerprint === expectedFingerprint;
        }, timeoutMs));
      } catch (error) {
        finish(sanitizedConnectionError(error));
      }
    });
  }

  async function runSftp(target, credential, operation, { operationTimeoutMs = timeoutMs } = {}) {
    if (typeof operation !== "function") throw new SshHostConnectorError("ssh_sftp_operation_invalid", "The remote file operation is invalid.");
    const boundedOperationTimeoutMs = Number.isFinite(operationTimeoutMs)
      ? Math.min(15 * 60_000, Math.max(1_000, Number(operationTimeoutMs)))
      : timeoutMs;
    const expectedFingerprint = normalizeSshFingerprint(target.knownHostFingerprint);
    if (!expectedFingerprint) throw new SshHostConnectorError("ssh_host_fingerprint_required", "Confirm the SSH host fingerprint before connecting.");
    const resolved = await resolveAddress(target.host, { networkPolicy: target.networkPolicy, lookup });
    return new Promise((resolve, reject) => {
      const client = new ClientClass();
      let observedFingerprint = null;
      let settled = false;
      let timer;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { client.end(); } catch { /* connection may already be closed */ }
        if (error) reject(error);
        else resolve({ value, fingerprint: observedFingerprint, resolvedAddress: resolved.address });
      };
      timer = setTimeout(() => finish(new SshHostConnectorError("ssh_connection_timeout", "The SSH connection timed out.")), timeoutMs);
      timer.unref?.();
      client.once("error", (error) => {
        if (!settled) finish(observedFingerprint && observedFingerprint !== expectedFingerprint
          ? new SshHostConnectorError("ssh_host_fingerprint_changed", "The SSH host fingerprint does not match the confirmed value.")
          : sanitizedConnectionError(error));
      });
      client.once("ready", () => {
        clearTimeout(timer);
        timer = setTimeout(() => finish(new SshHostConnectorError("ssh_sftp_operation_timeout", "The remote file operation timed out.")), boundedOperationTimeoutMs);
        timer.unref?.();
        client.sftp((error, sftp) => {
          if (error) {
            finish(new SshHostConnectorError("ssh_sftp_unavailable", "The host does not provide SFTP access."));
            return;
          }
          Promise.resolve()
            .then(() => operation(sftp))
            .then((value) => finish(null, value), (operationError) => finish(sanitizedSftpOperationError(operationError)));
        });
      });
      try {
        client.connect(connectionOptions(target, resolved.address, credential, (key) => {
          observedFingerprint = sshHostFingerprint(key);
          return observedFingerprint === expectedFingerprint;
        }, timeoutMs));
      } catch (error) {
        finish(sanitizedConnectionError(error));
      }
    });
  }

  return { observeFingerprint, verifyConnection, runSftp };
}
