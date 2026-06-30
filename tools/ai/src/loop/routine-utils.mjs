import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function safeId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._-]+$/.test(value);
}

export function safePathSegment(text) {
  return String(text)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "routine";
}

export function shortStableId(text) {
  let hash = 2166136261;
  for (const char of String(text)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function relativeRepoPath(path, root) {
  return normalizePath(resolve(path).replace(resolve(root), "")).replace(/^\/+/, "");
}

export function normalizePath(path) {
  return path.replace(/\\/g, "/");
}

export function findRoutineSourceRoot(path) {
  let current = dirname(resolve(path));
  while (current && current !== dirname(current)) {
    if (existsSync(resolve(current, ".git")) || existsSync(resolve(current, "package.json"))) return current;
    current = dirname(current);
  }
  return dirname(resolve(path));
}

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function arrayOr(value, fallback) {
  return Array.isArray(value) ? value : fallback;
}

export function stringArrayOr(value, fallback) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : fallback;
}

export function uniqueStrings(items) {
  return [...new Set((items ?? []).filter(Boolean))];
}

export function stringOr(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function booleanOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

export function positiveIntegerOr(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function nonNegativeIntegerOr(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function list(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None.";
}

export function fail(message) {
  throw new Error(message);
}
