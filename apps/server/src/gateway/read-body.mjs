/*
 * Read a request body as bytes, capped (code-review M3). Accumulates raw Buffer
 * chunks and decodes ONCE — decoding each chunk independently corrupts a
 * multibyte UTF-8 character split across TCP chunk boundaries (bit DingTalk's
 * plaintext Chinese `text.content`). The cap counts BYTES, not UTF-16 code
 * units, so a CJK body cannot slip past a char-length check.
 */
export async function readCappedBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) return { raw: "", overflow: true };
    chunks.push(buf);
  }
  return { raw: Buffer.concat(chunks).toString("utf8"), overflow: false };
}
