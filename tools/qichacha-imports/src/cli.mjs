#!/usr/bin/env node
// CLI entry point for the Qichacha Playwright renderer subprocess.
//
// Contract (mirrors tools/zhihu-imports/src/cli.mjs):
//   argv:   <url> | --probe | --login  [--headed] [--profile <dir>] [--channel <name>]
//   stdout: on success, a single JSON object — render: {"ok":true,"url":"<resolved>","html":"<rendered>"},
//           probe: {"ok":true,"loggedIn":true,"detail":"qcc-token present"} — followed by a
//           newline. No JSON is written on failure. (--login writes only guidance
//           + cookie names to stderr and emits no JSON.)
//   exit:   0 success · 1 usage error · 2 render/fetch/probe/login failure
//   stderr: a single human-readable line on failure ("qichacha-imports failed: <msg>").
//
// This process owns NO disk writes beyond the persistent profile's browser
// state, and downloads NOTHING. It only renders the page and returns its HTML;
// the parent reuses the article-imports pipeline.
//
// Auth: qichacha content sits behind a login wall (see fetch-doc.mjs). Seed a
// logged-in profile once with `--login --profile <dir>` (or
// QICHACHA_PROFILE_DIR), then render reuses it. Without a profile the render
// still runs but real qichacha content will time out → exit 2.

import { parseQichachaUrl, QichachaUrlError } from "./parse-url.mjs";
import { resolveConfig } from "./config.mjs";
import { loginQichachaProfile, renderQichachaPage } from "./fetch-doc.mjs";
import { probeQichachaSession } from "./health-probe.mjs";

const USAGE = "usage: qichacha-imports <url> | --probe | --login [--headed] [--profile <dir>] [--channel <name>]\n";

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
        process.stderr.write("qichacha-imports: --channel requires a name argument\n");
        process.stderr.write(USAGE);
        return 1;
      }
    } else if (a.startsWith("--channel=")) {
      channelOverride = a.slice("--channel=".length);
    } else if (a === "--profile") {
      profileOverride = argv[++i];
      if (!profileOverride) {
        process.stderr.write("qichacha-imports: --profile requires a directory argument\n");
        process.stderr.write(USAGE);
        return 1;
      }
    } else if (a.startsWith("--profile=")) {
      profileOverride = a.slice("--profile=".length);
    } else if (a.startsWith("--")) {
      process.stderr.write(`qichacha-imports: unknown option '${a}'\n`);
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

  // --login seeds a persistent profile with a logged-in qichacha session. It
  // needs no URL and writes no success JSON — it just captures the auth cookie.
  if (login) {
    try {
      await loginQichachaProfile({ config });
      return 0;
    } catch (err) {
      process.stderr.write(`qichacha-imports failed: ${(err && err.message) || err}\n`);
      return 2;
    }
  }

  // --probe reports whether the profile's session is still logged in
  // ({"ok":true,"loggedIn":bool,"detail"}). loggedIn:false is exit 0 — it is a
  // health finding, not a probe failure. The probe never touches /firm/*.
  if (probe) {
    if (positional.length !== 0) {
      process.stderr.write(USAGE);
      return 1;
    }
    try {
      const result = await probeQichachaSession({ config });
      process.stdout.write(JSON.stringify(result) + "\n");
      return 0;
    } catch (err) {
      process.stderr.write(`qichacha-imports failed: ${(err && err.message) || err}\n`);
      return 2;
    }
  }

  if (positional.length !== 1) {
    process.stderr.write(USAGE);
    return 1;
  }

  let parsed;
  try {
    parsed = parseQichachaUrl(positional[0]);
  } catch (err) {
    if (err instanceof QichachaUrlError) {
      process.stderr.write(`qichacha-imports: ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  try {
    const { url, html } = await renderQichachaPage({ url: parsed.canonicalUrl, config });
    if (!html || html.trim() === "") {
      throw new Error("Rendered page HTML was empty.");
    }
    process.stdout.write(JSON.stringify({ ok: true, url, html }) + "\n");
    return 0;
  } catch (err) {
    const msg = (err && err.message) || String(err);
    process.stderr.write(`qichacha-imports failed: ${msg}\n`);
    return 2;
  }
}

const code = await main();
process.exit(code);
