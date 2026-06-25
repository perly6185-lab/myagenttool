// Image edit/generate core — the one place the capability logic lives.
// Both entry points (cli.mjs for codex, mcp-server.mjs for claude) call editImage.
//
// Provider is chosen by env so no key is hard-coded:
//   IMAGE_PROVIDER = "openai" (default) | "gemini"
//   OPENAI_API_KEY  / OPENAI_IMAGE_MODEL  (default gpt-image-1)
//   GEMINI_API_KEY  / GEMINI_IMAGE_MODEL  (default gemini-2.5-flash-image)
// Missing key -> a clear thrown Error, never a crash.

import fs from "node:fs";
import path from "node:path";

const PROVIDERS = ["openai", "gemini"];

export function resolveProvider() {
  const p = String(process.env.IMAGE_PROVIDER ?? "openai").toLowerCase();
  return PROVIDERS.includes(p) ? p : "openai";
}

function guessMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

// Minimal multipart/form-data builder (no deps). fields: {name,value} | {name,filename,contentType,data:Buffer}
function multipart(parts) {
  const boundary = "----myagentimage" + "0".repeat(16);
  const chunks = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (part.filename) {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.contentType}\r\n\r\n`));
      chunks.push(part.data);
      chunks.push(Buffer.from("\r\n"));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function editOpenAI({ inputBuf, inputName, prompt, size }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set (IMAGE_PROVIDER=openai). Set it or switch IMAGE_PROVIDER.");
  const model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
  const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const fields = [
    { name: "model", value: model },
    { name: "prompt", value: prompt },
    ...(size ? [{ name: "size", value: size }] : [])
  ];
  if (inputBuf) {
    fields.push({ name: "image", filename: inputName ?? "image.png", contentType: guessMime(inputName ?? "image.png"), data: inputBuf });
  }
  const endpoint = inputBuf ? `${base}/images/edits` : `${base}/images/generations`;
  const { body, contentType } = multipart(fields);
  const res = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": contentType }, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI image API ${res.status}: ${json?.error?.message ?? JSON.stringify(json).slice(0, 300)}`);
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI image API returned no image data.");
  return Buffer.from(b64, "base64");
}

async function editGemini({ inputBuf, inputName, prompt }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set (IMAGE_PROVIDER=gemini). Set it or switch IMAGE_PROVIDER.");
  const model = process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";
  const base = process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";
  const parts = [{ text: prompt }];
  if (inputBuf) parts.push({ inline_data: { mime_type: guessMime(inputName ?? "image.png"), data: inputBuf.toString("base64") } });
  const res = await fetch(`${base}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }] })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini image API ${res.status}: ${json?.error?.message ?? JSON.stringify(json).slice(0, 300)}`);
  const out = json?.candidates?.[0]?.content?.parts?.find((p) => p.inline_data?.data || p.inlineData?.data);
  const b64 = out?.inline_data?.data ?? out?.inlineData?.data;
  if (!b64) throw new Error("Gemini image API returned no image data.");
  return Buffer.from(b64, "base64");
}

// Edit (when inputPath given) or generate (when omitted). Writes outputPath and
// returns { provider, outputPath, bytes }.
export async function editImage({ inputPath, prompt, outputPath, size } = {}) {
  if (!prompt || !String(prompt).trim()) throw new Error("A non-empty --prompt is required.");
  if (!outputPath || !String(outputPath).trim()) throw new Error("An explicit --output path is required.");
  let inputBuf = null;
  let inputName = null;
  if (inputPath) {
    if (!fs.existsSync(inputPath)) throw new Error(`Input image not found: ${inputPath}`);
    inputBuf = fs.readFileSync(inputPath);
    inputName = path.basename(inputPath);
  }
  const provider = resolveProvider();
  const outBuf = provider === "gemini"
    ? await editGemini({ inputBuf, inputName, prompt })
    : await editOpenAI({ inputBuf, inputName, prompt, size });
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, outBuf);
  return { provider, outputPath, bytes: outBuf.length };
}
