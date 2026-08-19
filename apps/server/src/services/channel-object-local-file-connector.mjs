/*
 * Local-file source adapter for the Channel business-object pipeline.
 *
 * The adapter owns the source boundary (bytes -> normalized rows). It never
 * writes business objects and never enters the task execution queue. The
 * importer owns preview/confirmation, while the common connector pipeline can
 * later consume the same normalized row contract from another source.
 */

export function createLocalFileConnector({ decodeRows, normalizeRow, maxRows = 1_000 } = {}) {
  if (typeof decodeRows !== "function" || typeof normalizeRow !== "function") {
    throw new TypeError("Local file connector requires decodeRows and normalizeRow functions.");
  }
  return {
    id: "local_file",
    name: "本地文件",
    mode: "read_only",
    kinds: ["contact", "order", "quotation", "shipment", "after_sales", "account", "receivable", "bank_transaction", "publish_target"],
    async read({ bytes, format, fileName, kind }) {
      const decoded = await decodeRows({ bytes, format, fileName });
      if (decoded.error) return decoded;
      if (!decoded.rows.length) return { error: "channel_object_import_empty" };
      if (decoded.rows.length > maxRows) return { error: "channel_object_import_row_limit", maxRows };
      return {
        format: decoded.format,
        totalRows: decoded.rows.length,
        rows: decoded.rows.map((row, index) => normalizeRow(row, kind, index + 2)),
      };
    },
  };
}
