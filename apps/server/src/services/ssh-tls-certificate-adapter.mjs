import { createHash, createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { checkServerIdentity, connect as tlsConnect } from "node:tls";
import { posix } from "node:path";

import { SiteDomainTlsAdapterError } from "./site-domain-tls-adapter.mjs";

const FILE_TYPE_MASK = 0o170000;
const DIRECTORY_TYPE = 0o040000;
const REGULAR_FILE_TYPE = 0o100000;
const SYMLINK_TYPE = 0o120000;
const MAX_CERTIFICATE_BYTES = 1024 * 1024;
const OPERATION_TIMEOUT_MS = 2 * 60_000;
const SAFE_RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function fail(code, message, retryable = false) {
  const error = new SiteDomainTlsAdapterError(code, message, { retryable });
  error.safeForSftpBoundary = true;
  return error;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sftpCall(sftp, method, ...args) {
  return new Promise((resolve, reject) => {
    if (typeof sftp?.[method] !== "function") return reject(fail("site_tls_sftp_capability_missing", `Required SFTP operation is unavailable: ${method}.`));
    sftp[method](...args, (error, value) => error ? reject(error) : resolve(value));
  });
}

function sftpRead(sftp, handle, buffer, offset, length, position) {
  return new Promise((resolve, reject) => sftp.read(handle, buffer, offset, length, position, (error, bytesRead) => error ? reject(error) : resolve(Number(bytesRead ?? 0))));
}

function sftpWrite(sftp, handle, buffer, offset, length, position) {
  return new Promise((resolve, reject) => sftp.write(handle, buffer, offset, length, position, (error) => error ? reject(error) : resolve()));
}

function attrsType(attrs) {
  const mode = Number(attrs?.mode ?? 0) & FILE_TYPE_MASK;
  if (mode === DIRECTORY_TYPE) return "directory";
  if (mode === REGULAR_FILE_TYPE) return "file";
  if (mode === SYMLINK_TYPE) return "symlink";
  return "special";
}

function missing(error) {
  return error?.code === 2 || error?.code === "ENOENT" || error?.code === "NO_SUCH_FILE";
}

async function optionalLstat(sftp, path) {
  try { return await sftpCall(sftp, "lstat", path); } catch (error) { if (missing(error)) return null; throw error; }
}

async function ensureDirectory(sftp, path) {
  const attrs = await optionalLstat(sftp, path);
  if (attrs) {
    if (attrsType(attrs) !== "directory") throw fail("site_tls_remote_layout_conflict", "A managed certificate directory conflicts with an existing remote item.");
    await sftpCall(sftp, "chmod", path, 0o700);
    return;
  }
  await sftpCall(sftp, "mkdir", path, { mode: 0o700 });
  await sftpCall(sftp, "chmod", path, 0o700);
}

async function writeFile(sftp, path, bytes, mode) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_CERTIFICATE_BYTES) throw fail("site_tls_certificate_file_invalid", "A certificate file is empty or too large.");
  let handle;
  try {
    handle = await sftpCall(sftp, "open", path, "wx", mode);
    for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
      const length = Math.min(64 * 1024, bytes.length - offset);
      await sftpWrite(sftp, handle, bytes, offset, length, offset);
    }
  } finally {
    if (handle) await sftpCall(sftp, "close", handle).catch(() => {});
  }
  await sftpCall(sftp, "chmod", path, mode);
}

async function readFile(sftp, path) {
  const attrs = await sftpCall(sftp, "lstat", path);
  if (attrsType(attrs) !== "file") throw fail("site_tls_remote_file_invalid", "A managed certificate file is not a regular file.");
  const size = Number(attrs.size ?? -1);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_CERTIFICATE_BYTES) throw fail("site_tls_remote_file_invalid", "A managed certificate file has an invalid size.");
  const output = Buffer.alloc(size);
  const handle = await sftpCall(sftp, "open", path, "r");
  try {
    let offset = 0;
    while (offset < size) {
      const bytesRead = await sftpRead(sftp, handle, output, offset, Math.min(64 * 1024, size - offset), offset);
      if (!bytesRead) throw fail("site_tls_remote_read_incomplete", "A certificate file ended before verification completed.");
      offset += bytesRead;
    }
  } finally {
    await sftpCall(sftp, "close", handle).catch(() => {});
  }
  return output;
}

