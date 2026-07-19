// Text normalization primitives — extracted from the v2 monolith (R1).

export function normalizeStringOrNull(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || null;
}

export function sanitizeIdentitySetValue(value) {
  const normalized = normalizeStringOrNull(value);
  if (!normalized) return null;
  const withoutEvidenceNarration = normalized
    .replace(/\s*\((?=[^)]*\b(?:visible|printed|observed|readable)\b)[^)]*\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!withoutEvidenceNarration) return null;
  const printedCodes = withoutEvidenceNarration.match(/\b[A-Z]{2,8}[- ]\d{1,4}\b/g) || [];
  return printedCodes.length >= 2 ? null : withoutEvidenceNarration;
}

export function sanitizeIdentityCardNameValue(value) {
  const normalized = normalizeStringOrNull(value);
  if (!normalized) return null;
  if (/\b(?:unsigned\s+facsimile|facsimile\s+signature|printed\s+(?:facsimile\s+)?signature|not\s+signed|no\s+autograph)\b/i.test(normalized)) {
    return null;
  }
  return normalized;
}
