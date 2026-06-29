import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { uniqueStrings } from "./routine-utils.mjs";

export function collectRoutineSkills(routine, root) {
  const skills = routine.skills.map((skill) => collectRoutineSkill(skill, root));
  return {
    collectedAt: new Date().toISOString(),
    skills,
    foundCount: skills.filter((skill) => skill.status === "found").length,
    missingRequired: skills.filter((skill) => skill.required && skill.status !== "found").map((skill) => skill.id),
  };
}

export function collectRoutineSkill(skill, root) {
  const target = resolveRoutineSkillPath(skill, root);
  const base = {
    id: skill.id,
    path: skill.path,
    required: Boolean(skill.required),
  };
  if (!skill.path || !target) {
    return {
      ...base,
      status: "missing",
      sha256: null,
      title: skill.id,
      summary: "",
      acceptance: [],
      checks: [],
      contentPreview: "",
    };
  }
  const content = readFileSync(target, "utf8");
  const parsed = parseSkillMarkdown(content, skill.id);
  return {
    ...base,
    status: "found",
    sha256: createHash("sha256").update(content).digest("hex"),
    ...parsed,
    contentPreview: truncateSkillContent(content),
  };
}

export function resolveRoutineSkillPath(skill, root) {
  if (!skill.path) return null;
  const primary = resolve(root, skill.path);
  if (existsSync(primary)) return primary;
  if (skill.sourcePath) {
    const source = resolve(skill.sourcePath);
    if (existsSync(source)) return source;
  }
  return null;
}

function parseSkillMarkdown(content, fallbackTitle) {
  const title = content.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim() ?? fallbackTitle;
  const summary = firstNonHeadingParagraph(content);
  return {
    title,
    summary,
    acceptance: markdownBulletsForHeadings(content, ["Acceptance", "Acceptance Criteria", "验收", "验收标准"]),
    checks: markdownBulletsForHeadings(content, ["Checks", "Validation", "验证", "检查"]),
  };
}

function firstNonHeadingParagraph(content) {
  const lines = content.split(/\r?\n/);
  const paragraph = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("- ") || line.startsWith("* ")) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line);
  }
  return paragraph.join(" ").slice(0, 500);
}

function markdownBulletsForHeadings(content, headings) {
  const headingPattern = headings.map(escapeRegExp).join("|");
  const regex = new RegExp(`^#{2,4}\\s+(?:${headingPattern})\\s*\\r?\\n([\\s\\S]*?)(?=^#{1,4}\\s+|(?![\\s\\S]))`, "gim");
  const bullets = [];
  for (const match of content.matchAll(regex)) {
    for (const line of match[1].split(/\r?\n/)) {
      const bullet = line.match(/^\s*[-*]\s+\[?[ xX]?\]?\s*(.+?)\s*$/)?.[1]?.trim();
      if (bullet) bullets.push(bullet);
    }
  }
  return uniqueStrings(bullets).slice(0, 20);
}

function truncateSkillContent(content) {
  return content.length > 2000 ? `${content.slice(0, 2000)}\n\n[truncated ${content.length - 2000} chars]` : content;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