function certificateFiles(certificate) {
  const blocks = String(certificate ?? "").match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  if (!blocks.length) throw fail("site_tls_certificate_invalid", "The staged certificate chain is invalid.");
  const line = (value) => Buffer.from(`${value.trim()}\n`);
  return { cert: line(blocks[0]), chain: line(blocks.slice(1).join("\n")), fullchain: line(blocks.join("\n")) };
}

function verifyKeyPair(certificate, privateKey) {
  try {
    const certKey = new X509Certificate(certificate).publicKey.export({ type: "spki", format: "der" });
    const privatePublicKey = createPublicKey(createPrivateKey(privateKey)).export({ type: "spki", format: "der" });
    if (!Buffer.from(certKey).equals(Buffer.from(privatePublicKey))) throw new Error("mismatch");
  } catch {
    throw fail("site_tls_certificate_key_mismatch", "The certificate and private key do not match.");
  }
}

async function defaultVerifyHttps({ address, hostname, fingerprint, ca }) {
  if (!String(ca ?? "").includes("BEGIN CERTIFICATE")) throw fail("site_tls_staging_ca_required", "Configure the explicit ACME staging trust anchor before HTTPS verification.");
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({ host: address, port: 443, servername: hostname, ca, rejectUnauthorized: true, checkServerIdentity }, () => {
      try {
        const peer = socket.getPeerCertificate(true);
        const actual = sha256(peer.raw);
        if (actual !== fingerprint) throw fail("site_tls_https_certificate_mismatch", "HTTPS is not serving the activated certificate.");
        socket.end();
        resolve({ address, hostname, fingerprint: actual });
      } catch (error) {
        socket.destroy();
        reject(error);
      }
    });
    socket.setTimeout(15_000, () => socket.destroy(fail("site_tls_https_check_timeout", "The HTTPS verification timed out.", true)));
    socket.once("error", (error) => reject(error instanceof SiteDomainTlsAdapterError ? error : fail("site_tls_https_check_failed", "HTTPS verification failed.", true)));
  });
}

function linkedContext(state, binding) {
  const target = state.siteDeploymentTargets.find((item) => item.id === binding.deploymentTargetId && item.ownerTeamId === binding.ownerTeamId);
  const publishScope = target ? state.hostFileScopes.find((item) => item.id === target.remoteProjectRef && item.ownerTeamId === binding.ownerTeamId) : null;
  const scope = state.hostFileScopes.find((item) => item.id === binding.certificateScopeId && item.ownerTeamId === binding.ownerTeamId);
  const profile = state.hostTlsActivationProfiles?.find((item) => item.id === binding.activationProfileId && item.ownerTeamId === binding.ownerTeamId);
  const host = scope ? state.sshTargets.find((item) => item.id === scope.sshTargetId && item.ownerTeamId === binding.ownerTeamId) : null;
  if (!target || target.kind !== "ssh_static" || !publishScope || !scope || !profile || !host) throw fail("site_tls_deployment_configuration_incomplete", "Complete the certificate range and activation profile setup first.");
  if (scope.purpose !== "tls_certificate" || scope.status !== "ready" || !scope.permissions?.includes("certificate_write")) throw fail("site_tls_certificate_scope_not_ready", "The certificate-only range is not ready.");
  if (profile.status !== "ready" || profile.type !== "docker_nginx" || profile.sshTargetId !== host.id || profile.certificateScopeId !== scope.id) throw fail("site_tls_activation_profile_not_ready", "The fixed Docker Nginx activation profile is not ready.");
  if (publishScope.sshTargetId !== host.id || publishScope.lastResolvedAddress !== scope.lastResolvedAddress) throw fail("site_tls_host_binding_mismatch", "The website and certificate ranges must use the same verified host address.");
  if (host.connectionStatus !== "ready" || !host.purposes?.some((purpose) => ["site_publish", "tls_certificate"].includes(purpose)) || !host.capabilities?.sftp || !host.capabilities?.posixRename || !host.capabilities?.symlink) throw fail("site_tls_host_not_ready", "The SSH host is not ready for atomic certificate activation.");
  return { scope, profile, host };
}

