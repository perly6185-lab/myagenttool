import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const initScript = join(repoRoot, "tools/dev/init-agent-proxy.sh");
const migrateScript = join(repoRoot, "tools/dev/migrate-agent-host.sh");
const bash = findUsableBash();
const bashCommand = bash?.command ?? null;

function findUsableBash() {
  const candidates = unique([
    process.env.MYAGENTTOOL_TEST_BASH,
    ...gitForWindowsBashCandidates(),
    "bash",
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\msys64\\usr\\bin\\bash.exe",
  ].filter(Boolean));
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["-lc", "printf 'ok\\n'; uname -s"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const [marker, uname = ""] = (result.stdout ?? "").trim().split(/\r?\n/);
    if (result.status === 0 && marker === "ok") {
      return {
        command: candidate,
        pathStyle: /^(?:MINGW|MSYS|CYGWIN)/.test(uname) ? "msys" : "posix",
      };
    }
  }
  return null;
}

function gitForWindowsBashCandidates() {
  const result = spawnSync("git", ["--exec-path"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const execPath = (result.stdout ?? "").trim();
  if (result.status !== 0 || !execPath) return [];
  const gitRoot = resolve(execPath, "../../..");
  return [
    join(gitRoot, "bin", "bash.exe"),
    join(gitRoot, "usr", "bin", "bash.exe"),
  ];
}

function unique(values) {
  return Array.from(new Set(values));
}

function shellPath(path) {
  if (bash?.pathStyle !== "msys") return path;
  const normalized = path.replaceAll("\\", "/");
  const match = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  return match ? `/${match[1].toLowerCase()}/${match[2]}` : normalized;
}

function shellEnvValue(value) {
  return typeof value === "string" && /^[A-Za-z]:[\\/]/.test(value) ? shellPath(value) : value;
}

function hostScriptTest(name, fn) {
  test(name, bashCommand ? {} : { skip: "requires a usable bash shell" }, fn);
}

function fixture(t, label) {
  const root = mkdtempSync(join(tmpdir(), `myagenttool-${label}-`));
  const home = join(root, "home");
  const mockBin = join(root, "mock-bin");
  const temp = join(root, "tmp");
  mkdirSync(home, { recursive: true });
  mkdirSync(mockBin, { recursive: true });
  mkdirSync(temp, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, home, mockBin, temp };
}

function writeExecutable(path, lines) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  chmodSync(path, 0o755);
}

function isolatedEnv({ home, mockBin, temp }, extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(?:https?|all|no)_proxy$/i.test(key) || key.startsWith("AGENT_PROXY_")) {
      delete env[key];
    }
    if (key.toUpperCase() === "PATH") {
      delete env[key];
    }
  }
  delete env.BASH_ENV;
  delete env.ENV;
  return {
    ...env,
    HOME: shellPath(home),
    PATH: `${shellPath(mockBin)}:/usr/local/bin:/usr/bin:/bin`,
    TMPDIR: shellPath(temp),
    LC_ALL: "C",
    LANG: "C",
    ...(bash?.pathStyle === "msys" ? { MSYS: "winsymlinks:nativestrict" } : {}),
    ...Object.fromEntries(Object.entries(extra).map(([key, value]) => [key, shellEnvValue(value)])),
  };
}

function runShell(script, args, env) {
  const shellEnv = { ...env, MYAGENTTOOL_TEST_PATH: env.PATH };
  return spawnSync(bashCommand ?? "bash", [
    "--noprofile",
    "--norc",
    "-c",
    'export PATH="$MYAGENTTOOL_TEST_PATH"; exec "$BASH" "$@"',
    "myagenttool-test",
    shellPath(script),
    ...args,
  ], {
    cwd: repoRoot,
    env: shellEnv,
    encoding: "utf8",
    timeout: 15_000,
  });
}

function diagnostic(result) {
  return [
    `status=${result.status}`,
    result.error ? `error=${result.error.message}` : "",
    `stdout:\n${result.stdout}`,
    `stderr:\n${result.stderr}`,
  ].filter(Boolean).join("\n");
}

