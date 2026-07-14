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
  const cardName = parsedTitleFields.card_name
    || parsedTitleFields.official_card_type
    || fields.card_name
    || fields.official_card_type
    || null;
  const printFinish = [parsedTitleFields.surface_color, parsedTitleFields.parallel_family]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
  const nonSetAliases = [cardName, printFinish].filter(Boolean);
  const titleHasIndependentSet = Boolean(cleanText(parsedTitleFields.set || parsedTitleFields.set_or_insert));
  if (!nonSetAliases.length || titleHasIndependentSet) return sanitized;

  for (const key of ["set", "set_or_insert", "insert"]) {
    if (nonSetAliases.some((alias) => sameText(sanitized[key], alias))) sanitized[key] = null;
  }
  return sanitized;
}
