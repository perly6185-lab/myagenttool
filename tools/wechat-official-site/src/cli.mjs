#!/usr/bin/env node
import { resolveConfig } from "./config.mjs";
import { syncWechatOfficialDraft } from "./draft-sync.mjs";
import { loginWechatOfficialProfile, probeWechatOfficialSession } from "./session.mjs";

const USAGE = "usage: wechat-official-site --login | --probe | --operation draft.sync [--profile <dir>] [--channel <name>]\n";

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(parsed.error + "\n" + USAGE);
    return 1;
  }
  const config = resolveConfig(process.env, parsed.overrides);
  try {
    if (parsed.mode === "login") {
      await loginWechatOfficialProfile({ config });
      return 0;
    }
    if (parsed.mode === "probe") {
      process.stdout.write(JSON.stringify(await probeWechatOfficialSession({ config })) + "\n");
      return 0;
    }
    const request = await readJsonStdin();
    const result = await syncWechatOfficialDraft({ config, articlePackage: request.articlePackage });
    process.stdout.write(JSON.stringify(result) + "\n");
    return 0;
  } catch (error) {
    process.stderr.write(`wechat-official-site failed: ${friendlyError(error)}\n`);
    return 2;
  }
}

function friendlyError(error) {
  const code = String(error?.code ?? error?.message ?? error);
  const messages = {
    session_browser_unavailable: "未找到可用的 Chrome 或 Edge。请安装其中一个浏览器后重试。",
    session_profile_in_use: "公众号登录资料目录正在被另一个浏览器进程使用。请关闭之前打开的公众号登录窗口后重试。",
    wechat_login_timeout: "扫码登录已超时。请重新点击“扫码登录”，并在新打开的窗口中完成扫码。",
  };
  return String(messages[code] ?? code).replace(/(token|secret|cookie)\s*[:=]\s*\S+/gi, "$1=[redacted]").slice(0, 500);
}

function parseArgs(argv) {
  let mode = null;
  const overrides = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--login") mode = mode ? "invalid" : "login";
    else if (arg === "--probe") mode = mode ? "invalid" : "probe";
    else if (arg === "--operation") {
      const operation = argv[++index];
      mode = mode || operation !== "draft.sync" ? "invalid" : "draft.sync";
    } else if (arg === "--profile") overrides.profileDir = argv[++index];
    else if (arg === "--channel") overrides.channel = argv[++index];
    else return { ok: false, error: `unknown option '${arg}'` };
  }
  if (!mode || mode === "invalid" || !overrides.profileDir && argv.includes("--profile")) return { ok: false, error: "choose exactly one valid operation" };
  return { ok: true, mode, overrides };
}

async function readJsonStdin() {
  let value = "";
  for await (const chunk of process.stdin) {
    value += chunk;
    if (Buffer.byteLength(value, "utf8") > 1024 * 1024) throw new Error("site operation input exceeds 1 MiB");
  }
  return JSON.parse(value || "{}");
}

const code = await main();
process.exit(code);