hostScriptTest("init propagates a curl transport failure during network verification", (t) => {
  const state = fixture(t, "init-curl-failure");
  const curlLog = join(state.root, "curl.log");

  writeExecutable(join(state.mockBin, "timeout"), [
    "#!/usr/bin/env bash",
    "exit 0",
  ]);
  writeExecutable(join(state.mockBin, "systemctl"), [
    "#!/usr/bin/env bash",
    "printf 'active\\n'",
    "exit 0",
  ]);
  writeExecutable(join(state.mockBin, "curl"), [
    "#!/usr/bin/env bash",
    "printf '%s\\n' \"$*\" >> \"$MOCK_CURL_LOG\"",
    "case \"$*\" in",
    "  *cdn-cgi/trace*) printf 'loc=US\\ncolo=TEST\\n'; exit 0 ;;",
    "esac",
    "printf 'mock curl transport failure\\n' >&2",
    "exit 28",
  ]);

  const result = runShell(initScript, [], isolatedEnv(state, { MOCK_CURL_LOG: curlLog }));

  assert.ok(existsSync(curlLog), `mock curl was not called\n${diagnostic(result)}`);
  assert.notEqual(result.status, 0, `curl failure was swallowed\n${diagnostic(result)}`);
});

hostScriptTest("an unexpected awk failure leaves a symlinked bashrc untouched", (t) => {
  const state = fixture(t, "init-awk-failure");
  const profileDir = join(state.home, "profile");
  const realBashrc = join(profileDir, "bashrc");
  const bashrc = join(state.home, ".bashrc");
  const original = "# existing user configuration\nexport KEEP_ME=yes\n";
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(realBashrc, original, "utf8");
  symlinkSync(realBashrc, bashrc);

  writeExecutable(join(state.mockBin, "awk"), [
    "#!/usr/bin/env bash",
    "printf 'partial output from failed awk\\n'",
    "exit 70",
  ]);

  const result = runShell(initScript, ["--install-only"], isolatedEnv(state));

  assert.notEqual(result.status, 0, `unexpected awk status was ignored\n${diagnostic(result)}`);
  assert.ok(lstatSync(bashrc).isSymbolicLink(), "the .bashrc symlink was replaced");
  assert.equal(readFileSync(realBashrc, "utf8"), original, "the symlink target was modified");
});

hostScriptTest("wrappers installed in a custom bin directory remain self-contained", (t) => {
  const state = fixture(t, "init-custom-bin");
  const customBin = join(state.home, "agent-bin");
  const userBin = join(state.home, "launcher-bin");
  const bashrc = join(state.home, "shell", "bashrc");
  const realClaude = join(state.home, "claude-real-fixture");
  mkdirSync(customBin, { recursive: true });
  mkdirSync(dirname(bashrc), { recursive: true });

  writeExecutable(realClaude, [
    "#!/usr/bin/env bash",
    "printf 'HTTPS_PROXY=%s\\n' \"${HTTPS_PROXY:-unset}\"",
  ]);
  symlinkSync(realClaude, join(customBin, "claude"));
  writeExecutable(join(state.mockBin, "timeout"), [
    "#!/usr/bin/env bash",
    "exit 0",
  ]);
  writeExecutable(join(state.mockBin, "date"), [
    "#!/usr/bin/env bash",
    "printf '20260717010101\\n'",
  ]);

  const installResult = runShell(initScript, ["--install-only"], isolatedEnv(state, {
    AGENT_PROXY_BIN_DIR: customBin,
    AGENT_PROXY_USER_BIN_DIR: userBin,
    AGENT_PROXY_BASHRC: bashrc,
  }));
  assert.equal(installResult.status, 0, `custom installation failed\n${diagnostic(installResult)}`);
  assert.ok(existsSync(join(customBin, "with-agent-proxy")), "custom proxy helper is missing");

  const runtimeResult = runShell(join(customBin, "claude"), ["--version"], isolatedEnv(state));
  assert.equal(runtimeResult.status, 0, `custom wrapper failed without installer env\n${diagnostic(runtimeResult)}`);
  assert.match(runtimeResult.stdout, /HTTPS_PROXY=http:\/\/127\.0\.0\.1:7897/);

  const bashrcText = readFileSync(bashrc, "utf8");
  assert.ok(bashrcText.includes(shellPath(customBin)), "bashrc PATH does not include the custom wrapper directory");
  assert.ok(bashrcText.includes(shellPath(userBin)), "bashrc PATH does not include the custom launcher directory");

  const repeatResult = runShell(initScript, ["--install-only"], isolatedEnv(state, {
    AGENT_PROXY_BIN_DIR: customBin,
    AGENT_PROXY_USER_BIN_DIR: userBin,
    AGENT_PROXY_BASHRC: bashrc,
  }));
  assert.equal(repeatResult.status, 0, `repeated custom installation failed\n${diagnostic(repeatResult)}`);
  assert.equal(readFileSync(bashrc, "utf8"), bashrcText, "repeated installation changed bashrc content");

  const backupPrefix = `${bashrc.split(/[\\/]/).at(-1)}.bak-agent-proxy-20260717010101.`;
  const backups = readdirSync(dirname(bashrc)).filter((name) => name.startsWith(backupPrefix));
  assert.equal(backups.length, 2, `same-second runs did not retain distinct backups: ${backups.join(", ")}`);
  assert.ok(
    backups.some((name) => readFileSync(join(dirname(bashrc), name), "utf8") === ""),
    "the original empty bashrc backup was overwritten",
  );
});

