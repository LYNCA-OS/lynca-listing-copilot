// Text normalization primitives — extracted from the v2 monolith (R1).

export function normalizeStringOrNull(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || null;
}

const nonIdentityDisplayText = /^(?:Metaverse Cards|(?:J\/?\s*)?Bowman Briefing[\s/!]*)$/i;
const absentCardNameNarration = /^\(?\s*(?:no\s+(?:(?:separate|separately|distinct|printed)\s+){0,3}(?:printed\s+)?card(?:\s+|-)\s*(?:name|title)(?:\s+(?:is\s+)?(?:present|printed|visible|readable))?|without\s+(?:a\s+)?(?:(?:separate|distinct|printed)\s+){0,2}card(?:\s+|-)\s*(?:name|title)|(?:not|isn['’]?t)\s+(?:a\s+)?(?:(?:separate|distinct|printed)\s+){0,2}card(?:\s+|-)\s*(?:name|title)|card(?:\s+|-)\s*(?:name|title)\s+(?:is\s+)?not\s+(?:present|printed|visible|readable|shown))\s*\)?[.!]?$/i;
const absentInsertNameNarration = /^\(?\s*(?:no|without\s+(?:a\s+)?)\s+(?:(?:separate|distinct|printed|named)\s+){0,3}insert\s+(?:name|title)(?:\s+(?:is\s+)?(?:present|printed|visible|readable|shown))?\s*\)?[.!]?$/i;

export function sanitizeIdentitySetValue(value) {
  const normalized = normalizeStringOrNull(value);
  if (!normalized) return null;
  const withoutEvidenceNarration = normalized
    .replace(/\s*\((?=[^)]*\b(?:visible|printed|observed|readable|indicat(?:e|es|ed)|front\s*\/\s*back|retro\s+(?:style|design))\b)[^)]*\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!withoutEvidenceNarration) return null;
  if (nonIdentityDisplayText.test(withoutEvidenceNarration)) return null;
  const printedCodes = withoutEvidenceNarration.match(/\b[A-Z]{2,8}[- ]\d{1,4}\b/g) || [];
  return printedCodes.length >= 2 ? null : withoutEvidenceNarration;
}

export function narratedProductIdentityFromSet(value) {
  const normalized = normalizeStringOrNull(value);
  if (!normalized) return null;
  const match = normalized.match(/\b(?:indicat(?:e|es|ed)|shows?|reads?)\s+((?:Topps|Bowman|Panini|Upper\s+Deck|Donruss|Leaf)\b.{0,40}?)\s+product\b/i);
  return match?.[1]?.replace(/\s+/g, " ").trim() || null;
}

export function sanitizeIdentityCardNameValue(value) {
  const normalized = normalizeStringOrNull(value);
  if (!normalized) return null;
  if (nonIdentityDisplayText.test(normalized)) return null;
  if (absentCardNameNarration.test(normalized)) return null;
  if (absentInsertNameNarration.test(normalized)) return null;
  if (/^\(?\s*unsigned\s*\)?$/i.test(normalized)) return null;
  if (/\b(?:unsigned\s+facsimile|facsimile\s+signature|signature\s+facsimile|printed\s+(?:facsimile\s+)?signature|not\s+signed|no\s+autograph)\b/i.test(normalized)) {
    return null;
  }
  return normalized;
}
