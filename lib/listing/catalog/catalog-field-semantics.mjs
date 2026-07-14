function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sameText(left, right) {
  const leftText = cleanText(left).toLowerCase();
  const rightText = cleanText(right).toLowerCase();
  return Boolean(leftText && rightText && leftText === rightText);
}

export function catalogSetOrInsertFromParsed(parsed = {}) {
  return parsed.set || parsed.insert || null;
}

export function withoutLegacyCardNameSetAlias(fields = {}, parsedTitleFields = {}) {
  const sanitized = { ...fields };
  const cardName = parsedTitleFields.card_name || parsedTitleFields.official_card_type || null;
  const titleHasIndependentSet = Boolean(cleanText(parsedTitleFields.set || parsedTitleFields.set_or_insert));
  if (!cardName || titleHasIndependentSet) return sanitized;

  for (const key of ["set", "set_or_insert", "insert"]) {
    if (sameText(sanitized[key], cardName)) sanitized[key] = null;
  }
  return sanitized;
}
