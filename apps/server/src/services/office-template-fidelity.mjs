import { deflateRawSync, inflateRawSync } from "node:zlib";

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_ENTRIES = 5_000;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.-]{0,119})\s*\}\}/g;

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function findEnd(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_SIGNATURE) return offset;
  }
  fail("routine_office_template_invalid");
}

function safeEntryName(value) {
  const name = String(value ?? "").replaceAll("\\", "/");
  if (!name || name.startsWith("/") || name.split("/").includes("..") || /^[a-z]:/i.test(name)) {
    fail("routine_office_template_unsafe_archive");
  }
  return name;
}

function readArchive(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) fail("routine_office_template_invalid");
  const end = findEnd(buffer);
  const count = buffer.readUInt16LE(end + 10);
  const centralOffset = buffer.readUInt32LE(end + 16);
  if (count > MAX_ENTRIES || centralOffset >= buffer.length) fail("routine_office_template_too_large");
  const entries = [];
  const names = new Set();
  let offset = centralOffset;
  let totalBytes = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      fail("routine_office_template_invalid");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = safeEntryName(buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    if (names.has(name)) fail("routine_office_template_unsafe_archive");
    names.add(name);
    if ((flags & 1) || ![0, 8].includes(method)) fail("routine_office_template_unsupported_archive");
    if (size > MAX_ENTRY_BYTES || compressedSize > MAX_ENTRY_BYTES) fail("routine_office_template_too_large");
    if (compressedSize > 0 && size / compressedSize > 200) fail("routine_office_template_too_large");
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_BYTES) fail("routine_office_template_too_large");
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      fail("routine_office_template_invalid");
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    if (compressed.length !== compressedSize) fail("routine_office_template_invalid");
    const content = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed);
    if (content.length !== size || crc32(content) !== buffer.readUInt32LE(offset + 16)) {
      fail("routine_office_template_invalid");
    }
    entries.push({
      name,
      content,
      method,
      flags: flags & ~0x08,
      versionMade: buffer.readUInt16LE(offset + 4),
      versionNeeded: buffer.readUInt16LE(offset + 6),
      modTime: buffer.readUInt16LE(offset + 12),
      modDate: buffer.readUInt16LE(offset + 14),
      internalAttributes: buffer.readUInt16LE(offset + 36),
      externalAttributes: buffer.readUInt32LE(offset + 38),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function writeArchive(entries) {
  const locals = [];
  const centrals = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const method = entry.method === 0 ? 0 : 8;
    const compressed = method === 0 ? entry.content : deflateRawSync(entry.content);
    const crc = crc32(entry.content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(entry.versionNeeded || 20, 4);
    local.writeUInt16LE(entry.flags | 0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(entry.modTime, 10);
    local.writeUInt16LE(entry.modDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(entry.versionMade || 20, 4);
    central.writeUInt16LE(entry.versionNeeded || 20, 6);
    central.writeUInt16LE(entry.flags | 0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(entry.modTime, 12);
    central.writeUInt16LE(entry.modDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(entry.internalAttributes, 36);
    central.writeUInt32LE(entry.externalAttributes, 38);
    central.writeUInt32LE(localOffset, 42);
    centrals.push(central, name);
    localOffset += local.length + name.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIGNATURE, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function xmlEscape(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .slice(0, 2_000)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function editableXml(format, name) {
  if (format === "docx") return /^word\/(?:document|header\d*|footer\d*)\.xml$/.test(name);
  return name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(name);
}

function textContainers(xml, format) {
  const pattern = format === "docx"
    ? /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g
    : /<(?:si|is)(?:\s[^>]*)?>[\s\S]*?<\/(?:si|is)>/g;
  const containers = [...xml.matchAll(pattern)];
  return containers.length ? containers : [{ 0: xml, index: 0 }];
}

function transformTextContainer(container, fields = null) {
  const nodePattern = /(<(?:w:)?t(?:\s[^>]*)?>)([\s\S]*?)(<\/(?:w:)?t>)/g;
  const nodes = [...container.matchAll(nodePattern)].map((match) => ({
    prefix: match[1],
    content: match[2],
    suffix: match[3],
    index: match.index,
    length: match[0].length,
  }));
  const plain = nodes.map((node) => node.content).join("");
  const matches = [...plain.matchAll(PLACEHOLDER_RE)];
  if (!matches.length || !fields) {
    return { content: container, keys: matches.map((match) => match[1]), changes: [] };
  }
  const boundaries = [];
  let cursor = 0;
  for (const node of nodes) {
    boundaries.push({ start: cursor, end: cursor + node.content.length });
    cursor += node.content.length;
  }
  const changes = [];
  for (const match of matches.slice().reverse()) {
    const start = match.index;
    const end = start + match[0].length;
    const startIndex = boundaries.findIndex((row) => start >= row.start && start < row.end);
    const endIndex = boundaries.findIndex((row) => end > row.start && end <= row.end);
    if (startIndex < 0 || endIndex < 0) continue;
    const startOffset = start - boundaries[startIndex].start;
    const endOffset = end - boundaries[endIndex].start;
    const trailing = nodes[endIndex].content.slice(endOffset);
    nodes[startIndex].content = `${nodes[startIndex].content.slice(0, startOffset)}${xmlEscape(fields[match[1]])}${startIndex === endIndex ? trailing : ""}`;
    for (let index = startIndex + 1; index < endIndex; index += 1) nodes[index].content = "";
    if (endIndex > startIndex) nodes[endIndex].content = trailing;
    changes.push({ field: match[1], before: match[0], after: String(fields[match[1]]).slice(0, 200) });
  }
  let result = "";
  let sourceOffset = 0;
  for (const node of nodes) {
    result += container.slice(sourceOffset, node.index);
    result += `${node.prefix}${node.content}${node.suffix}`;
    sourceOffset = node.index + node.length;
  }
  result += container.slice(sourceOffset);
  return { content: result, keys: matches.map((match) => match[1]), changes: changes.reverse() };
}

function transformXml(xml, format, fields = null) {
  const containers = textContainers(xml, format);
  const keys = [];
  const changes = [];
  let result = "";
  let offset = 0;
  for (const container of containers) {
    result += xml.slice(offset, container.index);
    const transformed = transformTextContainer(container[0], fields);
    result += transformed.content;
    keys.push(...transformed.keys);
    changes.push(...transformed.changes);
    offset = container.index + container[0].length;
  }
  result += xml.slice(offset);
  return { content: result, keys, changes };
}

function validatePackage(entries, format) {
  const names = new Set(entries.map((entry) => entry.name));
  if (!names.has("[Content_Types].xml")) fail("routine_office_template_invalid");
  if (format === "docx" && !names.has("word/document.xml")) fail("routine_office_template_invalid");
  if (format === "xlsx" && !names.has("xl/workbook.xml")) fail("routine_office_template_invalid");
}

function placeholdersFromEntries(entries, format) {
  const keys = new Set();
  for (const entry of entries) {
    if (!editableXml(format, entry.name)) continue;
    const xml = entry.content.toString("utf8");
    if (format === "xlsx" && /<f(?:\s[^>]*)?>[^<]*\{\{[^<]*<\/f>/i.test(xml)) {
      fail("routine_office_formula_placeholder_not_allowed");
    }
    for (const key of transformXml(xml, format).keys) keys.add(key);
  }
  return [...keys].sort();
}

export function inspectOfficeTemplateBuffer({ buffer, format } = {}) {
  try {
    if (!new Set(["docx", "xlsx"]).has(format)) fail("routine_template_format_not_supported");
    const entries = readArchive(buffer);
    validatePackage(entries, format);
    const placeholderKeys = placeholdersFromEntries(entries, format);
    if (!placeholderKeys.length) fail("routine_template_placeholders_required");
    return {
      ok: true,
      format,
      placeholderKeys,
      fidelity: {
        formulaCount: format === "xlsx"
          ? entries.filter((entry) => /^xl\/worksheets\/.+\.xml$/.test(entry.name))
            .reduce((sum, entry) => sum + (entry.content.toString("utf8").match(/<f(?:\s|>)/g)?.length ?? 0), 0)
          : 0,
        preservesStyles: entries.some((entry) => ["word/styles.xml", "xl/styles.xml"].includes(entry.name)),
        tablePartCount: entries.filter((entry) => /(?:^word\/tables\/.+|^xl\/tables\/.+)/.test(entry.name)).length,
        mediaPartCount: entries.filter((entry) => /\/media\/.+/.test(entry.name)).length,
      },
    };
  } catch (error) {
    return { ok: false, error: error?.code ?? "routine_office_template_invalid", format };
  }
}

export function renderOfficeTemplateBuffer({ buffer, format, fields = {} } = {}) {
  const inspected = inspectOfficeTemplateBuffer({ buffer, format });
  if (!inspected.ok) return inspected;
  const missingFields = inspected.placeholderKeys.filter((key) => fields[key] == null || String(fields[key]).trim() === "");
  if (missingFields.length) {
    return { ok: false, error: "routine_template_values_missing", missingFields };
  }
  try {
    const entries = readArchive(buffer);
    const changes = [];
    const rendered = entries.map((entry) => {
      if (!editableXml(format, entry.name)) return entry;
      const original = entry.content.toString("utf8");
      const transformed = transformXml(original, format, fields);
      const content = transformed.content;
      changes.push(...transformed.changes.map((change) => ({ location: entry.name, ...change })));
      return content === original ? entry : { ...entry, content: Buffer.from(content, "utf8") };
    });
    if (!changes.length) fail("routine_template_placeholders_required");
    return {
      ok: true,
      format,
      buffer: writeArchive(rendered),
      preview: {
        changes: changes.slice(0, 100),
        unchanged: inspected.fidelity,
        message: "Only confirmed placeholders change; formulas, styles, tables, and media stay in the template package.",
      },
    };
  } catch (error) {
    return { ok: false, error: error?.code ?? "routine_office_template_write_failed", format };
  }
}
