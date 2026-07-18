export function normalizeCardYearValue(value) {
  const normalized = String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;

  const season = normalized.match(/^((?:19|20)\d{2})\s*\/\s*(\d{2})$/);
  return season ? `${season[1]}-${season[2]}` : normalized;
}
