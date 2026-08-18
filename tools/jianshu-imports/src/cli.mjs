#!/usr/bin/env node
// CLI entry point for the Jianshu Playwright renderer subprocess.
//
// Contract (mirrors tools/xiaohongshu-imports/src/cli.mjs):
//   argv:   <url> | --probe | --login  [--headed] [--profile <dir>] [--channel <name>]
//   stdout: on success, a single JSON object — render: {"ok":true,"url":"<resolved>","html":"<composed>","meta":{title,author,publishedAt}},
//           probe: {"ok":true,"loggedIn":true,"detail":"login marker present (…)"} — followed by a
//           newline. No JSON is written on failure. (--login writes only guidance
//           + cookie names to stderr and emits no JSON.)
//   exit:   0 success · 1 usage error · 2 render/fetch/probe/login failure
//   stderr: a single human-readable line on failure ("jianshu-imports failed: <msg>").
//
// The render's html is a COMPOSED document built from the page's __NEXT_DATA__
// note payload (see fetch-doc.mjs), not the raw page HTML; meta carries the
// authoritative title/author/publishedAt for the parent's override.
//
// This process owns NO disk writes beyond the persistent profile's browser
// state, and downloads NOTHING. The parent reuses the article-imports pipeline.

import { parseJianshuUrl, JianshuUrlError } from "./parse-url.mjs";
import { resolveConfig } from "./config.mjs";
import { loginJianshuProfile, renderJianshuPage } from "./fetch-doc.mjs";
import { probeJianshuSession } from "./health-probe.mjs";

const USAGE = "usage: jianshu-imports <url> | --probe | --login [--headed] [--profile <dir>] [--channel <name>]\n";

async function main() {
  const argv = process.argv.slice(2);
  const positional = [];
  let headlessOverride = null;
  let profileOverride = null;
  let channelOverride = null;
  let login = false;
  let probe = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--headed") {
      headlessOverride = false;
    } else if (a === "--login") {
      login = true;
    } else if (a === "--probe") {
      probe = true;
    } else if (a === "--channel") {
      channelOverride = argv[++i];
      if (!channelOverride) {
        process.stderr.write("jianshu-imports: --channel requires a name argument\n");
        process.stderr.write(USAGE);
        return 1;
      }
    } else if (a.startsWith("--channel=")) {
      channelOverride = a.slice("--channel=".length);
    } else if (a === "--profile") {
      profileOverride = argv[++i];
      if (!profileOverride) {
        process.stderr.write("jianshu-imports: --profile requires a directory argument\n");
        process.stderr.write(USAGE);
        return 1;
      }
    } else if (a.startsWith("--profile=")) {
      profileOverride = a.slice("--profile=".length);
    } else if (a.startsWith("--")) {
      process.stderr.write(`jianshu-imports: unknown option '${a}'\n`);
      process.stderr.write(USAGE);
      return 1;
    } else {
      positional.push(a);
    }
  }

  const baseConfig = resolveConfig(process.env);
  const config = {
    ...baseConfig,
    ...(headlessOverride === null ? {} : { headless: headlessOverride }),
    ...(profileOverride ? { profileDir: profileOverride } : {}),
    ...(channelOverride ? { channel: channelOverride } : {}),
  };

  // --login seeds a persistent profile with a logged-in jianshu session.
  // It needs no URL and writes no success JSON — the DOM marker is the verdict.
  if (login) {
    try {
      await loginJianshuProfile({ config });
      return 0;
    } catch (err) {
      process.stderr.write(`jianshu-imports failed: ${(err && err.message) || err}\n`);
      return 2;
    }
  }

  // --probe reports whether the profile's session is still logged in
  // ({"ok":true,"loggedIn":bool,"detail"}). loggedIn:false is exit 0 — it is a
  // health finding, not a probe failure. The probe never opens an article page.
  if (probe) {
    if (positional.length !== 0) {
      process.stderr.write(USAGE);
      return 1;
    }
    try {
      const result = await probeJianshuSession({ config });
      process.stdout.write(JSON.stringify(result) + "\n");
      return 0;
    } catch (err) {
      process.stderr.write(`jianshu-imports failed: ${(err && err.message) || err}\n`);
      return 2;
    }
  }

  if (positional.length !== 1) {
    process.stderr.write(USAGE);
    return 1;
  }

  let parsed;
  try {
    parsed = parseJianshuUrl(positional[0]);
  } catch (err) {
    if (err instanceof JianshuUrlError) {
      process.stderr.write(`jianshu-imports: ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  try {
    const { url, html, meta } = await renderJianshuPage({ url: parsed.canonicalUrl, config });
    if (!html || html.trim() === "") {
      throw new Error("Rendered page HTML was empty.");
    }
    process.stdout.write(JSON.stringify({ ok: true, url, html, meta }) + "\n");
    return 0;
  } catch (err) {
    const msg = (err && err.message) || String(err);
    process.stderr.write(`jianshu-imports failed: ${msg}\n`);
    return 2;
  }
}

const code = await main();
process.exit(code);