export function createSshTlsCertificateAdapter({ state, sshHostConnector, resolveCredential, stagingCaPem = process.env.MYAGENTTOOL_ACME_STAGING_CA_PEM ?? "", verifyHttps = defaultVerifyHttps } = {}) {
  async function deployStaging({ binding, artifact }) {
    const { scope, profile, host } = linkedContext(state, binding);
    if (artifact.hostname !== binding.hostname || artifact.fingerprint !== binding.certificateFingerprint) throw fail("site_domain_staging_artifact_mismatch", "The staged certificate no longer matches this HTTPS binding.");
    const files = certificateFiles(artifact.certificate);
    verifyKeyPair(files.cert, artifact.privateKey);
    const releaseId = `staging-${artifact.fingerprint.slice(0, 32)}`;
    if (!SAFE_RELEASE_ID.test(releaseId)) throw fail("site_tls_release_id_invalid", "The certificate release identifier is invalid.");
    const credential = await resolveCredential(host.credentialRef);
    if (!credential?.ok) throw fail(credential?.error ?? "site_tls_ssh_credential_unavailable", "The SSH credential is unavailable.");
    const root = scope.resolvedRootPath;
    const releases = posix.join(root, "releases");
    const release = posix.join(releases, releaseId);
    const pending = posix.join(root, `.pending-${releaseId}`);
    const current = posix.join(root, "current");
    const next = posix.join(root, `.current-${releaseId}`);
    let previous = null;
    let previousFingerprint = null;
    let switched = false;
    let promoted = false;
    let reloadAttempted = false;
    const manifest = Buffer.from(`${JSON.stringify({ version: 1, bindingId: binding.id, hostname: binding.hostname, environment: "staging", fingerprint: artifact.fingerprint, releaseId })}\n`);
    const fixedAction = async (action) => {
      const result = await sshHostConnector.runFixedCommand(host, credential.credential, action, { containerName: profile.containerName }, { operationTimeoutMs: OPERATION_TIMEOUT_MS });
      if (result.resolvedAddress !== scope.lastResolvedAddress) throw fail("site_tls_target_address_changed", "The host address changed during certificate activation.");
    };
    const cleanupRelease = async () => {
      const cleaned = await sshHostConnector.runSftp(host, credential.credential, async (sftp) => {
        for (const name of ["cert.pem", "chain.pem", "fullchain.pem", "privkey.pem", "manifest.json"]) await sftpCall(sftp, "unlink", posix.join(release, name));
        await sftpCall(sftp, "rmdir", release);
      }, { operationTimeoutMs: OPERATION_TIMEOUT_MS });
      if (cleaned.resolvedAddress !== scope.lastResolvedAddress) throw fail("site_tls_target_address_changed", "The host address changed during certificate recovery.");
    };
    const restorePrevious = async () => {
      if (!previous && reloadAttempted) throw fail("site_tls_recovery_failed", "The first certificate reload could not be safely reversed without a previous certificate.");
      const restored = await sshHostConnector.runSftp(host, credential.credential, async (sftp) => {
        if (previous) {
          const restore = posix.join(root, `.restore-${releaseId}`);
          await sftpCall(sftp, "symlink", posix.relative(root, previous), restore);
          await sftpCall(sftp, "ext_openssh_rename", restore, current);
        } else {
          try {
            await sftpCall(sftp, "unlink", current);
          } catch (error) {
            if (!missing(error)) throw error;
          }
        }
        try {
          await sftpCall(sftp, "unlink", next);
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }, { operationTimeoutMs: OPERATION_TIMEOUT_MS });
      if (restored.resolvedAddress !== scope.lastResolvedAddress) throw fail("site_tls_target_address_changed", "The host address changed during certificate recovery.");
      if (previous) {
        await fixedAction("docker_nginx_config_test");
        await fixedAction("docker_nginx_reload");
        await verifyHttps({ address: scope.lastResolvedAddress, hostname: binding.hostname, fingerprint: previousFingerprint, ca: stagingCaPem });
      }
      await cleanupRelease();
    };
    let upload;
    try {
      upload = await sshHostConnector.runSftp(host, credential.credential, async (sftp) => {
      const resolvedRoot = posix.normalize(String(await sftpCall(sftp, "realpath", root)));
      if (resolvedRoot !== root) throw fail("site_tls_scope_changed", "The certificate range no longer resolves to its verified path.");
      await ensureDirectory(sftp, root);
      await ensureDirectory(sftp, releases);
      if (await optionalLstat(sftp, release)) throw fail("site_tls_release_exists", "This certificate release already exists. Request a new staging certificate.");
      if (await optionalLstat(sftp, pending)) throw fail("site_tls_pending_release_exists", "A previous certificate staging directory requires attention.");
      await ensureDirectory(sftp, pending);
      try {
        await writeFile(sftp, posix.join(pending, "cert.pem"), files.cert, 0o644);
        await writeFile(sftp, posix.join(pending, "chain.pem"), files.chain.length > 1 ? files.chain : files.cert, 0o644);
        await writeFile(sftp, posix.join(pending, "fullchain.pem"), files.fullchain, 0o644);
        await writeFile(sftp, posix.join(pending, "privkey.pem"), artifact.privateKey, 0o600);
        await writeFile(sftp, posix.join(pending, "manifest.json"), manifest, 0o644);
        const remoteCert = await readFile(sftp, posix.join(pending, "cert.pem"));
        const remoteKey = await readFile(sftp, posix.join(pending, "privkey.pem"));
        try {
          if (sha256(remoteCert) !== sha256(files.cert) || sha256(remoteKey) !== sha256(artifact.privateKey)) throw fail("site_tls_remote_digest_mismatch", "A certificate file changed during upload.");
          verifyKeyPair(remoteCert, remoteKey);
        } finally {
          remoteKey.fill(0);
        }
        await sftpCall(sftp, "rename", pending, release);
        promoted = true;
        const currentAttrs = await optionalLstat(sftp, current);
        if (currentAttrs) {
          if (attrsType(currentAttrs) !== "symlink") throw fail("site_tls_current_pointer_invalid", "The managed certificate pointer is not a symbolic link.");
          previous = posix.normalize(String(await sftpCall(sftp, "realpath", current)));
          if (!previous.startsWith(`${releases}/`)) throw fail("site_tls_current_pointer_invalid", "The active certificate pointer leaves the managed release directory.");
          try {
            const previousManifest = JSON.parse((await readFile(sftp, posix.join(previous, "manifest.json"))).toString("utf8"));
            if (previousManifest.hostname !== binding.hostname || !/^[a-f0-9]{64}$/.test(String(previousManifest.fingerprint ?? ""))) throw new Error("invalid");
            previousFingerprint = previousManifest.fingerprint;
          } catch {
            throw fail("site_tls_previous_release_invalid", "The previous certificate release cannot be verified for safe recovery.");
          }
        }
        await sftpCall(sftp, "symlink", posix.relative(root, release), next);
        // From this point the remote outcome is uncertain until the OpenSSH
        // extension acknowledges the atomic replacement.
        switched = true;
        await sftpCall(sftp, "ext_openssh_rename", next, current);
        return { releasePath: release, previous };
      } catch (error) {
        if (!switched) {
          const abandoned = promoted ? release : pending;
          for (const name of ["cert.pem", "chain.pem", "fullchain.pem", "privkey.pem", "manifest.json"]) await sftpCall(sftp, "unlink", posix.join(abandoned, name)).catch(() => {});
          await sftpCall(sftp, "rmdir", abandoned).catch(() => {});
        }
        throw error;
      }
      }, { operationTimeoutMs: OPERATION_TIMEOUT_MS });
    } catch (uploadError) {
      if (!switched) throw uploadError;
      try { await restorePrevious(); } catch { throw fail("site_tls_recovery_failed", "Certificate activation became uncertain and the previous certificate could not be restored."); }
      throw uploadError instanceof SiteDomainTlsAdapterError ? uploadError : fail("site_tls_upload_result_uncertain", "Certificate upload became uncertain after the atomic switch.", true);
    }
    try {
      if (upload.resolvedAddress !== scope.lastResolvedAddress) throw fail("site_tls_target_address_changed", "The host address changed during certificate upload.");
      await fixedAction("docker_nginx_config_test");
      reloadAttempted = true;
      await fixedAction("docker_nginx_reload");
      await verifyHttps({ address: scope.lastResolvedAddress, hostname: binding.hostname, fingerprint: artifact.fingerprint, ca: stagingCaPem });
    } catch (activationError) {
      try {
        await restorePrevious();
      } catch {
        throw fail("site_tls_recovery_failed", "Certificate activation failed and the previous certificate could not be restored.");
      }
      throw activationError instanceof SiteDomainTlsAdapterError ? activationError : fail("site_tls_activation_failed", "The new certificate could not be activated.", true);
    }
    return { releaseId, releasePath: release, previousReleasePath: previous, activationProfileId: profile.id, resolvedAddress: scope.lastResolvedAddress };
  }

  return { deployStaging };
}
