export function normalizeCardYearValue(value) {
  const normalized = String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;

  const season = normalized.match(/^((?:19|20)\d{2})\s*[/-]\s*(\d{2})$/);
  if (season) return `${season[1]}-${season[2]}`;

  // A full second year compresses to the marketplace season form
  // (2024-2025 -> 2024-25), but only for a real consecutive season.
  const fullSeason = normalized.match(/^((?:19|20)\d{2})\s*[/-]\s*((?:19|20)\d{2})$/);
  if (fullSeason && Number(fullSeason[2]) === Number(fullSeason[1]) + 1) {
    return `${fullSeason[1]}-${fullSeason[2].slice(2)}`;
  }

  // Providers sometimes emit a bare two-digit season pair (24-25). Expand the
  // century deterministically — card seasons are 19xx or 20xx — and only when
  // the pair is consecutive, so arbitrary number ranges pass through untouched.
  const shortSeason = normalized.match(/^(\d{2})\s*[/-]\s*(\d{2})$/);
  if (shortSeason && (Number(shortSeason[2]) === Number(shortSeason[1]) + 1
    || (shortSeason[1] === "99" && shortSeason[2] === "00"))) {
    const century = Number(shortSeason[1]) <= 45 ? "20" : "19";
    return `${century}${shortSeason[1]}-${shortSeason[2]}`;
  }

  return normalized;
}
