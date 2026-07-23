import { createHash } from "node:crypto";

export const catalogSourceFingerprintContract = Object.freeze({
  schema_version: "catalog-source-fingerprint-v1",
  fingerprint_kind: "DECISION_FACTS",
  owner: "catalog_source_fingerprint",
  excludes: Object.freeze([
    "transport_headers",
    "request_tokens",
    "page_scripts",
    "presentation_markup"
  ])
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

function decisionRow(row = {}) {
  return {
    source_row_key: row.source_row_key || "",
    import_status: row.import_status || "",
    parse_confidence: Number.isFinite(Number(row.parse_confidence)) ? Number(row.parse_confidence) : null,
    canonical_title: row.canonical_title || "",
    identity_fields: stableValue(row.identity_fields || {}),
    physical_instance_fields: stableValue(row.physical_instance_fields || {}),
    field_statuses: stableValue(row.field_statuses || {}),
    review_notes: row.review_notes || null
  };
}

export function buildCatalogDecisionFingerprint(rows = []) {
  const canonicalRows = (Array.isArray(rows) ? rows : [])
    .map(decisionRow)
    .sort((left, right) => {
      const keyOrder = left.source_row_key.localeCompare(right.source_row_key);
      return keyOrder || JSON.stringify(left).localeCompare(JSON.stringify(right));
    });
  const payload = JSON.stringify({
    schema_version: catalogSourceFingerprintContract.schema_version,
    fingerprint_kind: catalogSourceFingerprintContract.fingerprint_kind,
    rows: canonicalRows
  });
  return {
    schema_version: catalogSourceFingerprintContract.schema_version,
    fingerprint_kind: catalogSourceFingerprintContract.fingerprint_kind,
    checksum: createHash("sha256").update(payload).digest("hex"),
    payload_length: payload.length,
    row_count: canonicalRows.length
  };
}
