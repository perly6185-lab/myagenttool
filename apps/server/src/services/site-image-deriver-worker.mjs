import { createCanvas, loadImage } from "@napi-rs/canvas";

const DERIVATIVE_WIDTHS = Object.freeze([480, 960, 1440]);
const MAX_SOURCE_PIXELS = 40_000_000;
const MAX_SOURCE_SIDE = 12_000;
const chunks = [];

try {
  for await (const chunk of process.stdin) chunks.push(chunk);
  const image = await loadImage(Buffer.concat(chunks));
  const width = Math.round(Number(image.width));
  const height = Math.round(Number(image.height));
  if (!width || !height || width > MAX_SOURCE_SIDE || height > MAX_SOURCE_SIDE || width * height > MAX_SOURCE_PIXELS) {
    throw new Error("site_asset_dimensions_unsupported");
  }
  const targetWidths = DERIVATIVE_WIDTHS.filter((candidate) => candidate < width);
  targetWidths.push(Math.min(width, DERIVATIVE_WIDTHS.at(-1)));
  const variants = [];
  for (const targetWidth of [...new Set(targetWidths)].sort((left, right) => left - right)) {
    const targetHeight = Math.max(1, Math.round(height * (targetWidth / width)));
    const canvas = createCanvas(targetWidth, targetHeight);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    variants.push({
      key: `w${targetWidth}`,
      width: targetWidth,
      height: targetHeight,
      bytes: canvas.toBuffer("image/webp", 82).toString("base64"),
    });
  }
  process.stdout.write(JSON.stringify({ width, height, variants }));
} catch {
  process.exitCode = 1;
}
