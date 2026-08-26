import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import ssh2 from "ssh2";
import {
  classifySshAddress,
  createSshHostConnector,
  resolveSshHostAddress,
  sshHostFingerprint,
} from "../src/services/ssh-host-connector.mjs";

const HOST_KEY = Buffer.from("test-host-public-key");
const { Server, utils } = ssh2;

function fakeClientClass({ hostKey = HOST_KEY, sftp = { _version: 3, _extensions: { "posix-rename@openssh.com": "1" }, symlink() {} }, execHandler = null } = {}) {
  return class FakeClient extends EventEmitter {
    static connections = [];
    connect(options) {
      this.constructor.connections.push(options);
      const accepted = options.hostVerifier(hostKey);
      setImmediate(() => accepted ? this.emit("ready") : this.emit("error", Object.assign(new Error("rejected"), { level: "handshake" })));
    }
    sftp(callback) { callback(null, sftp); }
    exec(command, options, callback) { execHandler?.(command, options, callback); }
    end() { this.ended = true; }
  };
}

test("classifies forbidden, private, and public SSH destinations", async () => {
  assert.equal(classifySshAddress("127.0.0.1"), "forbidden");
  assert.equal(classifySshAddress("169.254.169.254"), "forbidden");
  assert.equal(classifySshAddress("10.0.0.4"), "private");
  assert.equal(classifySshAddress("8.8.8.8"), "public");
  assert.equal(classifySshAddress("0:0:0:0:0:0:0:1"), "forbidden");
  assert.equal(classifySshAddress("2001:0db8:0:0:0:0:0:1"), "forbidden");
  assert.equal(classifySshAddress("::ffff:7f00:1"), "forbidden");
  assert.equal(classifySshAddress("::ffff:192.168.1.5"), "private");
  assert.equal(classifySshAddress("64:ff9b::a9fe:a9fe"), "forbidden");
  assert.equal(classifySshAddress("2002:7f00:0001::"), "forbidden");
  assert.equal(classifySshAddress("fd00:0:0:0:0:0:0:1"), "private");
  assert.equal(classifySshAddress("2606:4700:4700::1111"), "public");
  await assert.rejects(() => resolveSshHostAddress("private.test", { lookup: async () => [{ address: "192.168.1.5", family: 4 }] }), { code: "ssh_host_private_network_blocked" });
  assert.equal((await resolveSshHostAddress("private.test", { networkPolicy: "allow_private_network", lookup: async () => [{ address: "192.168.1.5", family: 4 }] })).address, "192.168.1.5");
});

test("observes a host key on a pinned resolved address without authenticating", async () => {
  const ClientClass = fakeClientClass();
  const connector = createSshHostConnector({ ClientClass, lookup: async () => [{ address: "93.184.216.20", family: 4 }] });
  const observed = await connector.observeFingerprint({ host: "host.example", port: 22, user: "deploy", networkPolicy: "public_only" });
  assert.equal(observed.fingerprint, sshHostFingerprint(HOST_KEY));
  assert.equal(observed.resolvedAddress, "93.184.216.20");
  const options = ClientClass.connections[0];
  assert.equal(options.host, "93.184.216.20", "the verified DNS answer is pinned into the socket connection");
  assert.equal("privateKey" in options, false);
  assert.equal("password" in options, false);
  assert.equal(options.agentForward, false);
});

