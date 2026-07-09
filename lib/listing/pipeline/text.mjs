// Text normalization primitives — extracted from the v2 monolith (R1).

export function normalizeStringOrNull(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || null;
}
