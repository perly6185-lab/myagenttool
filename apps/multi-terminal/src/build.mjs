import { access, readFile } from "node:fs/promises";

const required = [
  new URL("../public/index.html", import.meta.url),
  new URL("../public/app.js", import.meta.url),
  new URL("../public/styles.css", import.meta.url),
];
await Promise.all(required.map((file) => access(file)));
const html = await readFile(required[0], "utf8");
if (!html.includes('id="terminals"') || !html.includes('id="tasks"') || !html.includes('id="alerts"') || !html.includes('id="trace"') || !html.includes('id="recovery"')) {
  throw new Error("multi-terminal shell is missing a required observation surface");
}
if (!process.argv.includes("--check")) console.log("Multi-terminal static build is ready.");
