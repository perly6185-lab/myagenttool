import { existsSync } from "node:fs";
import { delimiter, extname, join } from "node:path";

export function bundledAgentEnv({ appRoot, resourcesRoot = appRoot, execPath, env = process.env, platform = process.platform, exists = existsSync }) {
  const patch = {};
  if (!binaryAvailable("codex", { env, platform, exists })) {
    const script = join(appRoot, "node_modules", "@openai", "codex", "bin", "codex.js");
    if (exists(script)) patch.MYAGENTTOOL_CODEX_COMMAND_JSON = JSON.stringify([execPath, script]);
  }
  const packagedClaude = join(appRoot, "node_modules", "@anthropic-ai", "claude-code", "bin", platform === "win32" ? "claude.exe" : "claude");
  if (exists(packagedClaude)) {
    // The SDK and CLI packages are version-aligned and share this one packaged
    // binary. This avoids shipping a second ~250 MB SDK-native executable.
    patch.MYAGENTTOOL_CLAUDE_SDK_EXECUTABLE = packagedClaude;
    if (!binaryAvailable("claude", { env, platform, exists })) {
      patch.MYAGENTTOOL_CLAUDE_COMMAND = packagedClaude;
    }
  }
  if (platform === "win32") {
    const portableRoot = join(resourcesRoot, "portable-git");
    const bash = join(portableRoot, "bin", "bash.exe");
    const git = join(portableRoot, "cmd", "git.exe");
    if (!gitBashAvailable({ env, exists }) && exists(bash)) patch.MYAGENTTOOL_GIT_BASH_COMMAND = bash;
    if (!binaryAvailable("git", { env, platform, exists }) && exists(git)) patch.MYAGENTTOOL_GIT_COMMAND = git;
    if (patch.MYAGENTTOOL_GIT_BASH_COMMAND || patch.MYAGENTTOOL_GIT_COMMAND) {
      patch.PATH = [join(portableRoot, "cmd"), join(portableRoot, "bin"), String(env.PATH ?? "")].filter(Boolean).join(delimiter);
    }
  }
  return patch;
}

export function gitBashAvailable({ env = process.env, exists = existsSync } = {}) {
  const systemDrive = String(env.SystemDrive ?? "C:");
  const candidates = [
    join(systemDrive, "Program Files", "Git", "bin", "bash.exe"),
    join(systemDrive, "Program Files (x86)", "Git", "bin", "bash.exe"),
  ];
  return candidates.some(exists) || binaryAvailable("bash", { env, platform: "win32", exists });
}

export function binaryAvailable(command, { env = process.env, platform = process.platform, exists = existsSync } = {}) {
  const names = platform === "win32" && !extname(command)
    ? String(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD;.PS1").split(";").filter(Boolean).map((extension) => `${command}${extension}`)
    : [command];
  return String(env.PATH ?? "").split(delimiter).filter(Boolean).some((directory) => names.some((name) => exists(join(directory, name))));
}
