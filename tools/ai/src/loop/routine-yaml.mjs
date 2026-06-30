export function parseSimpleYaml(source) {
  const lines = source
    .split(/\r?\n/)
    .map((raw) => raw.replace(/\t/g, "  "))
    .map((raw) => ({ indent: raw.match(/^ */)[0].length, text: raw.trim() }))
    .filter((line) => line.text && !line.text.startsWith("#"));
  if (lines.length === 0) return {};
  const [value, index] = parseYamlBlock(lines, 0, lines[0].indent);
  if (index < lines.length) fail(`Invalid YAML near: ${lines[index].text}`);
  return value;
}

function parseYamlBlock(lines, index, indent) {
  const line = lines[index];
  if (!line || line.indent < indent) return [null, index];
  if (line.text.startsWith("- ")) return parseYamlArray(lines, index, indent);
  return parseYamlObject(lines, index, indent);
}

function parseYamlArray(lines, index, indent) {
  const items = [];
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) break;
    if (line.indent !== indent || !line.text.startsWith("- ")) break;
    const rest = line.text.slice(2).trim();
    cursor += 1;
    if (!rest) {
      const [value, next] = parseYamlBlock(lines, cursor, lines[cursor]?.indent ?? indent + 2);
      items.push(value);
      cursor = next;
      continue;
    }
    if (isYamlKeyValue(rest)) {
      const item = {};
      cursor = assignYamlKeyValue(item, rest, lines, cursor);
      while (cursor < lines.length && lines[cursor].indent === indent + 2 && !lines[cursor].text.startsWith("- ")) {
        const propertyLine = lines[cursor];
        cursor += 1;
        cursor = assignYamlKeyValue(item, propertyLine.text, lines, cursor);
      }
      items.push(item);
    } else {
      items.push(parseYamlScalar(rest));
    }
  }
  return [items, cursor];
}

function parseYamlObject(lines, index, indent) {
  const object = {};
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) break;
    if (line.indent !== indent || line.text.startsWith("- ")) break;
    cursor += 1;
    cursor = assignYamlKeyValue(object, line.text, lines, cursor);
  }
  return [object, cursor];
}

function assignYamlKeyValue(object, text, lines, cursor) {
  const match = text.match(/^([^:]+):(.*)$/);
  if (!match) fail(`Invalid YAML key/value line: ${text}`);
  const key = match[1].trim();
  const rawValue = match[2].trim();
  if (rawValue) {
    object[key] = parseYamlScalar(rawValue);
    return cursor;
  }
  if (cursor < lines.length && lines[cursor].indent > 0) {
    const [value, next] = parseYamlBlock(lines, cursor, lines[cursor].indent);
    object[key] = value;
    return next;
  }
  object[key] = null;
  return cursor;
}

function isYamlKeyValue(text) {
  return /^[^:]+:/.test(text);
}

function parseYamlScalar(raw) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^\[[\s\S]*\]$/.test(value)) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((item) => parseYamlScalar(item.trim()));
  }
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

function fail(message) {
  throw new Error(message);
}