hostScriptTest("migration with both payloads skipped does not contact or preflight the source", (t) => {
  const state = fixture(t, "migrate-verify-only");
  const sshLog = join(state.root, "ssh.log");
  writeExecutable(join(state.mockBin, "ssh"), [
    "#!/usr/bin/env bash",
    "printf 'CALL' >> \"$MOCK_SSH_LOG\"",
    "for arg in \"$@\"; do printf '\\t%s' \"$arg\" >> \"$MOCK_SSH_LOG\"; done",
    "printf '\\n' >> \"$MOCK_SSH_LOG\"",
    "case \"$*\" in",
    "  *'uname -s'*|*'uname -m'*) printf 'Linux x86_64\\n' ;;",
    "  *mktemp*) printf '%s/.cache/agent-host-migrate/run.mocked1234\\n' \"$HOME\" ;;",
    "esac",
    "exit 0",
  ]);

  const result = runShell(migrateScript, [
    "--source", "source.example",
    "--skip-system",
    "--skip-home",
    "--skip-verify",
    "target.example",
  ], isolatedEnv(state, { MOCK_SSH_LOG: sshLog }));

  assert.equal(result.status, 0, `verify-only migration failed\n${diagnostic(result)}`);
  const calls = readFileSync(sshLog, "utf8");
  assert.ok(calls.includes("target.example"), "the target was never contacted");
  assert.ok(!calls.includes("source.example"), `the skipped source was contacted:\n${calls}`);
  assert.ok(!calls.includes("command -v sudo"), `system-only sudo preflight still ran:\n${calls}`);
  assert.ok(!calls.includes("command -v systemctl"), `systemd preflight still ran:\n${calls}`);
  assert.ok(!calls.includes("command -v tar"), `payload tar preflight still ran:\n${calls}`);
  assert.ok(calls.includes("--install-only"), `wrapper refresh did not use install-only mode:\n${calls}`);
  assert.ok(!calls.includes("--check-only"), `--skip-verify still ran proxy verification:\n${calls}`);
  assert.ok(!calls.includes("claude --version"), `--skip-verify still ran CLI verification:\n${calls}`);
});

