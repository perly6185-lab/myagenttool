export const PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSION = "private-tutor-textbook-page-v2";
export const PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSIONS = Object.freeze([
  "private-tutor-textbook-page-v1",
  PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSION,
]);
export const PRIVATE_TUTOR_OCR_REVIEW_CONFIDENCE_THRESHOLD = 0.85;

export const PRIVATE_TUTOR_TEXTBOOK_BLOCK_TYPES = Object.freeze([
  "heading",
  "paragraph",
  "formula",
  "table",
  "worked_example",
  "exercise",
  "illustration_caption",
  "other",
]);

export const PRIVATE_TUTOR_MATH_AST_NODE_TYPES = Object.freeze([
  "number",
  "identifier",
  "operator",
  "relation",
  "fraction",
  "power",
  "root",
  "group",
  "function",
  "text",
  "unknown",
]);

export const PRIVATE_TUTOR_VERTICAL_MATH_ROW_ROLES = Object.freeze([
  "operand",
  "operator",
  "partial",
  "separator",
  "result",
  "remainder",
]);
