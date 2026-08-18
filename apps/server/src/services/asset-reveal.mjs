import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { dirname } from "node:path";
import { resolveConfinedAssetPath } from "./asset-capabilities.mjs";

function launchDetached(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export async function revealAssetInFileManager({ projectRoot, relativePath, platform = process.platform, launch = launchDetached }) {
  const confined = resolveConfinedAssetPath(projectRoot, relativePath);
  await revealFileInFileManager({ target: confined.target, platform, launch });
  return { revealed: true, path: confined.relativePath };
}

export async function openAssetInSystemApplication({ projectRoot, relativePath, platform = process.platform, launch = launchDetached }) {
  const confined = resolveConfinedAssetPath(projectRoot, relativePath);
  if (!statSync(confined.target).isFile()) {
    const error = new Error("asset_not_file");
    error.code = "asset_not_file";
    throw error;
  }
  const command = platform === "win32" ? "rundll32.exe" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32"
    ? ["url.dll,FileProtocolHandler", confined.target]
    : [confined.target];
  await launch(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  return { opened: true, path: confined.relativePath };
}

export async function revealFileInFileManager({ target, platform = process.platform, launch = launchDetached }) {
  if (!statSync(target).isFile()) {
    const error = new Error("asset_not_file");
    error.code = "asset_not_file";
    throw error;
  }
  const command = platform === "win32" ? "explorer.exe" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32"
    ? [`/select,${target}`]
    : platform === "darwin"
      ? ["-R", target]
      : [dirname(target)];
  await launch(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: platform !== "win32",
  });
  return { revealed: true };
}