test("verifies the pinned fingerprint, credential, and SFTP capabilities", async () => {
  const ClientClass = fakeClientClass();
  const connector = createSshHostConnector({ ClientClass, lookup: async () => [{ address: "93.184.216.21", family: 4 }] });
  const result = await connector.verifyConnection({
    host: "host.example", port: 22, user: "deploy", authMethod: "private_key_ref", networkPolicy: "public_only",
    knownHostFingerprint: sshHostFingerprint(HOST_KEY),
  }, { privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----", passphrase: "secret" });
  assert.deepEqual(result.capabilities, { sftp: true, sftpVersion: 3, posixRename: true, symlink: true });
  assert.equal(result.fingerprint, sshHostFingerprint(HOST_KEY));
  assert.equal(ClientClass.connections[0].privateKey.includes("OPENSSH"), true);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("fails closed when the observed fingerprint changes", async () => {
  const ClientClass = fakeClientClass();
  const connector = createSshHostConnector({ ClientClass, lookup: async () => [{ address: "93.184.216.22", family: 4 }] });
  await assert.rejects(() => connector.verifyConnection({
    host: "host.example", port: 22, user: "deploy", authMethod: "password_ref", networkPolicy: "public_only",
    knownHostFingerprint: sshHostFingerprint(Buffer.from("different-key")),
  }, { password: "do-not-leak" }), { code: "ssh_host_fingerprint_changed" });
});

test("SFTP callback preserves only explicitly safe deployment failures", async () => {
  const ClientClass = fakeClientClass();
  const connector = createSshHostConnector({ ClientClass, lookup: async () => [{ address: "93.184.216.23", family: 4 }] });
  const target = {
    host: "host.example", port: 22, user: "deploy", authMethod: "password_ref", networkPolicy: "public_only",
    knownHostFingerprint: sshHostFingerprint(HOST_KEY),
  };
  await assert.rejects(
    connector.runSftp(target, { password: "secret" }, async () => {
      throw Object.assign(new Error("Safe bounded detail."), {
        code: "site_deployment_remote_layout_conflict",
        safeForSftpBoundary: true,
      });
    }),
    { code: "site_deployment_remote_layout_conflict" },
  );
  await assert.rejects(
    connector.runSftp(target, { password: "secret" }, async () => { throw Object.assign(new Error("password=secret"), { code: "unsafe_detail" }); }),
    (error) => error.code === "ssh_sftp_operation_failed" && !error.message.includes("secret"),
  );
});

test("fixed Docker Nginx actions accept only bounded container names and predefined commands", async () => {
  const commands = [];
  const ClientClass = fakeClientClass({ execHandler: (command, options, callback) => {
    commands.push({ command, options });
    const stream = new EventEmitter();
    stream.stderr = { resume() {} };
    callback(null, stream);
    setImmediate(() => {
      if (command.startsWith("docker inspect")) stream.emit("data", Buffer.from("true\n"));
      stream.emit("close", 0);
    });
  } });
  const connector = createSshHostConnector({ ClientClass, lookup: async () => [{ address: "93.184.216.24", family: 4 }] });
  const target = { host: "host.example", port: 22, user: "deploy", authMethod: "password_ref", networkPolicy: "public_only", knownHostFingerprint: sshHostFingerprint(HOST_KEY) };
  await connector.runFixedCommand(target, { password: "secret" }, "docker_nginx_inspect", { containerName: "site-nginx_1" });
  await connector.runFixedCommand(target, { password: "secret" }, "docker_nginx_config_test", { containerName: "site-nginx_1" });
  await connector.runFixedCommand(target, { password: "secret" }, "docker_nginx_reload", { containerName: "site-nginx_1" });
  assert.deepEqual(commands.map((item) => item.command), [
    "docker inspect --format '{{.State.Running}}' site-nginx_1",
    "docker exec site-nginx_1 nginx -t",
    "docker kill --signal=HUP site-nginx_1",
  ]);
  assert.equal(commands.every((item) => item.options.pty === false), true);
  await assert.rejects(connector.runFixedCommand(target, { password: "secret" }, "docker_nginx_reload", { containerName: "site-nginx; id" }), { code: "ssh_fixed_command_parameter_invalid" });
  await assert.rejects(connector.runFixedCommand(target, { password: "secret" }, "shell", { containerName: "site-nginx" }), { code: "ssh_fixed_command_unsupported" });
});

test("completes real SSH fingerprint observation, authentication, and SFTP negotiation", async (t) => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const parsedKey = utils.parseKey(privateKey);
  assert.equal(parsedKey instanceof Error, false);
  const expectedFingerprint = sshHostFingerprint(parsedKey.getPublicSSH());
  const server = new Server({ hostKeys: [privateKey] }, (client) => {
    client.on("error", () => {});
    client.on("authentication", (context) => {
      if (context.method === "password" && context.username === "deploy" && context.password === "test-password") context.accept();
      else context.reject();
    });
    client.on("ready", () => {
      client.on("session", (accept) => {
        const session = accept();
        session.on("sftp", (acceptSftp) => acceptSftp());
      });
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const connector = createSshHostConnector({
    resolveAddress: async () => ({ address: "127.0.0.1", family: 4, resolvedAddresses: ["127.0.0.1"] }),
    timeoutMs: 5_000,
  });

  const observed = await connector.observeFingerprint({
    host: "local-test.invalid",
    port,
    user: "deploy",
    networkPolicy: "public_only",
  });

  assert.equal(observed.fingerprint, expectedFingerprint);
  assert.equal(observed.resolvedAddress, "127.0.0.1");

  const verified = await connector.verifyConnection({
    host: "local-test.invalid",
    port,
    user: "deploy",
    authMethod: "password_ref",
    networkPolicy: "public_only",
    knownHostFingerprint: observed.fingerprint,
  }, { password: "test-password" });
  assert.equal(verified.fingerprint, expectedFingerprint);
  assert.equal(verified.capabilities.sftp, true);
  assert.equal(verified.capabilities.sftpVersion, 3);
  assert.equal(verified.capabilities.posixRename, false);
});
