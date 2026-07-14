/*
 * Project Fields: parsing an issue body's `## Project Fields` block, and planning
 * the Project item-field writes that reconcile a Project item with it.
 *
 * This lives outside index.mjs because BOTH `sync-project-fields` and
 * `sync-project` reconcile the same fields, and they had drifted: one wrote the
 * *normalized* value into text fields, mangling `Source Doc:
 * docs/engineering/ADR_0010_X.md` into `docs/engineering/adr 0010 x.md`. One
 * planner, shared, so the two commands cannot disagree again.
 *
 * The rule the drift broke: `normalizeValue` is a COMPARISON key, not a value.
 * It exists so `in-progress` matches the `in progress` option and `M2 - Foo`
 * matches `M2`. Never write its output back — a single-select writes an option
 * id, and a text field writes the author's raw string.
 */

/** Comparison key. Lowercase, `_`/`-` to spaces, `M2 - Anything` to `m2`.
 *  Used to match a written value against an option name — never as a value. */
export function normalizeValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^m(\d).*$/, "m$1")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ");
}

export function toFieldKey(name) {
  const normalized = name.trim().toLowerCase();
  if (normalized === "agent target") return "agentTarget";
  if (normalized === "source doc") return "sourceDoc";
  return normalized.replace(/\s+([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function hasProjectFields(body) {
  return /##\s+Project Fields/i.test(body ?? "");
}

/** Read the `## Project Fields` block from an issue body as raw strings. */
export function parseProjectFields(body) {
  const result = {};
  const text = body ?? "";
  const match = text.match(/##\s+Project Fields\s*([\s\S]*?)(?:\n##\s+|$)/i);
  if (!match) return result;

  for (const line of match[1].split(/\r?\n/)) {
    const fieldMatch = line.match(/^\s*([A-Za-z ]+):\s*(.+?)\s*$/);
    if (!fieldMatch) continue;
    result[toFieldKey(fieldMatch[1])] = fieldMatch[2].trim();
  }

  return result;
}

function projectFieldValue(value) {
  if (value && typeof value === "object" && "name" in value) return value.name;
  return value;
}

export function currentProjectFields(item) {
  return {
    status: projectFieldValue(item.status),
    area: projectFieldValue(item.area),
    type: projectFieldValue(item.type),
    risk: projectFieldValue(item.risk),
    acceptance: projectFieldValue(item.acceptance),
    platform: projectFieldValue(item.platform),
    agentTarget: projectFieldValue(item["agent Target"]),
    priority: projectFieldValue(item.priority),
    sourceDoc: projectFieldValue(item["source Doc"]),
  };
}

export function buildProjectFieldMap(fields) {
  const map = {};
  for (const field of fields) {
    const key = toFieldKey(field.name);
    if (field.type === "ProjectV2SingleSelectField") {
      map[key] = {
        id: field.id,
        type: "single-select",
        options: new Map(field.options.map((optionValue) => [normalizeValue(optionValue.name), optionValue.id])),
      };
    } else if (field.type === "ProjectV2Field") {
      map[key] = { id: field.id, type: "text" };
    }
  }
  return map;
}

/**
 * Plan the field writes that bring a Project item in line with an issue's
 * declared fields.
 *
 * `desired` holds the author's RAW strings (from parseProjectFields). Matching
 * against options and against the item's current value goes through
 * normalizeValue; the value we hand back in `to` does not.
 *
 * `compareCurrent = false` for an item that is being added to the Project in this
 * same run — it has no field values yet, so there is nothing to compare against.
 *
 * Returns `{ operations, warnings }`; a warning names a field the Project cannot
 * accept, and never becomes an operation.
 */
export function planProjectFieldOperations({ desired, current = {}, fieldMap, compareCurrent = true }) {
  const operations = [];
  const warnings = [];

  for (const [field, rawValue] of Object.entries(desired)) {
    // The Milestone is a native GitHub field set on the issue itself, not a
    // Project field we write.
    if (!rawValue || field === "milestone") continue;

    const projectField = fieldMap[field];
    if (!projectField) {
      warnings.push({ field, value: rawValue, reason: "field-not-found" });
      continue;
    }

    const desiredKey = normalizeValue(rawValue);
    const currentValue = current[field];
    if (compareCurrent && normalizeValue(currentValue) === desiredKey) continue;

    const optionId = projectField.options?.get(desiredKey);
    if (projectField.type === "single-select" && !optionId) {
      warnings.push({ field, value: rawValue, reason: "option-not-found" });
      continue;
    }

    operations.push({
      field,
      fieldId: projectField.id,
      type: projectField.type,
      from: currentValue ?? "",
      // A single-select writes `optionId`; `to` is display only. A text field
      // writes `to` verbatim — the author's string, never the comparison key.
      to: rawValue,
      optionId,
    });
  }

  return { operations, warnings };
}