hostScriptTest("migration supports a POSIX login shell and rolls back skip-home wrapper refresh", (t) => {
  const state = fixture(t, "migrate-dash-rollback");
  const sshLog = join(state.root, "ssh.log");
  const profileDir = join(state.home, "profile");
  const realBashrc = join(profileDir, "bashrc");
  const bashrc = join(state.home, ".bashrc");
  const targetInit = join(state.home, "myagenttool/tools/dev/init-agent-proxy.sh");
  const originalCodex = "#!/usr/bin/env bash\nprintf 'original codex\\n'\n";

  mkdirSync(profileDir, { recursive: true });
  mkdirSync(dirname(targetInit), { recursive: true });
  writeFileSync(realBashrc, "export KEEP_ORIGINAL=yes\n", "utf8");
  symlinkSync(realBashrc, bashrc);
  symlinkSync(initScript, targetInit);
  writeExecutable(join(state.home, ".local/bin/codex"), originalCodex.trimEnd().split("\n"));

  writeExecutable(join(state.mockBin, "ssh"), [
    "#!/usr/bin/env bash",
    "remote_command=\"${!#}\"",
    "printf '%s\\n---\\n' \"$remote_command\" >> \"$MOCK_SSH_LOG\"",
    "exec /bin/dash -c \"$remote_command\"",
  ]);
  writeExecutable(join(state.mockBin, "bash"), [
    "#!/bin/sh",
    "if [ \"$1\" = \"-lc\" ]; then",
    "  shift",
    "  export PATH=\"${MYAGENTTOOL_TEST_PATH:-$PATH}\"",
    "  exec /bin/bash --noprofile --norc -c \"$1\"",
    "fi",
    "exec /bin/bash \"$@\"",
  ]);
  writeExecutable(join(state.mockBin, "uname"), [
    "#!/usr/bin/env bash",
    "case \"$1\" in",
    "  -m) printf 'x86_64\\n' ;;",
    "  *) printf 'Linux\\n' ;;",
    "esac",
  ]);
  writeExecutable(join(state.mockBin, "curl"), [
    "#!/usr/bin/env bash",
    "exit 0",
  ]);
  writeExecutable(join(state.mockBin, "install"), [
    "#!/usr/bin/env bash",
    "if [ \"$1\" = \"-d\" ]; then",
    "  shift",
    "  if [ \"${1:-}\" = \"-m\" ]; then shift 2; fi",
    "  mkdir -p -- \"$@\"",
    "  exit 0",
    "fi",
    "exec /usr/bin/install \"$@\"",
  ]);

  const result = runShell(migrateScript, [
    "--skip-system",
    "--skip-home",
    "target.example",
  ], isolatedEnv(state, {
    AGENT_PROXY_PORTS: "1",
    MOCK_SSH_LOG: sshLog,
  }));

  assert.notEqual(result.status, 0, "forced verification failure unexpectedly passed\n" + diagnostic(result));
  assert.ok(existsSync(sshLog), "migration did not invoke ssh:\n" + diagnostic(result));
  const calls = readFileSync(sshLog, "utf8");
  assert.ok(calls.includes("--install-only"), "migration did not reach wrapper refresh through dash:\n" + calls + "\n" + diagnostic(result));
  assert.ok(calls.includes("bashrc-referent-path"), "home rollback was not attempted:\n" + calls);
  assert.ok(!calls.includes("$" + "'"), "remote command still contains bash-only login-shell quoting:\n" + calls);

  assert.ok(lstatSync(bashrc).isSymbolicLink(), "rollback replaced the bashrc symlink");
  assert.equal(readFileSync(realBashrc, "utf8"), "export KEEP_ORIGINAL=yes\n", "rollback did not restore bashrc referent");
  assert.ok(lstatSync(targetInit).isSymbolicLink(), "rollback replaced the target init-script symlink");
  assert.equal(readlinkSync(targetInit), initScript);
  assert.equal(readFileSync(join(state.home, ".local/bin/codex"), "utf8"), originalCodex);
  assert.ok(!existsSync(join(state.home, ".local/bin/codex-real")), "rollback left codex-real behind");
  assert.ok(!existsSync(join(state.home, ".local/bin/with-agent-proxy")), "rollback left proxy helper behind");
  assert.ok(!existsSync(join(state.home, "bin/init-agent-proxy")), "rollback left launcher behind");
});
