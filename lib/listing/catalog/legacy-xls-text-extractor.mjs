import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const legacyXlsMagic = "d0cf11e0a1b11ae1";
const defaultMaxBytes = 16 * 1024 * 1024;
const defaultMaxRows = 100_000;

export function isLegacyXlsBuffer(payload) {
  const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || []);
  return buffer.subarray(0, 8).toString("hex") === legacyXlsMagic;
}

export function extractLegacyXlsText(payload, {
  maxBytes = defaultMaxBytes,
  maxRows = defaultMaxRows
} = {}) {
  const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || []);
  if (!isLegacyXlsBuffer(buffer)) throw new Error("official_legacy_xls_magic_invalid");
  if (buffer.length > maxBytes) throw new Error("official_legacy_xls_payload_too_large");

  // Loaded only for OLE/BIFF workbooks. Existing PDF, XLSX, CSV and HTML paths
  // do not import or execute the legacy parser.
  const XLSX = require("xlsx");
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    dense: true,
    cellDates: false,
    sheetRows: maxRows
  });
  const lines = [];

  for (const sheetName of workbook.SheetNames || []) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false
    });
    for (const row of rows) {
      const cells = Array.from(row || [], (value) => String(value ?? "").replace(/\s+/g, " ").trim());
      while (cells.length && !cells.at(-1)) cells.pop();
      if (cells.some(Boolean)) lines.push(cells.join("\t"));
    }
  }

  return lines.join("\n");
}
